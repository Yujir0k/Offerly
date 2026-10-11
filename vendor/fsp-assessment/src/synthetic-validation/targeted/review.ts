import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gzipSync, gunzipSync } from 'node:zlib';
import { createSession } from '../../adaptive/engine.js';
import { packs } from '../../generative/packs.js';
import { seedOf } from '../math.js';
import { prepareMetadata } from '../runtime.js';
import {
  capabilityMapping,
  prepareCompetencyMetadata,
  professionalRubric,
} from '../competency/rubrics.js';
import { competencyPersonas } from '../competency/personas-v21.js';
import { runReviewedSession, type ReviewCapture } from './runtime.js';
import { runReviewedSession as runReviewedAfterSession } from './runtime-after-review.js';
import { prepareScopedMetadata } from './scope-metadata.js';
import { writeCsv } from '../report.js';
import { removeItems } from './counterfactual.js';
const isAfter = process.argv.includes('--after') || (!isMainThread && workerData.after);
const output = isAfter
  ? 'data/synthetic-validation/middle-targeted-after-review'
  : 'data/synthetic-validation/middle-targeted-review';
const baseline = isAfter
  ? 'data/synthetic-validation/middle-targeted-after'
  : 'data/synthetic-validation/competency-based';
async function reviewTrack(track: string) {
  const saved = gunzipSync(readFileSync(`${baseline}/tracks/${track}/SESSION_RESULTS.jsonl.gz`))
    .toString()
    .trim()
    .split('\n')
    .map(
      (s) =>
        JSON.parse(s) as {
          profile: string;
          grade: string;
          mode: string;
          seed: number;
          confirmed: number;
          actionDigest: string;
          score: number;
        },
    )
    .filter(
      (r) => r.profile === 'clear_middle' && r.grade === 'Middle' && r.mode === 'full_synthetic',
    );
  const bySeed = new Map(saved.map((r) => [r.seed, r]));
  const profile = competencyPersonas(track).find((p) => p.id === 'clear_middle')!;
  const rows: object[] = [],
    manual: object[] = [];
  for (let index = 0; index < 500; index++) {
    const seed = seedOf(48121, track, index),
      template = createSession(
        `synthetic-${track}-Middle-${index}`,
        'synthetic-benchmark',
        'Middle',
        seed,
        Date.parse('2026-10-08T08:00:00Z'),
        undefined,
        undefined,
        { specialization: track },
      );
    const raw = prepareMetadata(template),
      cache = (isAfter ? prepareScopedMetadata : prepareCompetencyMetadata)(template, raw),
      capture: ReviewCapture = { boundaries: [] };
    const result = (isAfter ? runReviewedAfterSession : runReviewedSession)(
      template,
      profile,
      48121,
      'full_synthetic',
      cache,
      capture,
    );
    const prior = bySeed.get(seed)!;
    if (
      result.actionDigest !== prior.actionDigest ||
      result.score !== prior.score ||
      result.confirmed !== prior.confirmed
    )
      throw new Error(`Baseline replay mismatch ${track}/${seed}`);
    const session = capture.session!;
    const items = session.items.map(({ variant, stage }) => {
      const cs = session.contributions.filter((c) => c.familyId === variant.id),
        m = capabilityMapping(track, variant.generated!.itemModelId);
      const steps = variant.steps.map((s) => {
        const meta = cache.get(`${variant.id}/${s.id}`)!;
        return {
          id: s.id,
          dimension: meta.dimension,
          kind: meta.kind,
          facet: meta.facet,
          changed: meta.changed,
          hasPolicy: !!variant.generated!.stepWorlds[s.id]!.work?.policy,
          workProfile: variant.generated!.stepWorlds[s.id]!.work?.profile,
          consequences: variant.generated!.stepWorlds[s.id]!.work?.consequences,
        };
      });
      const weightedScore =
        cs.reduce((s, c) => s + c.value * c.weight, 0) / cs.reduce((s, c) => s + c.weight, 0);
      const cf = removeItems(session, [variant.id]);
      return {
        itemId: variant.id,
        model: variant.generated!.itemModelId,
        stage,
        band: variant.generated!.difficulty!.band,
        domain: variant.generated!.competencyDomain,
        required: m.requiredCapabilities,
        supporting: m.supportingCapabilities,
        optional: m.optionalCapabilities,
        weightedScore,
        steps,
        counterfactual: {
          confirmed: cf.confirmed,
          coverageSatisfied: cf.coverageSatisfied,
          score: cf.band.estimatedScore,
          lower: cf.band.lowerBound,
          margin: cf.band.margin,
          scoreDelta: cf.band.estimatedScore - result.score,
          lowerDelta: cf.band.lowerBound - result.lower,
        },
        contributions: cs,
      };
    });
    const anchors = items.filter((i) => i.stage === 'anchors' && i.steps.some((s) => s.hasPolicy));
    const weakest = [...items].sort(
      (a, b) => a.weightedScore - b.weightedScore || a.itemId.localeCompare(b.itemId),
    )[0]!;
    const cfAnchor = removeItems(
        session,
        anchors.map((i) => i.itemId),
      ),
      cfWeakest = removeItems(session, [weakest.itemId]);
    const modelRemovals = [...new Set(items.map((i) => i.model))].map((model) => {
      const cf = removeItems(
        session,
        items.filter((i) => i.model === model).map((i) => i.itemId),
      );
      return {
        model,
        confirmed: cf.confirmed,
        coverage: cf.coverageSatisfied,
        score: cf.band.estimatedScore,
        lower: cf.band.lowerBound,
        lowerDelta: cf.band.lowerBound - result.lower,
      };
    });
    rows.push({
      ...result,
      demonstrations: result.demonstrations,
      items,
      core: capture.core,
      boundaries: capture.boundaries,
      strategyAnchorIds: anchors.map((i) => i.itemId),
      strategyAnchorRemoved: {
        confirmed: cfAnchor.confirmed,
        coverage: cfAnchor.coverageSatisfied,
        band: cfAnchor.band,
      },
      weakestRemoved: {
        itemId: weakest.itemId,
        confirmed: cfWeakest.confirmed,
        coverage: cfWeakest.coverageSatisfied,
        band: cfWeakest.band,
      },
      modelRemovals,
      domainCoverage: Object.fromEntries(
        [...new Set(items.map((i) => i.domain!))].map((d) => [
          d,
          items.filter((i) => i.domain === d).length,
        ]),
      ),
    });
    for (const a of anchors) {
      const variant = session.items.find((i) => i.variant.id === a.itemId)!.variant;
      const st = variant.steps.find((s) =>
        cache.get(`${variant.id}/${s.id}`)!.alternatives.some((a) => a.archetype),
      )!;
      manual.push({
        track,
        seed,
        confirmed: result.confirmed,
        lower: result.lower,
        cut: result.cut,
        model: a.model,
        band: a.band,
        required: a.required,
        removeRescues: !result.confirmed && a.counterfactual.confirmed === 1,
        negativeContribution: 1 - a.weightedScore,
        lowerDelta: a.counterfactual.lowerDelta,
        prompt: st.prompt,
        context: st.context,
        options: st.options,
        controls: st.responseTask?.controls,
        artifacts: variant.artifacts.map((x) => ({ id: x.id, label: x.label, content: x.content })),
        work: variant.generated!.stepWorlds[st.id]!.work,
        expected: st.rubric.rationale,
        optionValues: st.rubric.scores,
        acceptedPlans: variant.generated!.responseChecks?.[st.id]?.accepted,
        capabilityExpectations: a.required.map((id) =>
          professionalRubric(track).capabilities.find((c) => c.id === id),
        ),
      });
    }
    if (index % 50 === 0) parentPort?.postMessage(`${track}: replay ${index + 1}/500`);
    if (index % 10 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  mkdirSync(`${output}/tracks`, { recursive: true });
  writeFileSync(
    `${output}/tracks/${track}.jsonl.gz`,
    gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'),
  );
  const candidates = (manual as { track: string; model: string; lowerDelta: number }[]).sort(
    (a, b) => b.lowerDelta - a.lowerDelta,
  );
  const unique = candidates.filter((m, i, a) => a.findIndex((x) => x.model === m.model) === i);
  writeFileSync(
    `${output}/tracks/${track}-manual.json`,
    JSON.stringify(unique.slice(0, 5), null, 2) + '\n',
  );
  const status = { track, sessions: rows.length, replayMismatches: 0 };
  writeCsv(`${output}/tracks/${track}-status.csv`, [status]);
}
if (!isMainThread) {
  await reviewTrack((workerData as { track: string; after: boolean }).track);
} else {
  const pending = packs.filter((p) => p.enabled).map((p) => p.id);
  const work = async () => {
    while (pending.length) {
      const track = pending.shift()!;
      await new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL('./review.js', import.meta.url), {
          workerData: { track, after: isAfter },
        });
        w.on('message', (m) => console.log(m));
        w.on('error', reject);
        w.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${track} ${c}`))));
      });
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => work()));
  console.log('Replayed all 6000 clear_middle/Middle sessions');
}

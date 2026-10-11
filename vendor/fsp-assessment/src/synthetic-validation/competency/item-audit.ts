/** Exhaustive model/support audit. Reads scores only for reporting, never for candidate behavior. */
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { packs, getPack } from '../../generative/packs.js';
import { generateItem } from '../../generative/generator.js';
import { createSession } from '../../adaptive/engine.js';
import { dimensions, type TargetGrade } from '../../adaptive/model.js';
import { gradeConfigs } from '../../adaptive/config.js';
import { prepareMetadata } from '../runtime.js';
import { mean, seedOf, correlation } from '../math.js';
import { lexicalOverlap } from '../policy.js';
import { writeCsv } from '../report.js';
import { competencyPersonas } from './personas.js';
import { prepareCompetencyMetadata } from './rubrics.js';
import { runCompetencySession } from './runtime.js';
import { verifyCompetencyFreeze } from './freeze.js';
const output = 'data/synthetic-validation/competency-item-audit';
async function auditTrack(track: string) {
  const pack = getPack(track),
    personas = competencyPersonas(track).filter((p) =>
      ['clear_junior', 'clear_middle', 'clear_senior'].includes(p.id),
    );
  const templates = new Map(
    (['Junior', 'Middle', 'Senior'] as const).map((g) => [
      g,
      createSession(
        'item-audit',
        'candidate',
        g,
        17,
        Date.parse('2026-10-08T08:00:00Z'),
        undefined,
        gradeConfigs[g],
        { specialization: track },
      ),
    ]),
  );
  const rows: object[] = [];
  for (const model of pack.itemModels)
    for (const grade of model.supportedGrades!) {
      const means: Record<string, number[]> = {},
        strict: Record<string, number[]> = {};
      const lexicalPairs: [number, number][] = [];
      const lengthPairs: [number, number][] = [];
      let forms = 0,
        options = 0,
        knownCause = 0,
        archetypeSteps = 0,
        wordingCue = 0,
        noMisconceptionSteps = 0,
        scoredSteps = 0;
      const demanded: Record<string, number> = {};
      for (let index = 0; index < 64; index++) {
        const item = generateItem(
          pack,
          model,
          grade,
          'anchors',
          dimensions[index % 4]!,
          seedOf(48121, 'item-diagnostics', track, model.id, grade, index),
        );
        const template = {
          ...templates.get(grade as TargetGrade)!,
          items: [{ variant: item, stage: item.stage }],
          boundaryPool: [],
        };
        const raw = prepareMetadata(template),
          cache = prepareCompetencyMetadata(template, raw);
        forms++;
        for (const step of item.steps) {
          if (step.exploration) continue;
          const m = cache.get(`${item.id}/${step.id}`)!;
          scoredSteps++;
          demanded[m.facet] = (demanded[m.facet] || 0) + 1;
          knownCause += Number(m.knownCause);
          archetypeSteps += Number(m.alternatives.some((a) => a.archetype));
          noMisconceptionSteps += Number(!m.alternatives.some((a) => a.misconception));
          const positive = step.options.find((o) => step.rubric.scores[o.id] === 1)!;
          wordingCue += Number(
            step.options
              .filter((o) => o.id !== positive.id)
              .every((o) => positive.text.length > o.text.length),
          );
          for (const option of step.options) {
            options++;
            lexicalPairs.push([
              lexicalOverlap(option.text, step.context + ' ' + step.prompt),
              Number(step.rubric.scores[option.id] === 1),
            ]);
            lengthPairs.push([option.text.length, Number(step.rubric.scores[option.id] === 1)]);
          }
        }
        for (const persona of personas) {
          const r = runCompetencySession(template, persona, 48121, 'full_synthetic', cache);
          (means[persona.id] ||= []).push(r.items[0]!.score);
          (strict[persona.id] ||= []).push(r.items[0]!.strictSuccess);
        }
      }
      rows.push({
        track,
        model: model.id,
        grade,
        forms,
        trialSessions: forms * personas.length,
        options,
        scoredSteps,
        knownCauseRate: knownCause / scoredSteps,
        archetypeRecognitionRate: archetypeSteps / scoredSteps,
        correctLongestRate: wordingCue / scoredSteps,
        noMisconceptionRate: noMisconceptionSteps / scoredSteps,
        lexicalCorrectnessCorrelation: correlation(lexicalPairs),
        lengthCorrectnessCorrelation: correlation(lengthPairs),
        demandedFacets: demanded,
        ...Object.fromEntries(
          personas.flatMap((p) => [
            [p.id + '_mean', mean(means[p.id]!)],
            [p.id + '_strict', mean(strict[p.id]!)],
          ]),
        ),
        interpretation:
          'Synthetic structural check and wording heuristic. Does not establish trivia, human distractor plausibility or empirical discrimination.',
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  mkdirSync(`${output}/tracks`, { recursive: true });
  writeFileSync(`${output}/tracks/${track}.json`, JSON.stringify(rows, null, 2) + '\n');
}
if (!isMainThread) {
  await auditTrack(workerData as string);
  parentPort!.postMessage(workerData);
} else {
  if (!verifyCompetencyFreeze().unchanged) throw new Error('Pre-run policy changed');
  if (readFileSync('data/competency-rubrics/PRE_RUN_LOCK.json', 'utf8').length < 10)
    throw new Error('Missing freeze');
  const pending = packs.filter((p) => p.enabled).map((p) => p.id),
    tracks = [...pending],
    start = Date.now();
  const work = async () => {
    while (pending.length) {
      const track = pending.shift()!;
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./item-audit.js', import.meta.url), {
          workerData: track,
        });
        worker.on('message', (s) => console.log('item audit:', s));
        worker.on('error', reject);
        worker.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error('Item audit worker failed')),
        );
      });
    }
  };
  await Promise.all([work(), work()]);
  const rows = tracks.flatMap(
    (t) =>
      JSON.parse(readFileSync(`${output}/tracks/${t}.json`, 'utf8')) as {
        forms: number;
        trialSessions: number;
      }[],
  );
  writeCsv(`${output}/ITEM_DIAGNOSTICS.csv`, rows);
  writeFileSync(
    `${output}/SUMMARY.json`,
    JSON.stringify(
      {
        modelGradeCombinations: rows.length,
        forms: rows.reduce((s, r) => s + r.forms, 0),
        trialSessions: rows.reduce((s, r) => s + r.trialSessions, 0),
        wallTimeMs: Date.now() - start,
      },
      null,
      2,
    ) + '\n',
  );
}

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createSession } from '../../adaptive/engine.js';
import { gradeConfigs } from '../../adaptive/config.js';
import { type TargetGrade } from '../../adaptive/model.js';
import { seedOf, mean } from '../math.js';
import { prepareMetadata } from '../runtime.js';
import { auditSemanticOracle, decompositionModes, type OracleAudit } from '../decomposition.js';
import { writeCsv } from '../report.js';
import { prepareScopedMetadata as prepareCompetencyMetadata } from './scope-metadata.js';
import { competencyPersonas, type CompetencyPersona } from '../competency/personas.js';
import { competencyPersonas as competencyPersonasV21 } from '../competency/personas-v21.js';
import { runScopedSession as runCompetencySessionV21 } from './scoped-runtime.js';
import { capabilityMapping, professionalRubric } from '../competency/rubrics.js';
import { runCompetencySession, type CompetencyObservation } from '../competency/runtime.js';

export interface CompetencyOptions {
  version: '2.0.0' | '2.1.0';
  seeds: number;
  benchmarkSeed: number;
  workers: number;
  tracks: string[];
  output: string;
}
interface Aggregate {
  track: string;
  grade: TargetGrade;
  profile: string;
  mode: string;
  n: number;
  confirmed: number;
  score: number;
  scoreSquared: number;
  boundary: number;
  durationMs: number;
  dimensions: Record<string, number>;
  stopReasons: Record<string, number>;
  timeouts: number;
}
export interface CompetencyTrackResult {
  track: string;
  personas: CompetencyPersona[];
  cohorts: object[];
  recovery: object[];
  sessions: number;
  decompositionSessions: number;
  failures: string[];
  replayChecks: number;
  replayFailures: number;
  audit: OracleAudit;
  exposure: object[];
  capabilityResults: object[];
  modelResults: object[];
}
export async function runTargetedAfterTrack(
  track: string,
  options: CompetencyOptions,
  progress?: (s: string) => void,
): Promise<CompetencyTrackResult> {
  const run = options.version === '2.1.0' ? runCompetencySessionV21 : runCompetencySession;
  const personas = (options.version === '2.1.0' ? competencyPersonasV21 : competencyPersonas)(
      track,
    ),
    rubric = professionalRubric(track);
  const aggregates = new Map<string, Aggregate>(),
    caps = new Map<
      string,
      {
        track: string;
        grade: string;
        profile: string;
        capability: string;
        facet: string;
        model: string;
        dimension: string;
        n: number;
        understood: number;
        slips: number;
        contribution: number;
        rejected: number;
        incoherent: number;
        misconceptions: Record<string, number>;
      }
    >();
  const models = new Map<
    string,
    {
      track: string;
      grade: string;
      profile: string;
      model: string;
      family: string;
      n: number;
      score: number;
      strict: number;
      boundary: number;
      confirmed: number;
      dimensions: Record<string, number>;
      dimensionCounts: Record<string, number>;
    }
  >();
  const exposure = new Map<
    string,
    {
      track: string;
      grade: string;
      capability: string;
      coreSessions: number;
      coreItems: number;
      boundarySessions: number;
      boundaryItems: number;
      dimensionSteps: Record<string, number>;
    }
  >();
  const recovered = new Map<string, number>();
  const failures: string[] = [],
    rows: object[] = [],
    failedRows: object[] = [],
    traces: object[] = [];
  const audit: OracleAudit = {
    stepsChecked: 0,
    semanticOptionMismatches: 0,
    semanticPlanMismatches: 0,
    examples: [],
    singleSourceEvidenceChecks: 0,
    singleSourceMaximumValues: {},
  };
  let sessions = 0,
    decompositionSessions = 0,
    replayChecks = 0,
    replayFailures = 0;
  const add = (r: CompetencyObservation) => {
    const key = `${r.grade}/${r.profile}/${r.mode}`;
    const a = aggregates.get(key) || {
      track,
      grade: r.grade,
      profile: r.profile,
      mode: r.mode,
      n: 0,
      confirmed: 0,
      score: 0,
      scoreSquared: 0,
      boundary: 0,
      durationMs: 0,
      dimensions: {},
      stopReasons: {},
      timeouts: 0,
    };
    a.n++;
    a.confirmed += r.confirmed;
    a.score += r.score;
    a.scoreSquared += r.score ** 2;
    a.boundary += r.boundaryCount;
    a.durationMs += r.durationMs;
    a.timeouts += Number(r.stopReason === 'timeout');
    a.stopReasons[r.stopReason] = (a.stopReasons[r.stopReason] || 0) + 1;
    for (const d of r.dimensions)
      a.dimensions[d.dimension] = (a.dimensions[d.dimension] || 0) + d.score;
    aggregates.set(key, a);
  };
  for (let index = 0; index < options.seeds; index++) {
    const recoveryForSeed = new Map<string, TargetGrade>();
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const seed = seedOf(options.benchmarkSeed, track, index);
      const template = createSession(
        `synthetic-${track}-${grade}-${index}`,
        'synthetic-benchmark',
        grade,
        seed,
        Date.parse('2026-10-08T08:00:00Z'),
        undefined,
        gradeConfigs[grade],
        { specialization: track },
      );
      const rawCache = prepareMetadata(template),
        cache = prepareCompetencyMetadata(template, rawCache);
      auditSemanticOracle(template, rawCache, audit);
      // Core exposure belongs to the paired blueprint, independent of the persona. Boundary is clear-middle actual exposure.
      const seen = new Set<string>();
      for (const { variant } of template.items) {
        const mapping = capabilityMapping(track, variant.generated!.itemModelId);
        for (const capability of mapping.requiredCapabilities) {
          const key = grade + '/' + capability;
          const a = exposure.get(key) || {
            track,
            grade,
            capability,
            coreSessions: 0,
            coreItems: 0,
            boundarySessions: 0,
            boundaryItems: 0,
            dimensionSteps: {},
          };
          a.coreItems++;
          if (!seen.has(capability)) a.coreSessions++;
          seen.add(capability);
          for (const step of variant.steps)
            a.dimensionSteps[step.rubric.dimension] =
              (a.dimensionSteps[step.rubric.dimension] || 0) + 1;
          exposure.set(key, a);
        }
      }
      for (const persona of personas) {
        let r: CompetencyObservation;
        try {
          r = run(template, persona, options.benchmarkSeed, 'full_synthetic', cache);
        } catch (error) {
          failures.push(`${grade}/${index}/${persona.id}: ${error}`);
          continue;
        }
        add(r);
        sessions++;
        if (r.confirmed) recoveryForSeed.set(persona.id, grade);
        if (index === 0) {
          const replay = run(template, persona, options.benchmarkSeed, 'full_synthetic', cache);
          replayChecks++;
          replayFailures += Number(
            replay.actionDigest !== r.actionDigest || replay.score !== r.score,
          );
          traces.push({
            grade,
            profile: persona.id,
            seed,
            demonstrations: r.demonstrations,
            items: r.items,
            actionDigest: r.actionDigest,
          });
        }
        const { demonstrations, items, ...compact } = r;
        rows.push({ ...compact, items });
        if (['clear_junior', 'clear_middle', 'clear_senior'].includes(persona.id) && !r.confirmed) {
          const masteryEvidence = Object.entries(
            demonstrations.reduce<Record<string, typeof demonstrations>>((groups, d) => {
              const key = d.capability + '/' + d.facet;
              (groups[key] ||= []).push(d);
              return groups;
            }, {}),
          ).map(([key, events]) => ({
            key,
            n: events!.length,
            understood: events!.filter((e) => e.understood).length,
            slips: events!.filter((e) => e.implementationSlip).length,
            meanContribution: mean(events!.map((e) => e.contribution)),
            models: [...new Set(events!.map((e) => e.model))],
          }));
          failedRows.push({ ...compact, items, masteryEvidence });
        }
        for (const e of demonstrations) {
          const key = [grade, persona.id, e.capability, e.facet, e.model, e.dimension].join('/');
          const a = caps.get(key) || {
            track,
            grade,
            profile: persona.id,
            capability: e.capability,
            facet: e.facet,
            model: e.model,
            dimension: e.dimension,
            n: 0,
            understood: 0,
            slips: 0,
            contribution: 0,
            rejected: 0,
            incoherent: 0,
            misconceptions: {},
          };
          a.n++;
          a.understood += Number(e.understood);
          a.slips += Number(e.implementationSlip);
          a.contribution += e.contribution;
          a.rejected += Number(e.planAccepted === false);
          a.incoherent += Number(e.semanticCoherence !== null && e.semanticCoherence < 1);
          if (e.misconception)
            a.misconceptions[e.misconception] = (a.misconceptions[e.misconception] || 0) + 1;
          caps.set(key, a);
        }
        const boundarySeen = new Set<string>();
        for (const item of items) {
          const key = [grade, persona.id, item.model].join('/');
          const a = models.get(key) || {
            track,
            grade,
            profile: persona.id,
            model: item.model,
            family: item.family,
            n: 0,
            score: 0,
            strict: 0,
            boundary: 0,
            confirmed: 0,
            dimensions: {},
            dimensionCounts: {},
          };
          a.n++;
          a.score += item.score;
          a.strict += item.strictSuccess;
          a.boundary += Number(item.boundary);
          a.confirmed += r.confirmed;
          for (const [d, v] of Object.entries(item.dimensions)) {
            a.dimensions[d] = (a.dimensions[d] || 0) + v;
            a.dimensionCounts[d] = (a.dimensionCounts[d] || 0) + 1;
          }
          models.set(key, a);
          if (persona.id === 'clear_middle' && item.boundary) {
            for (const capability of capabilityMapping(track, item.model).requiredCapabilities) {
              const ek = grade + '/' + capability;
              const e = exposure.get(ek) || {
                track,
                grade,
                capability,
                coreSessions: 0,
                coreItems: 0,
                boundarySessions: 0,
                boundaryItems: 0,
                dimensionSteps: {},
              };
              e.boundaryItems++;
              if (!boundarySeen.has(capability)) e.boundarySessions++;
              boundarySeen.add(capability);
              exposure.set(ek, e);
            }
          }
        }
        if (['clear_junior', 'clear_middle', 'clear_senior'].includes(persona.id)) {
          for (const mode of decompositionModes.filter((m) => m !== 'full_synthetic')) {
            const d = run(template, persona, options.benchmarkSeed, mode, cache);
            add(d);
            decompositionSessions++;
            const { demonstrations: _demonstrations, items: _items, ...compactDiagnostic } = d;
            rows.push(compactDiagnostic);
          }
        }
      }
      const oracle = run(
        template,
        { ...personas.find((p) => p.id === 'clear_senior')!, id: 'ORACLE_CANDIDATE' },
        options.benchmarkSeed,
        'oracle_candidate',
        cache,
      );
      add(oracle);
      decompositionSessions++;
      const { demonstrations: _demonstrations, items: _items, ...compactOracle } = oracle;
      rows.push(compactOracle);
      if (grade === 'Senior' && (index % 25 === 0 || index === options.seeds - 1))
        progress?.(`${track}: competency ${index + 1}/${options.seeds}`);
    }
    for (const persona of personas) {
      const k = persona.id + '/' + (recoveryForSeed.get(persona.id) || 'NONE');
      recovered.set(k, (recovered.get(k) || 0) + 1);
    }
    if (index % 10 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const directory = `${options.output}/tracks/${track}`;
  mkdirSync(directory, { recursive: true });
  const cohorts = [...aggregates.values()].map((a) => ({
    ...a,
    confirmationRate: a.confirmed / a.n,
    meanScore: a.score / a.n,
    scoreVariance: a.scoreSquared / a.n - (a.score / a.n) ** 2,
    avgBoundaryItems: a.boundary / a.n,
    avgDurationMs: a.durationMs / a.n,
    dimensionMeans: Object.fromEntries(Object.entries(a.dimensions).map(([d, v]) => [d, v / a.n])),
  }));
  const capabilityResults = [...caps.values()].map((a) => ({
    ...a,
    understoodRate: a.understood / a.n,
    slipRate: a.slips / a.n,
    meanContribution: a.contribution / a.n,
    planRejectionRate: a.rejected / a.n,
  }));
  const modelResults = [...models.values()].map((a) => ({
    ...a,
    meanScore: a.score / a.n,
    strictRate: a.strict / a.n,
    conditionalConfirmation: a.confirmed / a.n,
    dimensionMeans: Object.fromEntries(
      Object.entries(a.dimensions).map(([d, v]) => [d, v / a.dimensionCounts[d]!]),
    ),
  }));
  const coverage = rubric.capabilities.flatMap((c) =>
    (['Junior', 'Middle', 'Senior'] as const).map((grade) => {
      const a = exposure.get(grade + '/' + c.id) || {
        track,
        grade,
        capability: c.id,
        coreSessions: 0,
        coreItems: 0,
        boundarySessions: 0,
        boundaryItems: 0,
        dimensionSteps: {},
      };
      return {
        ...a,
        description: c.description,
        middleTier: c.middleTier,
        coreSessionExposure: a.coreSessions / options.seeds,
        boundaryScope: 'actual clear_middle sessions; overlapping core/boundary populations',
        requiredModels: JSON.parse(
          readFileSync('data/competency-rubrics/ITEM_CAPABILITY_MAPPING.json', 'utf8'),
        )
          .models.filter(
            (m: {
              track: string;
              requiredCapabilities: string[];
              gradeJustification: Record<string, unknown>;
            }) =>
              m.track === track &&
              m.requiredCapabilities.includes(c.id) &&
              grade in m.gradeJustification,
          )
          .map((m: { model: string }) => m.model),
      };
    }),
  );
  const recovery = [...recovered.entries()].map(([key, n]) => {
    const [profile, recoveredGrade] = key.split('/');
    return {
      track,
      profile,
      recoveredGrade,
      samples: n,
      latentClass: personas.find((p) => p.id === profile)!.latentClass,
    };
  });
  writeFileSync(
    `${directory}/SESSION_RESULTS.jsonl.gz`,
    gzipSync(rows.map((r) => JSON.stringify(r)).join('\n') + '\n'),
  );
  writeFileSync(
    `${directory}/FAILED_CLEAR_SESSIONS.jsonl.gz`,
    gzipSync(failedRows.map((r) => JSON.stringify(r)).join('\n') + '\n'),
  );
  writeFileSync(`${directory}/FIRST_SEED_DEMONSTRATIONS.json.gz`, gzipSync(JSON.stringify(traces)));
  const result = {
    track,
    personas,
    cohorts,
    recovery,
    sessions,
    decompositionSessions,
    failures,
    replayChecks,
    replayFailures,
    audit,
    exposure: coverage,
    capabilityResults,
    modelResults,
  };
  writeFileSync(`${directory}/RESULTS.json`, JSON.stringify(result, null, 2) + '\n');
  writeCsv(`${directory}/CONFIRMATION_MATRIX.csv`, cohorts);
  writeCsv(`${directory}/CAPABILITY_RESULTS.csv`, capabilityResults);
  writeCsv(`${directory}/MODEL_RESULTS.csv`, modelResults);
  writeCsv(`${directory}/CONTENT_COVERAGE.csv`, coverage);
  return result;
}

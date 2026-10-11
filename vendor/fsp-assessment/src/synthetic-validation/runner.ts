import { mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createSession } from '../adaptive/engine.js';
import { dimensions, type TargetGrade } from '../adaptive/model.js';
import { getPack } from '../generative/packs.js';
import { generateItem } from '../generative/generator.js';
import { gradeConfigs } from '../adaptive/config.js';
import { profilesForPack } from './profiles.js';
import {
  prepareMetadata,
  simulateSession,
  type SimulationObservation,
} from './improvements/scalar-runtime.js';
import { mean, variance, seedOf, correlation } from './math.js';
import { lexicalOverlap } from './policy.js';
import type { CandidateAction, SyntheticCandidateProfile } from './model.js';

export interface BenchmarkOptions {
  seeds: number;
  benchmarkSeed: number;
  itemSeeds: number;
  output: string;
  tracks: string[];
  workers: number;
  heuristicThresholds: HeuristicThresholds;
}
export interface HeuristicThresholds {
  suspiciousAdversarialRate: number;
  memorizerGap: number;
  lowDiscrimination: number;
  peerDifficultyGap: number;
  unstableClearLower: number;
  unstableClearUpper: number;
  clearSeniorMiddleMinimum: number;
  narrowSpecialistSeniorRate: number;
}
export const heuristicThresholds: HeuristicThresholds = {
  suspiciousAdversarialRate: 0.2,
  memorizerGap: 0.1,
  lowDiscrimination: 0.1,
  peerDifficultyGap: 0.2,
  unstableClearLower: 0.35,
  unstableClearUpper: 0.65,
  clearSeniorMiddleMinimum: 0.8,
  narrowSpecialistSeniorRate: 0.2,
};
export interface CohortResult {
  track: string;
  grade: TargetGrade;
  profile: string;
  sessions: number;
  confirmationRate: number;
  decisionVariance: number;
  scoreVariance: number;
  dimensionVariance: Record<string, number>;
  dimensionMeans: Record<string, number>;
  dimensionCoverage: Record<string, number>;
  boundaryRate: number;
  avgBoundaryItems: number;
  boundaryItemsUsed: number;
  boundaryTargetDimensions: Record<string, number>;
  boundaryDecisionChangeRate: number;
  boundaryTargetingFailures: number;
  avgCoreItems: number;
  avgTotalItems: number;
  avgDurationMs: number;
  avgCoreDurationMs: number;
  avgBoundaryDurationMs: number;
  timeoutRate: number;
  variantStability: number;
  hypothesisRevisions: number;
  evidenceDiscriminativeRate: number;
  domainExposureDistribution: Record<string, number>;
}
export interface ItemDiagnostic {
  track: string;
  model: string;
  grade: TargetGrade;
  band: string;
  samples: number;
  lowMeanContribution?: number;
  mediumMeanContribution?: number;
  highMeanContribution?: number;
  lowSuccessRate: number;
  mediumSuccessRate: number;
  highSuccessRate: number;
  lowStrictSuccessRate: number;
  mediumStrictSuccessRate: number;
  highStrictSuccessRate: number;
  syntheticStructuralDiscriminationProxy: number;
  boundaryUsage: number;
  conditionalFinalConfirmation: number | null;
  conditionalExposureCount: number;
  confirmationImpact: number | null;
  flags: string[];
}
export interface ConditionalModelResult {
  track: string;
  grade: TargetGrade;
  profile: string;
  model: string;
  family: string;
  exposedSessions: number;
  conditionalConfirmationRate: number;
  unexposedSessions: number;
  unexposedConfirmationRate: number | null;
  associationDifference: number | null;
  boundaryUsage: number;
}
export interface TrackResult {
  track: string;
  profiles: SyntheticCandidateProfile[];
  cohorts: CohortResult[];
  diagnostics: ItemDiagnostic[];
  modelConditional: ConditionalModelResult[];
  familyConditional: ConditionalModelResult[];
  gradeRecovery: {
    track: string;
    profile: string;
    latentClass: string;
    recoveredGrade: string;
    samples: number;
    borderline: boolean;
  }[];
  orderingViolations: {
    track: string;
    profile: string;
    lowerGrade: string;
    higherGrade: string;
    difference: number;
  }[];
  monotonicityViolations: {
    track: string;
    grade: string;
    weaker: string;
    stronger: string;
    difference: number;
  }[];
  generationFailures: { grade: string; seed: number; message: string }[];
  simulationFailures: { grade: string; seed: number; profile: string; message: string }[];
  seedInstability: { checks: number; failures: number };
  sessionsSimulated: number;
  itemsAnswered: number;
  answeredSteps: number;
  lexicalCorrectnessCorrelation: number | null;
}
const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
const start = Date.parse('2026-10-08T08:00:00Z');
interface CompactObservation {
  profile: string;
  grade: TargetGrade;
  seed: number;
  confirmed: number;
  score: number;
  dimensions: number[];
  coverage: number[];
  boundary: number;
  durationMs: number;
  timeout: number;
  actionDigest: string;
}
export async function runTrack(
  track: string,
  options: BenchmarkOptions,
  progress?: (message: string) => void,
): Promise<TrackResult> {
  const pack = getPack(track),
    profiles = profilesForPack(pack),
    directory = `${options.output}/tracks/${track}`;
  mkdirSync(directory, { recursive: true });
  const observations = new Map<string, SimulationObservation[]>();
  const rows: CompactObservation[] = [],
    traces: {
      profile: string;
      grade: string;
      seed: number;
      actions: { itemId: string; stepId: string; action: CandidateAction }[];
    }[] = [];
  const failures: TrackResult['generationFailures'] = [],
    simulationFailures: TrackResult['simulationFailures'] = [];
  const conditionals = new Map<
    string,
    {
      grade: TargetGrade;
      profile: string;
      model: string;
      family: string;
      confirmed: number;
      count: number;
      boundary: number;
    }
  >();
  const recovery = new Map<string, Map<TargetGrade, number>>();
  const seedInstability = { checks: 0, failures: 0 };
  let itemsAnswered = 0,
    answeredSteps = 0;
  const templates = new Map<TargetGrade, ReturnType<typeof createSession>>();
  for (let index = 0; index < options.seeds; index++) {
    const assessmentSeed = seedOf(options.benchmarkSeed, track, index);
    for (const grade of grades) {
      let template: ReturnType<typeof createSession>;
      try {
        template = createSession(
          `synthetic-${track}-${grade}-${index}`,
          'synthetic-benchmark',
          grade,
          assessmentSeed,
          start,
          undefined,
          gradeConfigs[grade],
          { specialization: track },
        );
      } catch (error) {
        failures.push({ grade, seed: assessmentSeed, message: String(error) });
        continue;
      }
      templates.set(grade, template);
      let metadata: ReturnType<typeof prepareMetadata>;
      try {
        metadata = prepareMetadata(template);
      } catch (error) {
        failures.push({ grade, seed: assessmentSeed, message: `metadata: ${error}` });
        continue;
      }
      for (const profile of profiles) {
        const trace =
          index === 0
            ? ([] as { itemId: string; stepId: string; action: CandidateAction }[])
            : undefined;
        let result: SimulationObservation;
        try {
          result = simulateSession(template, profile, options.benchmarkSeed, metadata, trace);
        } catch (error) {
          simulationFailures.push({
            grade,
            seed: assessmentSeed,
            profile: profile.id,
            message: String(error),
          });
          continue;
        }
        if (trace)
          traces.push({ profile: profile.id, grade, seed: assessmentSeed, actions: trace });
        if (index < 2 && ['clear_middle', 'random_guesser'].includes(profile.id)) {
          seedInstability.checks++;
          const repeat = simulateSession(template, profile, options.benchmarkSeed, metadata);
          if (JSON.stringify(repeat) !== JSON.stringify(result)) seedInstability.failures++;
        }
        const key = `${profile.id}/${grade}`,
          cohort = observations.get(key) || [];
        cohort.push(result);
        observations.set(key, cohort);
        rows.push({
          profile: profile.id,
          grade,
          seed: assessmentSeed,
          confirmed: result.confirmed,
          score: result.score,
          dimensions: result.dimensionScores,
          coverage: result.dimensionCoverage,
          boundary: result.boundaryCount,
          durationMs: result.durationMs,
          timeout: result.timeout,
          actionDigest: result.actionDigest,
        });
        itemsAnswered += result.answeredItems;
        answeredSteps += result.answeredSteps;
        const recoveryKey = `${profile.id}/${assessmentSeed}`,
          entries = recovery.get(recoveryKey) || new Map<TargetGrade, number>();
        entries.set(grade, result.confirmed);
        recovery.set(recoveryKey, entries);
        for (const model of new Set(
          result.items.filter((item) => item.exposed).map((item) => item.model),
        )) {
          const item = result.items.find((i) => i.model === model)!,
            key = `${profile.id}/${grade}/${model}`;
          const conditional = conditionals.get(key) || {
            grade,
            profile: profile.id,
            model,
            family: item.family,
            confirmed: 0,
            count: 0,
            boundary: 0,
          };
          conditional.confirmed += result.confirmed;
          conditional.count++;
          conditional.boundary += Number(result.items.some((i) => i.model === model && i.boundary));
          conditionals.set(key, conditional);
        }
      }
    }
    if (index % 25 === 0 || index === options.seeds - 1)
      progress?.(`${track}: ${index + 1}/${options.seeds} paired seeds`);
    // Yield to worker messages and stream output without sleeps.
    if (index % 10 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
  }
  const cohorts: CohortResult[] = [];
  for (const profile of profiles)
    for (const grade of grades) {
      const values = observations.get(`${profile.id}/${grade}`) || [],
        rate = mean(values.map((v) => v.confirmed));
      const boundary = values.filter((v) => v.boundaryCount > 0);
      const domains: Record<string, number> = {},
        targets: Record<string, number> = {};
      for (const v of values) {
        for (const item of v.items) domains[item.domain] = (domains[item.domain] || 0) + 1;
        for (const d of v.boundaryDimensions) targets[d] = (targets[d] || 0) + 1;
      }
      cohorts.push({
        track,
        grade,
        profile: profile.id,
        sessions: values.length,
        confirmationRate: rate,
        decisionVariance: rate * (1 - rate),
        scoreVariance: variance(values.map((v) => v.score)),
        dimensionVariance: Object.fromEntries(
          dimensions.map((d, i) => [d, variance(values.map((v) => v.dimensionScores[i]!))]),
        ),
        dimensionMeans: Object.fromEntries(
          dimensions.map((d, i) => [d, mean(values.map((v) => v.dimensionScores[i]!))]),
        ),
        dimensionCoverage: Object.fromEntries(
          dimensions.map((d, i) => [d, mean(values.map((v) => v.dimensionCoverage[i]!))]),
        ),
        boundaryRate: boundary.length / Math.max(1, values.length),
        avgBoundaryItems: mean(values.map((v) => v.boundaryCount)),
        boundaryItemsUsed: values.reduce((s, v) => s + v.boundaryCount, 0),
        boundaryTargetDimensions: targets,
        boundaryDecisionChangeRate: mean(boundary.map((v) => v.boundaryDecisionChanged)),
        boundaryTargetingFailures: values.reduce(
          (s, v) => s + v.boundaryTargetingFailures.length,
          0,
        ),
        avgCoreItems: mean(values.map((v) => v.coreItems)),
        avgTotalItems: mean(values.map((v) => v.totalItems)),
        avgDurationMs: mean(values.map((v) => v.durationMs)),
        avgCoreDurationMs: mean(values.map((v) => v.coreDurationMs)),
        avgBoundaryDurationMs: mean(values.map((v) => v.boundaryDurationMs)),
        timeoutRate: mean(values.map((v) => v.timeout)),
        variantStability: Math.max(rate, 1 - rate),
        hypothesisRevisions: values.reduce((s, v) => s + v.hypothesesRevised, 0),
        evidenceDiscriminativeRate: mean(values.map((v) => v.evidenceDiscriminativeRate)),
        domainExposureDistribution: domains,
      });
    }
  const modelConditional: ConditionalModelResult[] = [...conditionals.values()].map((c) => {
    const cohort = cohorts.find((row) => row.grade === c.grade && row.profile === c.profile)!,
      remaining = cohort.sessions - c.count,
      unexposed =
        remaining > 0
          ? (Math.round(cohort.confirmationRate * cohort.sessions) - c.confirmed) / remaining
          : null;
    return {
      track,
      grade: c.grade,
      profile: c.profile,
      model: c.model,
      family: c.family,
      exposedSessions: c.count,
      conditionalConfirmationRate: c.confirmed / c.count,
      unexposedSessions: remaining,
      unexposedConfirmationRate: unexposed,
      associationDifference: unexposed === null ? null : c.confirmed / c.count - unexposed,
      boundaryUsage: c.boundary,
    };
  });
  // Count each family once per session, including probes of different constructs.
  const familyConditional: ConditionalModelResult[] = [];
  for (const cohort of cohorts) {
    const values = observations.get(`${cohort.profile}/${cohort.grade}`) || [];
    for (const family of new Set(
      values.flatMap((value) =>
        value.items.filter((item) => item.exposed).map((item) => item.family),
      ),
    )) {
      const exposed = values.filter((value) =>
        value.items.some((item) => item.exposed && item.family === family),
      );
      const unexposed = values.filter(
        (value) => !value.items.some((item) => item.exposed && item.family === family),
      );
      const rate = mean(exposed.map((value) => value.confirmed));
      const other = unexposed.length ? mean(unexposed.map((value) => value.confirmed)) : null;
      familyConditional.push({
        track,
        grade: cohort.grade,
        profile: cohort.profile,
        model: family,
        family,
        exposedSessions: exposed.length,
        conditionalConfirmationRate: rate,
        unexposedSessions: unexposed.length,
        unexposedConfirmationRate: other,
        associationDifference: other === null ? null : rate - other,
        boundaryUsage: exposed.filter((value) =>
          value.items.some((item) => item.exposed && item.family === family && item.boundary),
        ).length,
      });
    }
  }
  const gradeRecovery: TrackResult['gradeRecovery'] = [];
  for (const profile of profiles) {
    const counts = new Map<string, number>();
    for (const [key, entries] of recovery)
      if (key.startsWith(`${profile.id}/`) && entries.size === 3) {
        const recovered = [...grades].reverse().find((grade) => entries.get(grade)) || 'NONE';
        counts.set(recovered, (counts.get(recovered) || 0) + 1);
      }
    for (const [recoveredGrade, samples] of counts)
      gradeRecovery.push({
        track,
        profile: profile.id,
        latentClass: profile.latentClass,
        recoveredGrade,
        samples,
        borderline: profile.latentClass === 'borderline',
      });
  }
  const orderingViolations: TrackResult['orderingViolations'] = [],
    monotonicityViolations: TrackResult['monotonicityViolations'] = [];
  for (const profile of profiles)
    for (let i = 0; i < 2; i++) {
      const lower = cohorts.find((c) => c.profile === profile.id && c.grade === grades[i])!,
        higher = cohorts.find((c) => c.profile === profile.id && c.grade === grades[i + 1])!;
      if (higher.confirmationRate > lower.confirmationRate)
        orderingViolations.push({
          track,
          profile: profile.id,
          lowerGrade: lower.grade,
          higherGrade: higher.grade,
          difference: higher.confirmationRate - lower.confirmationRate,
        });
    }
  const ordered = profiles.filter((p) => p.order !== null);
  for (const grade of grades)
    for (let i = 0; i < ordered.length - 1; i++) {
      const weaker = cohorts.find((c) => c.grade === grade && c.profile === ordered[i]!.id)!,
        stronger = cohorts.find((c) => c.grade === grade && c.profile === ordered[i + 1]!.id)!;
      if (weaker.confirmationRate > stronger.confirmationRate)
        monotonicityViolations.push({
          track,
          grade,
          weaker: weaker.profile,
          stronger: stronger.profile,
          difference: weaker.confirmationRate - stronger.confirmationRate,
        });
    }
  const diagnostics: ItemDiagnostic[] = [],
    lexicalPairs: [number, number][] = [];
  const abilityProfiles = profiles.filter((p) =>
    ['clear_junior', 'clear_middle', 'clear_senior'].includes(p.id),
  );
  for (const model of pack.itemModels)
    for (const grade of model.supportedGrades!) {
      const successes = abilityProfiles.map(() => [] as number[]),
        strict = abilityProfiles.map(() => [] as number[]);
      let band = '';
      for (let index = 0; index < options.itemSeeds; index++) {
        const leaf = seedOf(
          options.benchmarkSeed,
          'item-diagnostics',
          track,
          model.id,
          grade,
          index,
        );
        const item = generateItem(
          pack,
          model,
          grade,
          'anchors',
          dimensions[index % dimensions.length]!,
          leaf,
        );
        band = item.difficultyBand;
        const template = {
          ...templates.get(grade)!,
          items: [{ variant: item, stage: item.stage }],
          boundaryPool: [],
        };
        const cache = prepareMetadata(template);
        for (const step of item.steps)
          for (const option of step.options)
            lexicalPairs.push([
              lexicalOverlap(option.text, step.context),
              Number(step.rubric.scores[option.id] === 1),
            ]);
        for (const [profileIndex, profile] of abilityProfiles.entries()) {
          const result = simulateSession(template, profile, options.benchmarkSeed, cache);
          successes[profileIndex]!.push(result.items[0]!.success);
          strict[profileIndex]!.push(result.items[0]!.strictSuccess);
        }
      }
      const conditional = modelConditional.find(
        (c) => c.grade === grade && c.profile === 'clear_senior' && c.model === model.id,
      );
      diagnostics.push({
        track,
        model: model.id,
        grade,
        band,
        samples: options.itemSeeds,
        lowMeanContribution: mean(successes[0]!),
        mediumMeanContribution: mean(successes[1]!),
        highMeanContribution: mean(successes[2]!),
        lowSuccessRate: mean(strict[0]!),
        mediumSuccessRate: mean(strict[1]!),
        highSuccessRate: mean(strict[2]!),
        lowStrictSuccessRate: mean(strict[0]!),
        mediumStrictSuccessRate: mean(strict[1]!),
        highStrictSuccessRate: mean(strict[2]!),
        syntheticStructuralDiscriminationProxy: mean(strict[2]!) - mean(strict[0]!),
        boundaryUsage: conditional?.boundaryUsage || 0,
        conditionalFinalConfirmation: conditional?.conditionalConfirmationRate ?? null,
        conditionalExposureCount: conditional?.exposedSessions || 0,
        confirmationImpact: conditional?.associationDifference ?? null,
        flags: [],
      });
    }
  for (const row of diagnostics) {
    const peers = diagnostics.filter((p) => p.band === row.band && p.model !== row.model);
    if (row.highStrictSuccessRate < row.lowStrictSuccessRate) row.flags.push('high-below-low');
    if (row.syntheticStructuralDiscriminationProxy < options.heuristicThresholds.lowDiscrimination)
      row.flags.push('low-synthetic-discrimination');
    if (
      mean(peers.map((p) => p.highStrictSuccessRate)) - row.highStrictSuccessRate >
      options.heuristicThresholds.peerDifficultyGap
    )
      row.flags.push('harder-than-band-peers');
    if (
      row.confirmationImpact !== null &&
      row.conditionalExposureCount >= 20 &&
      row.confirmationImpact < -options.heuristicThresholds.peerDifficultyGap
    )
      row.flags.push('conditional-final-association');
  }
  const result: TrackResult = {
    track,
    profiles,
    cohorts,
    diagnostics,
    modelConditional,
    familyConditional,
    gradeRecovery,
    orderingViolations,
    monotonicityViolations,
    generationFailures: failures,
    simulationFailures,
    seedInstability,
    sessionsSimulated: rows.length,
    itemsAnswered,
    answeredSteps,
    lexicalCorrectnessCorrelation: correlation(lexicalPairs),
  };
  writeFileSync(
    `${directory}/SESSION_RESULTS.jsonl.gz`,
    gzipSync(rows.map((row) => JSON.stringify(row)).join('\n') + '\n'),
  );
  writeFileSync(`${directory}/ACTION_TRACES.json`, JSON.stringify(traces, null, 2) + '\n');
  writeFileSync(`${directory}/RESULTS.json`, JSON.stringify(result, null, 2) + '\n');
  return result;
}

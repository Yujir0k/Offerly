/** Scoring-aware diagnostic controls are deliberately separate from the blind synthetic policy. */
import { createHash } from 'node:crypto';
import {
  answer,
  coreCompleted,
  expireSession,
  openEvidence,
  publicSession,
} from '../adaptive/engine.js';
import { type AssessmentSession, type ItemVariant, type ItemStep } from '../adaptive/model.js';
import type { Plan } from '../domain.js';
import { canonical } from '../generative/validators.js';
import { candidatePolicy } from './policy.js';
import { emptyReplay, prepareMetadata, type MetadataCache } from './runtime.js';
import { validationMetadata } from './metadata.js';
import { seedOf } from './math.js';
import type {
  CandidateAction,
  CandidateMemory,
  SyntheticCandidateProfile,
  ValidationMetadata,
} from './model.js';

export const decompositionModes = [
  'perfect_answers_perfect_evidence',
  'perfect_answers_synthetic_evidence',
  'synthetic_answers_perfect_evidence',
  'full_synthetic',
] as const;
export type DecompositionMode = (typeof decompositionModes)[number];
export interface DiagnosticDimension {
  dimension: string;
  score: number;
  coverage: number;
  effectiveEvidence: number;
  margin: number;
  scoreDistanceToCut: number;
  lowerDistanceToCut: number;
}
export interface DiagnosticObservation {
  track: string;
  grade: AssessmentSession['targetGrade'];
  profile: string;
  mode: DecompositionMode | 'oracle_candidate';
  seed: number;
  confirmed: number;
  stopReason: string;
  failureReasons: string[];
  score: number;
  margin: number;
  cut: number;
  lower: number;
  upper: number;
  distanceToCut: number;
  estimatedDistanceToCut: number;
  upperDistanceToCut: number;
  dimensions: DiagnosticDimension[];
  coreCompleted: boolean;
  coverageSatisfied: boolean;
  boundaryCount: number;
  boundaryDimensions: string[];
  totalItems: number;
  durationMs: number;
  answerSteps: number;
  fullAnswerSteps: number;
  imperfectAnswerValueSum: number;
  evidenceSteps: number;
  evidenceValueSum: number;
  maxEvidenceValueSum: number;
  lostEvidenceValue: number;
  actionDigest: string;
  executionMismatches: number;
  positiveOptionRejectedByPlan: number;
}
function normalized(plan: Plan, step: ItemStep): unknown {
  return Object.fromEntries(
    step.responseTask!.controls.map((c) => [
      c.id,
      c.type === 'multiselect' ? [...(plan[c.id] as string[])].sort() : plan[c.id],
    ]),
  );
}
export function planAccepted(item: ItemVariant, step: ItemStep, plan: Plan | undefined): boolean {
  return (
    !step.responseTask ||
    (!!plan &&
      !!item.generated!.responseChecks![step.id]!.accepted.some(
        (p) => canonical(normalized(p, step)) === canonical(normalized(plan, step)),
      ))
  );
}
/** Dedicated frozen oracle control, not a candidate policy or latent-grade rule. */
export function frozenOracleAnswer(
  item: ItemVariant,
  step: ItemStep,
): { optionId: string; execution?: Plan } {
  if (step.exploration) return { optionId: 'continue' };
  const option = [...step.options]
    .sort((a, b) => a.id.localeCompare(b.id))
    .find((o) => step.rubric.scores[o.id] === 1);
  if (!option) throw new Error('No full-credit oracle answer');
  const execution = step.responseTask
    ? item.generated!.responseChecks![step.id]!.accepted[0]
    : undefined;
  if (step.responseTask && !execution) throw new Error('No frozen oracle execution');
  return { optionId: option.id, ...(execution ? { execution: structuredClone(execution) } : {}) };
}
/** Independent semantic-adapter control verifies that hidden metadata maps to the frozen contract. */
export function semanticOracleAnswer(
  step: ItemStep,
  metadata: ValidationMetadata,
): { optionId: string; execution?: Plan } {
  if (step.exploration) return { optionId: 'continue' };
  const alternative = [...metadata.alternatives].sort(
    (a, b) =>
      b.causalCoherence * b.constraintFitness - a.causalCoherence * a.constraintFitness ||
      a.id.localeCompare(b.id),
  )[0]!;
  let execution: Plan | undefined;
  if (step.responseTask) {
    execution = {};
    if (metadata.jointPlans.length) {
      const plan = [...metadata.jointPlans]
        .filter((p) => p.contractFitness === 1 && p.minimality === 1)
        .sort((a, b) => canonical(a.plan).localeCompare(canonical(b.plan)))[0];
      if (!plan) throw new Error('Semantic oracle has no minimal contract plan');
      Object.assign(execution, plan.plan);
    }
    for (const control of step.responseTask.controls)
      if (!(control.id in execution)) {
        const value = [...metadata.controls[control.id]!].sort(
          (a, b) =>
            b.coherence - a.coherence || canonical(a.value).localeCompare(canonical(b.value)),
        )[0]!;
        if (value.coherence !== 1) throw new Error('Semantic oracle has no fully coherent control');
        execution[control.id] = value.value;
      }
  }
  return { optionId: alternative.id, ...(execution ? { execution } : {}) };
}
export function perfectEvidenceOrder(
  item: ItemVariant,
  step: ItemStep,
  visibleIds: string[],
): string[] {
  return item.artifacts
    .filter((a) => visibleIds.includes(a.id))
    .sort((a, b) => b.usefulness - a.usefulness || a.id.localeCompare(b.id))
    .slice(0, step.requiredEvidenceSources || 2)
    .map((a) => a.id);
}
export function maximumEvidenceValue(
  item: ItemVariant,
  step: ItemStep,
  visibleIds: string[],
): number {
  const sources = perfectEvidenceOrder(item, step, visibleIds);
  // Report actual unchanged engine coefficients; this helper is not used by synthetic policy.
  return sources.reduce(
    (sum, id, index) =>
      sum + item.artifacts.find((a) => a.id === id)!.usefulness * (index === 0 ? 0.6 : 0.4),
    0,
  );
}
export function runDiagnosticSession(
  template: AssessmentSession,
  profile: SyntheticCandidateProfile,
  benchmarkSeed: number,
  mode: DecompositionMode | 'oracle_candidate',
  cache = prepareMetadata(template),
): DiagnosticObservation {
  const session = emptyReplay(template),
    memories = new Map<string, CandidateMemory>(),
    digest = createHash('sha256');
  const { latentClass: _latentClass, order: _order, ...policyProfile } = profile;
  let now = Date.parse(session.startedAt),
    answerSteps = 0,
    fullAnswerSteps = 0,
    imperfectAnswerValueSum = 0,
    evidenceSteps = 0,
    evidenceValueSum = 0,
    maxEvidenceValueSum = 0,
    executionMismatches = 0,
    positiveOptionRejectedByPlan = 0;
  while (session.state === 'active') {
    const item = session.items[session.cursor.item]!,
      step = item.variant.steps[session.cursor.step]!,
      metadata =
        cache.get(`${item.variant.id}/${step.id}`) || validationMetadata(item.variant, step);
    const memory = memories.get(item.variant.id) || {
      hypothesis: null,
      hypothesisRevisions: 0,
      opened: [],
      previousPlan: null,
      previousArchetype: null,
    };
    const view = publicSession(session, now).current!;
    let action: CandidateAction;
    if (mode === 'oracle_candidate') {
      action = {
        ...frozenOracleAnswer(item.variant, step),
        evidenceOrder: [],
        elapsedMs: 500,
        localSuccessProbability: 1,
        hypothesis: null,
        revisedHypothesis: false,
        misconception: null,
      };
    } else
      action = candidatePolicy(
        policyProfile,
        view.step,
        metadata,
        memory,
        seedOf(
          benchmarkSeed,
          session.specialization,
          session.targetGrade,
          session.seed,
          profile.id,
          item.variant.id,
          step.id,
        ),
      );
    if (
      !step.exploration &&
      [
        'oracle_candidate',
        'perfect_answers_perfect_evidence',
        'perfect_answers_synthetic_evidence',
      ].includes(mode)
    ) {
      const oracle = frozenOracleAnswer(item.variant, step);
      action = {
        ...action,
        ...oracle,
        hypothesis: metadata.alternatives.find((a) => a.id === oracle.optionId)!.hypothesis,
        misconception: null,
      };
    }
    if (
      step.exploration &&
      [
        'oracle_candidate',
        'perfect_answers_perfect_evidence',
        'synthetic_answers_perfect_evidence',
      ].includes(mode)
    )
      action = {
        ...action,
        evidenceOrder: perfectEvidenceOrder(
          item.variant,
          step,
          view.artifacts.map((a) => a.id),
        ),
      };
    digest.update(JSON.stringify([item.variant.id, step.id, action]));
    now += action.elapsedMs;
    if (expireSession(session, now)) break;
    if (step.exploration) {
      for (const [index, id] of action.evidenceOrder.entries()) {
        openEvidence(
          session,
          item.variant.id,
          step.id,
          id,
          now - Math.min(action.elapsedMs - 1, 2000) + index,
        );
        memory.opened.push(id);
      }
      maxEvidenceValueSum += maximumEvidenceValue(
        item.variant,
        step,
        view.artifacts.map((a) => a.id),
      );
    } else {
      const accepted = planAccepted(item.variant, step, action.execution);
      executionMismatches += Number(!accepted);
      positiveOptionRejectedByPlan += Number(
        step.rubric.scores[action.optionId] === 1 && !accepted,
      );
    }
    answer(session, item.variant.id, step.id, action.optionId, now, action.execution);
    const value = session.contributions.at(-1)!.value;
    if (step.exploration) {
      evidenceSteps++;
      evidenceValueSum += value;
    } else {
      answerSteps++;
      fullAnswerSteps += Number(value === 1);
      imperfectAnswerValueSum += 1 - value;
    }
    memory.hypothesis = action.hypothesis;
    memory.hypothesisRevisions += Number(action.revisedHypothesis);
    memory.previousPlan = action.execution || memory.previousPlan;
    memory.previousArchetype =
      metadata.alternatives.find((a) => a.id === action.optionId)?.archetype ||
      memory.previousArchetype;
    memories.set(item.variant.id, memory);
  }
  const result = session.result!,
    complete = coreCompleted(session),
    coverage = result.dimensions.every((d) => d.coverage >= session.config.minimumCoverage),
    confirmed = Number(result.decision === 'CONFIRMED');
  const failureReasons: string[] = [];
  if (!confirmed) {
    if (!complete) failureReasons.push('mandatory-core-incomplete');
    if (!coverage) failureReasons.push('insufficient-independent-dimension-coverage');
    if (result.stopReason === 'timeout') failureReasons.push('hard-cap-expired');
    if (result.band.upperBound < result.band.cutScore)
      failureReasons.push('entire-decision-band-below-cut');
    else if (result.band.lowerBound <= result.band.cutScore)
      failureReasons.push(
        result.band.estimatedScore >= result.band.cutScore
          ? 'midpoint-at-or-above-cut-but-lower-bound-not-above-cut'
          : 'midpoint-below-cut-and-lower-bound-not-above-cut',
      );
    if (result.stopReason === 'boundary_exhausted')
      failureReasons.push('boundary-budget-or-eligible-pool-exhausted');
  }
  return {
    track: session.specialization,
    grade: session.targetGrade,
    profile: profile.id,
    mode,
    seed: Number(session.seed),
    confirmed,
    stopReason: result.stopReason,
    failureReasons,
    score: result.band.estimatedScore,
    margin: result.band.margin,
    cut: result.band.cutScore,
    lower: result.band.lowerBound,
    upper: result.band.upperBound,
    distanceToCut: result.band.lowerBound - result.band.cutScore,
    estimatedDistanceToCut: result.band.estimatedScore - result.band.cutScore,
    upperDistanceToCut: result.band.upperBound - result.band.cutScore,
    dimensions: result.dimensions.map((d) => ({
      dimension: d.dimension,
      score: d.score,
      coverage: d.coverage,
      effectiveEvidence: d.effectiveEvidence,
      margin: d.margin,
      scoreDistanceToCut: d.score - result.band.cutScore,
      lowerDistanceToCut: d.score - d.margin - result.band.cutScore,
    })),
    coreCompleted: complete,
    coverageSatisfied: coverage,
    boundaryCount: session.items.filter((i) => i.stage === 'boundary').length,
    boundaryDimensions: session.items
      .filter((i) => i.stage === 'boundary')
      .map((i) => i.variant.steps[0]!.rubric.dimension),
    totalItems: session.items.length,
    durationMs: Date.parse(session.finishedAt!) - Date.parse(session.startedAt),
    answerSteps,
    fullAnswerSteps,
    imperfectAnswerValueSum,
    evidenceSteps,
    evidenceValueSum,
    maxEvidenceValueSum,
    lostEvidenceValue: maxEvidenceValueSum - evidenceValueSum,
    actionDigest: digest.digest('hex'),
    executionMismatches,
    positiveOptionRejectedByPlan,
  };
}
export interface OracleAudit {
  stepsChecked: number;
  semanticOptionMismatches: number;
  semanticPlanMismatches: number;
  examples: {
    track: string;
    grade: string;
    model: string;
    step: string;
    optionMatches: boolean;
    planMatches: boolean;
  }[];
  singleSourceEvidenceChecks: number;
  singleSourceMaximumValues: Record<string, number>;
}
export function auditSemanticOracle(
  template: AssessmentSession,
  cache: MetadataCache,
  audit: OracleAudit,
): void {
  for (const item of [...template.items.map((i) => i.variant), ...template.boundaryPool])
    for (const step of item.steps) {
      if (step.exploration) {
        if (step.requiredEvidenceSources === 1) {
          audit.singleSourceEvidenceChecks++;
          const value = maximumEvidenceValue(
            item,
            step,
            item.artifacts
              .filter((a) => a.type !== 'topology' && a.type !== 'architecture')
              .map((a) => a.id),
          );
          audit.singleSourceMaximumValues[String(value)] =
            (audit.singleSourceMaximumValues[String(value)] || 0) + 1;
        }
        continue;
      }
      const answer = semanticOracleAnswer(step, cache.get(`${item.id}/${step.id}`)!);
      const optionMatches = step.rubric.scores[answer.optionId] === 1,
        planMatches = planAccepted(item, step, answer.execution);
      audit.stepsChecked++;
      audit.semanticOptionMismatches += Number(!optionMatches);
      audit.semanticPlanMismatches += Number(!planMatches);
      if ((!optionMatches || !planMatches) && audit.examples.length < 100)
        audit.examples.push({
          track: template.specialization,
          grade: template.targetGrade,
          model: item.generated!.itemModelId,
          step: step.id,
          optionMatches,
          planMatches,
        });
    }
}

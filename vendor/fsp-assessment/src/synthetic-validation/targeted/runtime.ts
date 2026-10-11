/** Dedicated competency validation executor. Production engine and v1 runtime remain unchanged. */
import { createHash } from 'node:crypto';
import {
  answer,
  coreCompleted,
  evaluateEvidence,
  chooseBoundary,
  expireSession,
  openEvidence,
  publicSession,
} from '../../adaptive/engine.js';
import { dimensions, type AssessmentSession } from '../../adaptive/model.js';
import { emptyReplay } from '../runtime.js';
import {
  frozenOracleAnswer,
  maximumEvidenceValue,
  perfectEvidenceOrder,
  planAccepted,
  type DiagnosticObservation,
  type DecompositionMode,
} from '../decomposition.js';
import { seedOf, mean } from '../math.js';
import type { CandidateAction } from '../model.js';
import { blindPersona, type CompetencyPersona } from '../competency/personas-v21.js';
import { competencyMetadata, prepareCompetencyMetadata } from '../competency/rubrics.js';
import {
  competencyPolicy,
  type CompetencyMemory,
  type CompetencyAction,
  type CapabilityEvent,
} from '../competency/policy-v21.js';
export interface Demonstration extends CapabilityEvent {
  dimension: string;
  model: string;
  kind: string;
  changed: boolean;
  contribution: number;
  semanticCoherence: number | null;
  planAccepted: boolean | null;
  misconception: string | null;
}
export interface CompetencyItemObservation {
  model: string;
  family: string;
  domain: string;
  boundary: boolean;
  strictSuccess: number;
  score: number;
  dimensions: Record<string, number>;
}
export interface CompetencyObservation extends DiagnosticObservation {
  demonstrations: Demonstration[];
  items: CompetencyItemObservation[];
}
export interface ReviewCapture {
  session?: AssessmentSession;
  core?: ReturnType<typeof evaluateEvidence>;
  boundaries: {
    itemId: string;
    model: string;
    band: string;
    dimension: string;
    expectedItemId: string | null;
    before: ReturnType<typeof evaluateEvidence>;
    after: ReturnType<typeof evaluateEvidence>;
    capabilities: string[];
    facet: string;
  }[];
}
export function runReviewedSession(
  template: AssessmentSession,
  profile: CompetencyPersona,
  benchmarkSeed: number,
  mode: DecompositionMode | 'oracle_candidate',
  cache = prepareCompetencyMetadata(template),
  capture?: ReviewCapture,
): CompetencyObservation {
  const session = emptyReplay(template),
    memories = new Map<string, CompetencyMemory>(),
    digest = createHash('sha256');
  const policyProfile = blindPersona(profile);
  const demonstrations: Demonstration[] = [];
  const itemObservations: CompetencyItemObservation[] = [];
  const executedItems = new Set<string>();
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
        cache.get(`${item.variant.id}/${step.id}`) || competencyMetadata(item.variant, step);
    const memory = memories.get(item.variant.id) || {
      hypothesis: null,
      hypothesisRevisions: 0,
      opened: [],
      previousPlan: null,
      previousArchetype: null,
      comprehension: {},
    };
    const view = publicSession(session, now).current!;
    if (capture && item.stage === 'boundary' && session.cursor.step === 0) {
      const prior = {
        ...session,
        items: session.items.filter((i) => i.variant.id !== item.variant.id),
      };
      capture.boundaries.push({
        itemId: item.variant.id,
        model: item.variant.generated!.itemModelId,
        band: item.variant.generated!.difficulty!.band,
        dimension: metadata.dimension,
        expectedItemId: chooseBoundary(prior)?.id || null,
        before: evaluateEvidence(prior),
        after: evaluateEvidence(prior),
        capabilities: metadata.requiredCapabilities,
        facet: metadata.facet,
      });
    }
    let action: CandidateAction;
    let modeledAction: CompetencyAction | null = null;
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
      action = modeledAction = competencyPolicy(
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
        seedOf(benchmarkSeed, session.specialization, session.seed, profile.id, item.variant.id),
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
    executedItems.add(item.variant.id);
    if (capture) {
      if (!capture.core && coreCompleted(session)) capture.core = evaluateEvidence(session);
      if (item.stage === 'boundary') capture.boundaries.at(-1)!.after = evaluateEvidence(session);
    }
    const value = session.contributions.at(-1)!.value;
    const selected = metadata.alternatives.find((a) => a.id === action.optionId);
    if (modeledAction)
      for (const event of modeledAction.capabilityEvents)
        demonstrations.push({
          ...event,
          dimension: metadata.dimension,
          model: item.variant.generated!.itemModelId,
          kind: metadata.kind,
          changed: metadata.changed,
          contribution: value,
          semanticCoherence: selected
            ? selected.causalCoherence * selected.constraintFitness
            : null,
          planAccepted: step.exploration
            ? null
            : planAccepted(item.variant, step, action.execution),
          misconception: action.misconception,
        });
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
  if (capture) capture.session = session;
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
  for (const { variant, stage } of session.items) {
    if (!executedItems.has(variant.id)) continue;
    const cs = session.contributions.filter((c) => c.familyId === variant.id);
    itemObservations.push({
      model: variant.generated!.itemModelId,
      family: variant.generated!.siblingGroup,
      domain: variant.generated!.competencyDomain!,
      boundary: stage === 'boundary',
      strictSuccess: Number(cs.length > 0 && cs.every((c) => c.value === 1)),
      score: mean(cs.map((c) => c.value)),
      dimensions: Object.fromEntries(
        dimensions.flatMap((d) => {
          const ds = cs.filter((c) => c.dimension === d);
          return ds.length ? [[d, mean(ds.map((c) => c.value))]] : [];
        }),
      ),
    });
  }
  return {
    demonstrations,
    items: itemObservations,
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

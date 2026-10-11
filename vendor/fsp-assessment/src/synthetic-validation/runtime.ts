import { createHash } from 'node:crypto';
import {
  answer,
  chooseBoundary,
  coreCompleted,
  evaluateEvidence,
  expireSession,
  openEvidence,
  publicSession,
} from '../adaptive/engine.js';
import {
  dimensions,
  type AssessmentSession,
  type ItemVariant,
  type ItemStep,
} from '../adaptive/model.js';
import { getPack } from '../generative/packs.js';
import { candidatePolicy } from './policy.js';
import { validationMetadata } from './metadata.js';
import { seedOf, mean } from './math.js';
import type {
  CandidateAction,
  CandidateMemory,
  SyntheticCandidateProfile,
  ValidationMetadata,
} from './model.js';

export interface ItemObservation {
  model: string;
  family: string;
  domain: string;
  band: string;
  boundary: boolean;
  completed: boolean;
  success: number;
  strictSuccess: number;
  dimensionScores: Partial<Record<(typeof dimensions)[number], number>>;
}
export interface SimulationObservation {
  track: string;
  grade: AssessmentSession['targetGrade'];
  profile: string;
  seed: number;
  confirmed: number;
  score: number;
  dimensionScores: number[];
  dimensionCoverage: number[];
  boundaryCount: number;
  boundaryDimensions: string[];
  boundaryTargetingFailures: string[];
  preBoundaryConfirmed: number;
  boundaryDecisionChanged: number;
  coreItems: number;
  totalItems: number;
  answeredItems: number;
  answeredSteps: number;
  durationMs: number;
  coreDurationMs: number;
  boundaryDurationMs: number;
  timeout: number;
  items: ItemObservation[];
  actionDigest: string;
  hypothesesRevised: number;
  evidenceDiscriminativeRate: number;
  misconceptionSelections: Record<string, number>;
}
export type MetadataCache = Map<string, ValidationMetadata>;
const keyOf = (item: ItemVariant, step: ItemStep) => `${item.id}/${step.id}`;
export function prepareMetadata(template: AssessmentSession): MetadataCache {
  return new Map(
    [...template.items.map((i) => i.variant), ...template.boundaryPool].flatMap((item) =>
      item.steps.map((step) => [keyOf(item, step), validationMetadata(item, step)] as const),
    ),
  );
}
/** Reuse frozen variants, not outcomes. Every persona executes the real engine from empty state. */
export function emptyReplay(template: AssessmentSession): AssessmentSession {
  return {
    ...template,
    items: template.items.map((i) => ({ ...i })),
    cursor: { item: 0, step: 0 },
    responses: [],
    evidenceSelections: [],
    contributions: [],
    result: null,
    state: 'active',
    finishedAt: null,
    stepStartedAt: template.startedAt,
    stageTimeMs: { anchors: 0, incident: 0, review: 0, boundary: 0 },
  };
}
export function simulateSession(
  template: AssessmentSession,
  profile: SyntheticCandidateProfile,
  benchmarkSeed: number,
  cache = prepareMetadata(template),
  trace?: { itemId: string; stepId: string; action: CandidateAction }[],
): SimulationObservation {
  const session = emptyReplay(template),
    pack = getPack(session.specialization);
  const memories = new Map<string, CandidateMemory>();
  const digest = createHash('sha256');
  const boundaryDimensions: string[] = [],
    boundaryTargetingFailures: string[] = [];
  const misconceptions: Record<string, number> = {};
  let now = Date.parse(session.startedAt),
    preBoundaryConfirmed = 0,
    revisions = 0,
    discriminative = 0,
    opened = 0;
  const { latentClass: _latentClass, order: _order, ...policyProfile } = profile;
  while (session.state === 'active') {
    const item = session.items[session.cursor.item]!,
      step = item.variant.steps[session.cursor.step]!;
    const metadata = cache.get(keyOf(item.variant, step)) || validationMetadata(item.variant, step);
    const memory = memories.get(item.variant.id) || {
      hypothesis: null,
      hypothesisRevisions: 0,
      opened: [],
      previousPlan: null,
      previousArchetype: null,
    };
    if (item.stage === 'boundary' && session.cursor.step === 0) {
      const prior = { ...session, items: session.items.slice(0, -1) };
      const expected = chooseBoundary(prior);
      const dimension = step.rubric.dimension;
      boundaryDimensions.push(dimension);
      if (!expected || expected.id !== item.variant.id)
        boundaryTargetingFailures.push('wrong-uncertain-dimension-or-priority');
      if (item.variant.specialization !== session.specialization)
        boundaryTargetingFailures.push('wrong-specialization');
      if (
        !pack.assessmentRecipes?.[session.targetGrade]?.boundaryBands.includes(
          item.variant.generated!.difficulty!.band,
        )
      )
        boundaryTargetingFailures.push('wrong-band');
      if (
        session.items
          .slice(0, -1)
          .some((i) => i.variant.generated!.siblingGroup === item.variant.generated!.siblingGroup)
      )
        boundaryTargetingFailures.push('repeated-sibling');
      if (metadata.dimension !== dimension) boundaryTargetingFailures.push('wrong-evidence-target');
    }
    const visible = publicSession(session, now).current!.step;
    const action = candidatePolicy(
      policyProfile,
      visible,
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
    digest.update(JSON.stringify([item.variant.id, step.id, action]));
    trace?.push({ itemId: item.variant.id, stepId: step.id, action });
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
        discriminative += Number(metadata.evidence.find((e) => e.id === id)!.discriminative);
        opened++;
        memory.opened.push(id);
      }
    }
    answer(session, item.variant.id, step.id, action.optionId, now, action.execution);
    if (action.misconception)
      misconceptions[action.misconception] = (misconceptions[action.misconception] || 0) + 1;
    if (action.revisedHypothesis) revisions++;
    memory.hypothesis = action.hypothesis;
    memory.hypothesisRevisions += Number(action.revisedHypothesis);
    memory.previousPlan = action.execution || memory.previousPlan;
    memory.previousArchetype =
      metadata.alternatives.find((a) => a.id === action.optionId)?.archetype ||
      memory.previousArchetype;
    memories.set(item.variant.id, memory);
    if (
      coreCompleted(session) &&
      !session.contributions.some((c) =>
        session.items.some((i) => i.stage === 'boundary' && i.variant.id === c.familyId),
      )
    ) {
      const core = evaluateEvidence(session);
      preBoundaryConfirmed = Number(
        core.dimensions.every((d) => d.coverage >= session.config.minimumCoverage) &&
          core.band.lowerBound > core.band.cutScore,
      );
    }
  }
  const result = session.result!;
  const items = session.items.map(({ variant, stage }): ItemObservation => {
    const contributions = session.contributions.filter((c) => c.familyId === variant.id);
    const completed = variant.steps.every((step) =>
      session.responses.some((r) => r.itemId === variant.id && r.stepId === step.id),
    );
    return {
      model: variant.generated!.itemModelId,
      family: variant.generated!.siblingGroup,
      domain: variant.generated!.competencyDomain!,
      band: variant.generated!.difficulty!.band,
      boundary: stage === 'boundary',
      completed,
      success: mean(contributions.map((c) => c.value)),
      strictSuccess: Number(completed && contributions.every((c) => c.value === 1)),
      dimensionScores: Object.fromEntries(
        dimensions.flatMap((d) => {
          const cs = contributions.filter((c) => c.dimension === d);
          return cs.length ? [[d, mean(cs.map((c) => c.value))]] : [];
        }),
      ),
    };
  });
  const confirmed = Number(result.decision === 'CONFIRMED');
  return {
    track: session.specialization,
    grade: session.targetGrade,
    profile: profile.id,
    seed: Number(session.seed),
    confirmed,
    score: result.band.estimatedScore,
    dimensionScores: result.dimensions.map((d) => d.score),
    dimensionCoverage: result.dimensions.map((d) => d.coverage),
    boundaryCount: session.items.filter((i) => i.stage === 'boundary').length,
    boundaryDimensions,
    boundaryTargetingFailures,
    preBoundaryConfirmed,
    boundaryDecisionChanged: Number(
      boundaryDimensions.length > 0 && confirmed !== preBoundaryConfirmed,
    ),
    coreItems: session.items.filter((i) => i.stage !== 'boundary').length,
    totalItems: session.items.length,
    answeredItems: items.filter((i) => i.completed).length,
    answeredSteps: session.responses.length,
    durationMs: Date.parse(session.finishedAt!) - Date.parse(session.startedAt),
    coreDurationMs:
      session.stageTimeMs.anchors + session.stageTimeMs.incident + session.stageTimeMs.review,
    boundaryDurationMs: session.stageTimeMs.boundary,
    timeout: Number(result.stopReason === 'timeout'),
    items,
    actionDigest: digest.digest('hex'),
    hypothesesRevised: revisions,
    evidenceDiscriminativeRate: opened ? discriminative / opened : 0,
    misconceptionSelections: misconceptions,
  };
}

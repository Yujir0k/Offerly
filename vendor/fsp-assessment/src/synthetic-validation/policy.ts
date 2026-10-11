import type { Plan } from '../domain.js';
import { canonical, logistic, mean, seedOf, seededNoise, weightedChoice } from './math.js';
import type {
  CandidateAction,
  CandidateMemory,
  PolicyProfile,
  ValidationMetadata,
  VisibleStep,
} from './model.js';

/** Authored simulator coefficients; unrelated to production weights/cuts. Frozen before baseline. */
export const policyCoefficients = Object.freeze({
  dimension: 0.35,
  domain: 0.35,
  behaviour: 0.25,
  consistency: 0.05,
  logisticSlope: 14,
  choiceSharpness: 12,
  challengeBase: 0.24,
  complexityIncrement: 0.045,
  policyIncrement: 0.08,
  coreStepBaseMs: 34000,
  evidenceStepBaseMs: 22000,
});
export function localSuccessProbability(
  profile: PolicyProfile,
  metadata: ValidationMetadata,
  seed: number,
): number {
  const p = metadata.requirements;
  const behaviour =
    metadata.dimension === 'diagnosis'
      ? mean([
          profile.behaviours.evidenceSelection,
          profile.behaviours.causalReasoning,
          profile.behaviours.uncertaintyHandling,
        ])
      : metadata.dimension === 'adaptation'
        ? mean([profile.behaviours.constraintTracking, profile.behaviours.uncertaintyHandling])
        : mean([profile.behaviours.causalReasoning, profile.behaviours.constraintTracking]);
  const ability =
    policyCoefficients.dimension * profile.dimensions[metadata.dimension] +
    policyCoefficients.domain * (profile.domainSkills[metadata.domain] ?? 0.3) +
    policyCoefficients.behaviour * behaviour +
    policyCoefficients.consistency * profile.consistency;
  const challenge =
    policyCoefficients.challengeBase +
    policyCoefficients.complexityIncrement *
      (p.ambiguity -
        1 +
        (p.causalDepth - 1) +
        (p.evidenceComplexity - 1) +
        (p.constraintComplexity - 1) +
        (p.tradeoffComplexity - 1) +
        (p.evolutionComplexity - 1)) +
    (p.decisionResponsibility === 'policy' ? policyCoefficients.policyIncrement : 0);
  return logistic(
    policyCoefficients.logisticSlope * (ability - challenge + seededNoise(seed, profile.noise)),
  );
}
export function lexicalOverlap(text: string, scenario: string): number {
  const words = (input: string) => new Set(input.toLowerCase().match(/[\p{L}\p{N}_]{3,}/gu) || []);
  const a = words(text),
    b = words(scenario);
  return a.size ? [...a].filter((word) => b.has(word)).length / a.size : 0;
}
export function misconceptionWeight(profile: PolicyProfile, misconception: string | null): number {
  return misconception
    ? 0.3 +
        (profile.misconceptionSusceptibility[misconception] ??
          1 - profile.behaviours.misconceptionResistance)
    : 0.3;
}
function distributionWeight(reliability: number, utility: number, susceptibility: number): number {
  return (
    reliability * Math.exp(policyCoefficients.choiceSharpness * (utility - 1)) +
    (1 - reliability) * susceptibility
  );
}
export function candidatePolicy(
  profile: PolicyProfile,
  step: VisibleStep,
  metadata: ValidationMetadata,
  memory: CandidateMemory,
  seed: number,
): CandidateAction {
  const success = localSuccessProbability(profile, metadata, seedOf(seed, 'noise'));
  const evidence = metadata.evidence.slice().sort((a, b) => a.id.localeCompare(b.id));
  const order: string[] = [];
  const count = Math.min(
    evidence.length,
    (step.requiredEvidenceSources || 2) +
      Number(seededNoise(seedOf(seed, 'extra'), 1) > profile.behaviours.evidenceSelection),
  );
  while (order.length < count) {
    const choices = evidence.filter((a) => !order.includes(a.id));
    const chosen = weightedChoice(
      choices,
      choices.map((a) =>
        profile.mode === 'random'
          ? 1
          : profile.mode === 'keyword'
            ? 1 + lexicalOverlap(step.context, a.id)
            : Math.exp(
                5 *
                  (profile.behaviours.evidenceSelection * a.diagnosticValue +
                    (1 - profile.behaviours.evidenceSelection) * Number(a.symptomOnly) +
                    profile.behaviours.causalReasoning * Number(a.discriminative)),
              ),
      ),
      seedOf(seed, 'evidence', order.length),
    );
    order.push(chosen.id);
  }
  const scenario = `${step.context} ${step.prompt} ${step.resetContext || ''}`;
  const alternatives = metadata.alternatives.slice().sort((a, b) => a.id.localeCompare(b.id));
  const choice = alternatives.length
    ? weightedChoice(
        alternatives,
        alternatives.map((option) => {
          if (profile.mode === 'random') return 1;
          if (profile.mode === 'keyword')
            return Math.exp(
              8 * lexicalOverlap(step.options.find((o) => o.id === option.id)!.text, scenario),
            );
          if (profile.mode === 'overengineer') return Math.exp(8 * option.complexity);
          if (profile.mode === 'memorizer' && option.archetype)
            return Math.exp(
              6 * (/canary|dual|isolation|shadow|gate|rollback/.test(option.archetype) ? 1 : 0.2),
            );
          if (
            profile.mode === 'weak-adaptation' &&
            metadata.changed &&
            option.archetype === memory.previousArchetype
          )
            return 30;
          const evidenceUse = metadata.knownCause
            ? 1
            : 0.75 + 0.25 * profile.behaviours.evidenceSelection;
          const fitness = option.archetype
            ? 0.35 * option.causalCoherence + 0.65 * option.constraintFitness
            : option.causalCoherence * evidenceUse;
          return distributionWeight(
            success,
            fitness,
            misconceptionWeight(profile, option.misconception),
          );
        }),
        seedOf(seed, 'intent'),
      )
    : null;
  let execution: Plan | undefined;
  if (step.responseTask) {
    execution = {};
    if (metadata.jointPlans.length) {
      const plans = metadata.jointPlans
        .slice()
        .sort((a, b) => canonical(a.plan).localeCompare(canonical(b.plan)));
      const chosen = weightedChoice(
        plans,
        plans.map((plan) =>
          profile.mode === 'random' || profile.mode === 'keyword'
            ? 1
            : profile.mode === 'overengineer'
              ? Math.exp(6 * plan.complexity)
              : distributionWeight(
                  success,
                  0.75 * plan.contractFitness + 0.25 * plan.minimality,
                  0.5,
                ),
        ),
        seedOf(seed, 'joint-plan'),
      );
      Object.assign(execution, chosen.plan);
    }
    for (const control of step.responseTask.controls
      .slice()
      .sort((a, b) => a.id.localeCompare(b.id))) {
      if (control.id in execution) continue;
      const values = metadata.controls[control.id]!.slice().sort((a, b) =>
        canonical(a.value).localeCompare(canonical(b.value)),
      );
      const previous = memory.previousPlan?.[control.id];
      const picked = weightedChoice(
        values,
        values.map((value) => {
          if (profile.mode === 'random') return 1;
          if (profile.mode === 'keyword')
            return Math.exp(
              8 *
                lexicalOverlap(
                  control.options.find((o) => o.value === value.value)?.label ||
                    String(value.value),
                  scenario,
                ),
            );
          if (profile.mode === 'overengineer') return Math.exp(6 * value.complexity);
          if (
            (profile.mode === 'weak-adaptation' || profile.mode === 'memorizer') &&
            metadata.changed &&
            canonical(previous) === canonical(value.value)
          )
            return 30;
          const reliability =
            control.id === 'strategy'
              ? success
              : logistic(
                  14 *
                    (0.4 * profile.dimensions.correctness +
                      0.35 * (profile.domainSkills[metadata.domain] ?? 0.3) +
                      0.25 * profile.behaviours.causalReasoning -
                      0.38 -
                      (metadata.requirements.causalDepth - 1) * 0.065 +
                      seededNoise(seedOf(seed, control.id, 'noise'), profile.noise)),
                );
          return distributionWeight(
            reliability,
            value.coherence,
            misconceptionWeight(profile, value.misconception),
          );
        }),
        seedOf(seed, 'control', control.id),
      );
      execution[control.id] = picked.value;
    }
  }
  const proposedHypothesis = choice?.hypothesis || memory.hypothesis;
  const hypothesis =
    metadata.kind === 'falsification' &&
    seededNoise(seedOf(seed, 'use-falsifier'), 1) > profile.behaviours.uncertaintyHandling
      ? memory.hypothesis
      : proposedHypothesis;
  const revisedHypothesis =
    metadata.kind === 'falsification' &&
    hypothesis !== memory.hypothesis &&
    seededNoise(seedOf(seed, 'revision'), 1) < profile.behaviours.uncertaintyHandling;
  const complexity = mean([
    metadata.requirements.evidenceComplexity,
    metadata.requirements.constraintComplexity,
    metadata.requirements.causalDepth,
  ]);
  const elapsedMs = Math.round(
    (step.exploration ? policyCoefficients.evidenceStepBaseMs : policyCoefficients.coreStepBaseMs) *
      (1 + 0.18 * (complexity - 1)) *
      profile.speed *
      (1 + seededNoise(seedOf(seed, 'time'), 0.22)),
  );
  return {
    optionId: choice?.id || 'continue',
    ...(execution ? { execution } : {}),
    evidenceOrder: order,
    elapsedMs,
    localSuccessProbability: success,
    hypothesis,
    revisedHypothesis,
    misconception: choice?.misconception || null,
  };
}

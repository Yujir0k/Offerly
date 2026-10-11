import type { Plan } from '../../domain.js';
import { random } from '../../random.js';
import { canonical, seedOf, weightedChoice } from '../math.js';
import { lexicalOverlap } from '../policy.js';
import type { CandidateAction, CandidateMemory, VisibleStep } from '../model.js';
import type { BlindPersona } from './personas-v21.js';
import type { CompetencyMetadata, Mastery, Facet } from './rubrics.js';

/** Authored behavioral kernel, frozen before outcomes. These are assumptions, not source-derived calibration. */
export const behavioralKernel = {
  version: 'competency-policy-2.1.0',
  comprehension: { stable: 0.98, moderate: 0.8, inconsistent: 0.55, weak: 0.2, not_expected: 0.05 },
  implementationSlip: {
    stable: 0.015,
    moderate: 0.04,
    inconsistent: 0.08,
    weak: 0.15,
    not_expected: 0.2,
  },
  interpretation:
    'Stable means repeated coherent demonstration; moderate/unstable encode inconsistent anchors. Numeric probabilities are uncalibrated authored priors. No cut/weight/confirmation-rate input.',
} as const;
export interface CapabilityEvent {
  capability: string;
  facet: Facet;
  mastery: Mastery;
  understood: boolean;
  implementationSlip: boolean;
}
export interface CompetencyMemory extends CandidateMemory {
  comprehension: Record<string, boolean>;
}
export interface CompetencyAction extends CandidateAction {
  capabilityEvents: CapabilityEvent[];
  facet: Facet;
  coherentState: boolean;
}
/** Normalize components separately: adding distractors cannot dilute the coherent-state branch. */
export function mixtureWeights(
  reliability: number,
  coherent: number[],
  errors: number[],
): number[] {
  const a = coherent.reduce((x, y) => x + y, 0),
    b = errors.reduce((x, y) => x + y, 0);
  if (!a || !b) throw new Error('Empty component in behavioral mixture');
  return coherent.map((w, i) => (reliability * w) / a + ((1 - reliability) * errors[i]!) / b);
}
function select<T>(values: T[], utility: (value: T) => number, coherent: boolean, seed: number): T {
  const fitness = values.map(utility),
    best = Math.max(...fitness);
  // In a failed reasoning state favor a plausible imperfect response, with some chance coincidence is correct.
  const weights = mixtureWeights(
    Number(coherent),
    fitness.map((u) => Number(u === best)),
    fitness.map((u) => (u === best ? 0.15 : 1 + Math.max(0, u))),
  );
  return weightedChoice(values, weights, seed);
}
export function competencyPolicy(
  persona: BlindPersona,
  step: VisibleStep,
  metadata: CompetencyMetadata,
  memory: CompetencyMemory,
  seed: number,
  itemSeed: number,
): CompetencyAction {
  const override = metadata.changed
    ? persona.adaptationOverride
    : metadata.dimension === 'diagnosis' &&
        (!persona.diagnosticOverrideScope ||
          persona.diagnosticOverrideScope.includes(metadata.facet))
      ? persona.diagnosticOverride
      : metadata.facet === 'strategic'
        ? persona.strategicOverride
        : undefined;
  const events = metadata.requiredCapabilities.map((capability): CapabilityEvent => {
    const mastery = override || persona.mastery[capability]?.[metadata.facet];
    if (!mastery) throw new Error('Missing capability mastery: ' + capability);
    const key = capability + '/' + metadata.facet + '/' + (override || 'base');
    if (!(key in memory.comprehension))
      memory.comprehension[key] =
        random(seedOf(itemSeed, key, 'comprehension'))() < behavioralKernel.comprehension[mastery];
    return {
      capability,
      facet: metadata.facet,
      mastery,
      understood: memory.comprehension[key]!,
      implementationSlip:
        random(seedOf(seed, key, 'implementation-slip'))() <
        behavioralKernel.implementationSlip[mastery],
    };
  });
  const coherent = events.every((e) => e.understood && !e.implementationSlip);
  const reliability = events.reduce(
    (p, e) =>
      p *
      behavioralKernel.comprehension[e.mastery] *
      (1 - behavioralKernel.implementationSlip[e.mastery]),
    1,
  );
  const scenario = step.context + ' ' + step.prompt;
  const alternatives = [...metadata.alternatives].sort((a, b) => a.id.localeCompare(b.id));
  const choice = alternatives.length
    ? select(
        alternatives,
        (a) =>
          persona.mode === 'keyword'
            ? lexicalOverlap(step.options.find((o) => o.id === a.id)!.text, scenario)
            : persona.mode === 'overengineer'
              ? a.complexity
              : persona.mode === 'memorizer'
                ? Number(/canary|rollback|shadow|dual/.test(a.archetype || ''))
                : a.archetype
                  ? 0.35 * a.causalCoherence + 0.65 * a.constraintFitness
                  : a.causalCoherence,
        persona.mode === 'random'
          ? false
          : ['keyword', 'overengineer', 'memorizer'].includes(persona.mode)
            ? true
            : coherent,
        seedOf(seed, 'intent'),
      )
    : null;
  // Uniform random has its own explicit branch.
  const selected =
    persona.mode === 'random' && alternatives.length
      ? weightedChoice(
          alternatives,
          alternatives.map(() => 1),
          seedOf(seed, 'random-intent'),
        )
      : choice;
  let execution: Plan | undefined;
  if (step.responseTask) {
    execution = {};
    const plans = [...metadata.jointPlans].sort((a, b) =>
      canonical(a.plan).localeCompare(canonical(b.plan)),
    );
    if (plans.length) {
      const picked =
        persona.mode === 'random' || persona.mode === 'keyword'
          ? weightedChoice(
              plans,
              plans.map(() => 1),
              seedOf(seed, 'joint-plan'),
            )
          : select(
              plans,
              (p) =>
                persona.mode === 'overengineer'
                  ? p.complexity
                  : 0.75 * p.contractFitness + 0.25 * p.minimality,
              persona.mode === 'overengineer' || coherent,
              seedOf(seed, 'joint-plan'),
            );
      Object.assign(execution, picked.plan);
    }
    for (const control of [...step.responseTask.controls].sort((a, b) =>
      a.id.localeCompare(b.id),
    )) {
      if (control.id in execution) continue;
      const values = [...metadata.controls[control.id]!].sort((a, b) =>
        canonical(a.value).localeCompare(canonical(b.value)),
      );
      // Intent and execution carry one semantic strategy, including wrong choices.
      const matching =
        control.id === 'strategy' && selected?.executionStrategy
          ? values.find((v) => v.value === selected.executionStrategy)
          : null;
      const picked =
        matching ||
        (persona.mode === 'random' || persona.mode === 'keyword'
          ? weightedChoice(
              values,
              values.map(() => 1),
              seedOf(seed, control.id),
            )
          : select(
              values,
              (v) => (persona.mode === 'overengineer' ? v.complexity : v.coherence),
              persona.mode === 'overengineer' || coherent,
              seedOf(seed, control.id),
            ));
      execution[control.id] = picked.value;
    }
  }
  const order: string[] = [];
  const evidence = [...metadata.evidence].sort((a, b) => a.id.localeCompare(b.id));
  while (order.length < Math.min(evidence.length, step.requiredEvidenceSources || 2)) {
    const remaining = evidence.filter((e) => !order.includes(e.id));
    const picked =
      persona.mode === 'random' || persona.mode === 'keyword'
        ? weightedChoice(
            remaining,
            remaining.map(() => 1),
            seedOf(seed, 'evidence', order.length),
          )
        : select(
            remaining,
            (e) => e.diagnosticValue + Number(e.discriminative),
            coherent,
            seedOf(seed, 'evidence', order.length),
          );
    order.push(picked.id);
  }
  const hypothesis = selected?.hypothesis || memory.hypothesis;
  return {
    optionId: selected?.id || 'continue',
    ...(execution ? { execution } : {}),
    evidenceOrder: order,
    elapsedMs: Math.round(
      (step.exploration ? 18000 : 28000) *
        (metadata.facet === 'bounded' ? 1 : metadata.facet === 'integrated' ? 1.3 : 1.65) *
        (0.9 + 0.2 * random(seedOf(seed, 'time'))()),
    ),
    localSuccessProbability: reliability,
    hypothesis,
    revisedHypothesis: metadata.kind === 'falsification' && hypothesis !== memory.hypothesis,
    misconception: selected?.misconception || null,
    capabilityEvents: events,
    facet: metadata.facet,
    coherentState: coherent,
  };
}

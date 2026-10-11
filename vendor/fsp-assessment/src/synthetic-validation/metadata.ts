import type { ItemVariant, ItemStep } from '../adaptive/model.js';
import type { LabControl, LabData, Plan, PlanValue } from '../domain.js';
import { families } from '../families/registry.js';
import { nativeSimulations } from '../generative/professional/native-simulations.js';
import { runWorkStrategy } from '../generative/qualitative-runtime.js';
import { transitionPrediction } from '../generative/transition.js';
import { actionToken } from '../generative/decision-archetypes.js';
import { gradeProfile, defaultBand } from '../generative/difficulty.js';
import type { WorldState } from '../generative/model.js';
import { canonical } from '../generative/validators.js';
import { mean } from './math.js';
import type { ControlAlternative, PlanAlternative, ValidationMetadata } from './model.js';

export function valuesOf(control: LabControl): PlanValue[] {
  if (control.type === 'number') return control.values;
  if (control.type === 'select') return control.options.map((o) => o.value);
  if (control.options.length > 8)
    throw new Error('Validation multiselect exceeds finite search bound');
  return Array.from({ length: 2 ** control.options.length }, (_, mask) =>
    control.options.filter((_, i) => mask & (1 << i)).map((o) => o.value),
  );
}
export function enumeratePlans(controls: LabControl[]): Plan[] {
  let plans: Plan[] = [{}];
  for (const control of controls) {
    plans = plans.flatMap((plan) =>
      valuesOf(control).map((value) => ({ ...plan, [control.id]: value })),
    );
    if (plans.length > 16384) throw new Error('Validation plan space exceeds bound');
  }
  return plans;
}
interface SimulationState {
  data: LabData;
  proposed: Plan;
  controls: LabControl[];
  affectedContext: number;
}
function simulationPlans(item: ItemVariant, world: WorldState): PlanAlternative[] {
  if (typeof world.radicals.failure.simulation !== 'string') return [];
  const state = JSON.parse(world.radicals.failure.simulation) as SimulationState;
  const family = [...families, ...nativeSimulations].find(
    (f) => `work-${f.id}` === item.generated!.itemModelId,
  );
  if (!family) throw new Error(`No independent domain simulator: ${item.generated!.itemModelId}`);
  // Execute physical checks, never frozen accepted plans or scoring rubrics.
  const outcomes = enumeratePlans(state.controls).map((plan) => {
    const checks = Object.values(family.run(state.data, plan).checks);
    const effort = state.controls.filter(
      (c) => canonical(plan[c.id]) !== canonical(state.proposed[c.id]),
    ).length;
    return { plan, fitness: mean(checks.map(Boolean).map(Number)), effort };
  });
  const feasibleEfforts = outcomes.filter((o) => o.fitness === 1).map((o) => o.effort);
  if (!feasibleEfforts.length) throw new Error('Domain simulator has no feasible plan');
  const minimumEffort = Math.min(...feasibleEfforts);
  return outcomes.map((o) => ({
    plan: Object.fromEntries(
      state.controls.map((c) => [
        c.id,
        canonical(o.plan[c.id]) === canonical(state.proposed[c.id])
          ? 'keep'
          : `set:${canonical(o.plan[c.id])}`,
      ]),
    ),
    contractFitness: o.fitness,
    minimality:
      o.effort <= minimumEffort
        ? 1
        : Math.max(0, 1 - (o.effort - minimumEffort) / state.controls.length),
    complexity: o.effort / state.controls.length,
  }));
}
function strategyFitness(world: WorldState): Map<string, { fitness: number; complexity: number }> {
  const work = world.work,
    policy = work?.policy;
  if (!work || !policy) return new Map();
  const outcomes = work.decisionArchetypes.map((_, i) => runWorkStrategy(work, i));
  const ordered = outcomes
    .filter(
      (o) =>
        o.compatibleConsumers &&
        (!policy.rollbackRequired || o.rollbackSafe) &&
        o.interruption <= policy.maxInterruption &&
        o.cost <= policy.maxCost &&
        o.delay <= policy.maxDelay &&
        o.residualRisk <= policy.maxResidualRisk,
    )
    .sort(
      (a, b) =>
        a[policy.priority] - b[policy.priority] ||
        a.cost - b.cost ||
        a.delay - b.delay ||
        a.residualRisk - b.residualRisk,
    );
  const maxCost = Math.max(...outcomes.map((o) => o.cost));
  return new Map(
    outcomes.map((o) => [
      o.archetypeId,
      {
        fitness: ordered.includes(o) ? 1 - ordered.indexOf(o) * 0.18 : 0,
        complexity: o.cost / maxCost,
      },
    ]),
  );
}
/** Projection owns hidden semantic information; policy cannot receive an engine session. */
export function validationMetadata(item: ItemVariant, step: ItemStep): ValidationMetadata {
  const snapshot = item.generated;
  if (!snapshot) throw new Error('Synthetic harness requires generated semantic metadata');
  const world = snapshot.stepWorlds[step.id]!,
    truth = snapshot.stepTruths[step.id]!;
  const intents = snapshot.intents[step.id]!,
    strategy = strategyFitness(world);
  const controls: Record<string, ControlAlternative[]> = {};
  const operations =
    typeof world.radicals.failure.operationContexts === 'string'
      ? (JSON.parse(world.radicals.failure.operationContexts) as {
          caseId: string;
          healthy: boolean;
        }[])
      : [];
  const simulation =
    typeof world.radicals.failure.simulation === 'string'
      ? (JSON.parse(world.radicals.failure.simulation) as SimulationState)
      : null;
  for (const control of step.responseTask?.controls || []) {
    controls[control.id] = valuesOf(control).map((value) => {
      let coherence: number | undefined;
      let complexity = typeof value === 'number' ? Math.abs(value) : String(value).length / 80;
      if (control.id === 'strategy') {
        const action = world.work!.decisionArchetypes.find((a) => actionToken(a) === value)!;
        coherence = strategy.get(action.id)!.fitness;
        complexity = strategy.get(action.id)!.complexity;
      } else if (control.id === 'sourceRevision')
        coherence = Number(
          value === (world.work!.activeRevision === 0 ? 'revision-A' : 'revision-B'),
        );
      else if (control.id === 'transitionPrediction')
        coherence = Number(value === transitionPrediction(world.work!).prediction);
      else if (control.id === 'transitionExposure')
        coherence = Number(value === String(transitionPrediction(world.work!).interruption));
      else if (control.id === 'context' && simulation)
        coherence = Number(value === String(simulation.affectedContext));
      else if (/^operation\d+$/.test(control.id)) {
        const operation = operations[Number(control.id.slice(9)) - 1]!;
        coherence = Number(value === (operation.healthy ? 'keep' : operation.caseId));
      } else if (/^repair\d+$/.test(control.id)) {
        const index = Number(control.id.slice(6));
        const scope = world.radicals.failure[`scope${index}`];
        coherence = Number(value === (scope === undefined ? 'keep' : `repair:${scope}`));
      } else if (!simulation)
        throw new Error(`Unmapped semantic control: ${item.generated!.itemModelId}/${control.id}`);
      return {
        value,
        coherence: coherence ?? 0.5,
        complexity,
        misconception:
          control.id === 'strategy'
            ? 'unsafe_ordering'
            : control.id === 'sourceRevision'
              ? 'wrong_consistency_model'
              : 'wrong_causal_layer',
      };
    });
  }
  return {
    domain: snapshot.competencyDomain!,
    dimension: step.rubric.dimension,
    kind: intents[0]!.kind,
    requirements: world.work?.profile || gradeProfile(defaultBand(item.targetGrade)),
    changed: world.work?.changed || false,
    knownCause: world.work?.diagnosticMode === 'identified',
    alternatives: step.options.map((option) => {
      const intent = intents.find((i) => i.id === snapshot.optionIntents[option.id])!;
      const applicability = Object.entries(intent.applicability || {}).filter(
        ([key]) => typeof world.radicals.failure[key] !== 'string' || key !== 'simulation',
      );
      const causalCoherence =
        0.6 * Number(intent.predictsHazard === truth.hazard) +
        0.4 *
          (applicability.length
            ? mean(
                applicability.map(([key, value]) => Number(world.radicals.failure[key] === value)),
              )
            : Number(intent.availableUnder.includes(truth.hazard)));
      const action = world.work?.decisionArchetypes.find(
        (a) => intent.id === `${intent.kind}:${a.id}`,
      );
      return {
        id: option.id,
        hypothesis: intent.predictsHazard || intent.id,
        causalCoherence,
        misconception: intent.misconception,
        constraintFitness: action ? strategy.get(action.id)!.fitness : 1,
        complexity: action ? strategy.get(action.id)!.complexity : intent.guarantees.length / 4,
        archetype: action?.id || null,
      };
    }),
    controls,
    jointPlans: simulationPlans(item, world),
    evidence: item.artifacts
      .filter((a) => a.type !== 'architecture' && a.type !== 'topology')
      .map((a) => ({
        id: a.id,
        diagnosticValue: a.usefulness,
        discriminative:
          a.id === truth.bestDiagnosticArtifact || a.id === 'workflow' || a.id === 'strategy',
        symptomOnly: a.usefulness < 0.7,
      })),
  };
}

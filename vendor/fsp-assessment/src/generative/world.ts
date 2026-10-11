import type { TargetGrade } from '../adaptive/model.js';
import type {
  AnswerIntent,
  Fact,
  GroundTruth,
  ItemModel,
  SpecializationPack,
  WorldState,
} from './model.js';
import * as legacy from './legacy-world.js';
import type { DifficultyBand } from './difficulty.js';

/** Invoke a pack-owned world factory while retaining the established Backend implementation. */
export function buildWorld(
  pack: SpecializationPack,
  model: ItemModel,
  grade: TargetGrade,
  seed: number,
  band?: DifficultyBand,
): WorldState {
  return model.runtime
    ? model.runtime.createWorld(pack, model, grade, seed, band)
    : legacy.buildWorld(pack, model, grade, seed);
}
/** Derive the oracle from the immutable world through its registered model. */
export function deriveGroundTruth(model: ItemModel, world: WorldState): GroundTruth {
  return model.runtime
    ? model.runtime.deriveTruth(model, world)
    : legacy.deriveGroundTruth(model, world);
}
/** Recompute the registered model after a genuine change of causal conditions. */
export function mutateWorld(model: ItemModel, world: WorldState, seed: number): WorldState {
  return model.runtime
    ? model.runtime.mutateWorld(model, world, seed)
    : legacy.mutateWorld(model, world, seed);
}
/** Obtain the model's logical topology without interpreting professional components. */
export function worldTopology(model: ItemModel, grade: TargetGrade, facts: Record<string, Fact>) {
  return model.runtime
    ? model.runtime.topology(model, grade, facts)
    : legacy.worldTopology(model, grade, facts);
}
/** Obtain semantic alternatives from the registered domain runtime. */
export function buildIntents(
  model: ItemModel,
  world: WorldState,
  kind: AnswerIntent['kind'],
  seed: number,
): AnswerIntent[] {
  return model.runtime
    ? model.runtime.createIntents(model, world, kind, seed)
    : legacy.buildIntents(model, world, kind, seed);
}
/** Shared scoring interprets goals and applicability, never technology or role names. */
export function evaluateIntent(
  intent: AnswerIntent,
  world: WorldState,
  truth: GroundTruth,
): number {
  const applicable =
    !intent.applicability ||
    Object.entries(intent.applicability).every(
      ([name, value]) => world.radicals.failure[name] === value,
    );
  const fulfilled = truth.requirements.every((requirement) =>
    intent.guarantees.includes(requirement),
  );
  if (
    intent.predictsHazard === truth.hazard &&
    intent.availableUnder.includes(truth.hazard) &&
    applicable &&
    (!(
      ['remediation', 'adaptation'].includes(intent.kind) ||
      (world.work?.policy && ['negative_guarantee', 'critical_assumption'].includes(intent.kind))
    ) ||
      fulfilled)
  )
    return 1;
  return intent.partialCredit || 0;
}

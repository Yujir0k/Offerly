import type { Artifact } from '../adaptive/model.js';
import type { GroundTruth, ItemModel, WorldState } from './model.js';
import * as legacy from './legacy-render.js';
export { templateBlocks, templateCompatible } from './legacy-render.js';

/** Render only the pack's registered scenario projection. */
export function renderContext(model: ItemModel, world: WorldState, truth: GroundTruth) {
  return model.runtime
    ? model.runtime.renderScenario(model, world, truth)
    : legacy.renderContext(model, world, truth);
}
/** Render evidence through its domain factory; the core does not interpret artifact contents. */
export function generateArtifacts(
  model: ItemModel,
  world: WorldState,
  truth: GroundTruth,
): Artifact[] {
  return model.runtime
    ? model.runtime.createArtifacts(model, world, truth)
    : legacy.generateArtifacts(model, world, truth);
}

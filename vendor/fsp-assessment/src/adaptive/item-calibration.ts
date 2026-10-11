import type { GeneratedItem } from '../generative/model.js';
import type { CompetencyDimension, TargetGrade } from './model.js';
import type { DifficultyBand } from '../generative/difficulty.js';
import { calibrationData } from './item-calibration-data.js';
import { difficultyPoints } from './scoring.js';

export interface ItemCalibrationCell {
  track: string;
  grade: TargetGrade;
  model: string;
  band: DifficultyBand;
  primaryDimension: CompetencyDimension;
  dimension: CompetencyDimension;
  n: number;
  ownScore: number;
  lowerScore: number;
  discrimination: number;
  pairStandardError: number;
  lowerProfile: string;
}

const key = (
  track: string,
  grade: TargetGrade,
  model: string,
  band: DifficultyBand,
  primary: CompetencyDimension,
  dimension: CompetencyDimension,
) => [track, grade, model, band, primary, dimension].join('/');
const cells = new Map(
  calibrationData.map((cell) => [
    key(cell.track, cell.grade, cell.model, cell.band, cell.primaryDimension, cell.dimension),
    cell,
  ]),
);
const referenceKey = (cell: ItemCalibrationCell) =>
  [cell.track, cell.grade, cell.band, cell.primaryDimension, cell.dimension].join('/');
const references = new Map<string, { sum: number; n: number }>();
for (const cell of calibrationData) {
  const previous = references.get(referenceKey(cell)) ?? { sum: 0, n: 0 };
  references.set(referenceKey(cell), { sum: previous.sum + cell.ownScore, n: previous.n + 1 });
}

/** Read a frozen synthetic estimate; it is not a human difficulty/IRT parameter. */
export function itemCalibration(
  item: GeneratedItem,
  dimension: CompetencyDimension,
  primary = item.steps[0]!.rubric.dimension,
): ItemCalibrationCell | undefined {
  const band = item.generated.difficulty?.band;
  if (!band) return undefined;
  return cells.get(
    key(
      item.specialization,
      item.targetGrade,
      item.generated.itemModelId,
      band,
      primary,
      dimension,
    ),
  );
}

/** Compare expected core competency scores against fixed role/band reference means. */
export function calibratedFormDistance(form: {
  items: GeneratedItem[];
  boundaryPool: GeneratedItem[];
  specialization: string;
}): number {
  if (!calibrationData.length) return 0;
  const items = [...form.items];
  const target = items[0]!.targetGrade;
  if (target === 'Senior') {
    const probe = form.boundaryPool
      .filter(
        (item) =>
          item.generated.difficulty?.band === 'senior_core' &&
          item.steps[0]!.rubric.dimension === 'engineering_judgment' &&
          (item.generated.worldState.work?.consequences.length ?? 0) > 1,
      )
      .sort((a, b) => a.id.localeCompare(b.id))[0];
    if (probe) items.push(probe);
  }
  let distance = 0;
  for (const dimension of [
    'diagnosis',
    'correctness',
    'engineering_judgment',
    'adaptation',
  ] as const) {
    let score = 0,
      reference = 0,
      weight = 0;
    for (const item of items) {
      if (
        !item.steps.some(
          (s) => s.rubric.dimension === dimension || s.rubric.executionDimension === dimension,
        )
      )
        continue;
      const cell = itemCalibration(item, dimension, dimension) ?? itemCalibration(item, dimension);
      if (!cell) continue;
      const peers = references.get(referenceKey(cell))!;
      const points = difficultyPoints(target, cell.band);
      score += cell.ownScore * points;
      reference += (peers.sum / peers.n) * points;
      weight += points;
    }
    if (weight) distance += Math.abs(score - reference) / weight;
  }
  return distance;
}

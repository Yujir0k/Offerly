import type { DifficultyBand } from '../generative/difficulty.js';
import { dimensions, type AssessmentSession, type TargetGrade } from './model.js';

/** Author-defined relative points within a target grade; independent of information value. */
export function difficultyPoints(target: TargetGrade, band: DifficultyBand): number {
  const ordered: DifficultyBand[] = [
    'junior_core',
    'junior_upper',
    'middle_lower',
    'middle_core',
    'middle_upper',
    'senior_lower',
    'senior_core',
  ];
  const rank = ordered.indexOf(band);
  if (rank < 0) throw new Error(`Unknown difficulty band: ${band}`);
  // Overlap questions are the floor of the requested assessment, even when
  // they were the ceiling of the preceding grade. Never reverse difficulty.
  if (target === 'Junior') return rank === 0 ? 1 : 2;
  if (target === 'Middle') return rank < 3 ? 1 : rank === 3 ? 1.5 : 2;
  return rank < 5 ? 1 : rank === 5 ? 1.5 : 2;
}

/** Return comparable maximum core points per competency, counting correlated item steps once. */
export function corePointBudget(session: AssessmentSession) {
  return Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      session.items
        .filter((item) => item.stage !== 'boundary')
        .reduce((sum, item) => {
          const steps = item.variant.steps.filter(
            (step) =>
              step.rubric.dimension === dimension ||
              (session.config.enhancements?.separateExecution &&
                step.rubric.executionDimension === dimension),
          );
          return (
            sum +
            (steps.length ? Math.max(...steps.map((step) => step.rubric.resultWeight ?? 1)) : 0)
          );
        }, 0),
    ]),
  );
}

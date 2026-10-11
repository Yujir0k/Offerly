import type { AssessmentGradeConfig, TargetGrade } from './model.js';

export const assessmentVersion = 'backend-multistage-1.0.0';
/** Initial seeded calibration; replace only after an expert panel and empirical validation. */
export const gradeConfigs: Record<TargetGrade, AssessmentGradeConfig> = {
  Junior: {
    version: 'junior-1',
    scoringVersion: 'evidence-1',
    targetGrade: 'Junior',
    weights: { diagnosis: 0.3, correctness: 0.4, engineering_judgment: 0.2, adaptation: 0.1 },
    cutScore: 0.6,
    minimumCoverage: 1,
    hardCapMs: 20 * 60_000,
    maxBoundaryItems: 3,
    uncertainty: { base: 0.23, floor: 0.035, contradiction: 0.13 },
  },
  Middle: {
    version: 'middle-1',
    scoringVersion: 'evidence-1',
    targetGrade: 'Middle',
    weights: { diagnosis: 0.3, correctness: 0.3, engineering_judgment: 0.25, adaptation: 0.15 },
    cutScore: 0.65,
    minimumCoverage: 1,
    hardCapMs: 20 * 60_000,
    maxBoundaryItems: 3,
    uncertainty: { base: 0.23, floor: 0.035, contradiction: 0.13 },
  },
  Senior: {
    version: 'senior-1',
    scoringVersion: 'evidence-1',
    targetGrade: 'Senior',
    weights: { diagnosis: 0.2, correctness: 0.25, engineering_judgment: 0.25, adaptation: 0.3 },
    cutScore: 0.72,
    minimumCoverage: 1,
    hardCapMs: 20 * 60_000,
    maxBoundaryItems: 3,
    uncertainty: { base: 0.23, floor: 0.035, contradiction: 0.13 },
  },
};

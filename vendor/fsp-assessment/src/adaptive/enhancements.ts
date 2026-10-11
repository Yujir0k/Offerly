import type { AssessmentGradeConfig } from './model.js';

/** Frozen in each new session; historical sessions retain their own evaluation rules. */
export const activeEnhancements: NonNullable<AssessmentGradeConfig['enhancements']> = {
  boundaryByConstruct: true,
  targetedVerification: true,
  separateExecution: true,
  seniorCoreProbe: true,
  honestRecommendation: true,
  resolveUncertainDeficits: true,
  discriminatingBoundary: true,
};

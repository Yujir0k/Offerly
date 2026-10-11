import type { TargetGrade, Stage, CompetencyDimension } from '../adaptive/model.js';
import type { AnswerIntent } from './model.js';

export type DifficultyBand =
  | 'junior_core'
  | 'junior_upper'
  | 'middle_lower'
  | 'middle_core'
  | 'middle_upper'
  | 'senior_lower'
  | 'senior_core';
export interface GradeProfile {
  scope: 'bounded' | 'shared' | 'portfolio';
  ambiguity: 1 | 2 | 3;
  causalDepth: 1 | 2 | 3;
  evidenceComplexity: 1 | 2 | 3;
  constraintComplexity: 1 | 2 | 3;
  decisionResponsibility: 'correctness' | 'coordination' | 'policy';
  tradeoffComplexity: 1 | 2 | 3;
  evolutionComplexity: 1 | 2 | 3;
  consequenceRadius: 'bounded' | 'shared' | 'portfolio';
  secondOrderEffects: 1 | 2 | 3;
}
export interface StepRecipe {
  id: string;
  kind: AnswerIntent['kind'];
  dimension: CompetencyDimension;
  exploration?: boolean;
  changed?: boolean;
  prompt?: string;
}
export interface AssessmentRecipe {
  anchorBands: DifficultyBand[];
  stages: Partial<Record<Stage, StepRecipe[]>>;
  boundaryBands: DifficultyBand[];
  workForm: string;
}
export interface GradeConfiguration {
  profile: GradeProfile;
  radicals: string[];
  responsibility: string;
  typicalDecisions: string[];
  professionalResponsibility?: string;
  requiredReasoning?: string;
  uniqueRadicals?: string[];
  violationCountRange?: [number, number];
  calibrated: false;
}
export interface DifficultyMetadata {
  gradeTarget: TargetGrade;
  band: DifficultyBand;
  profile: GradeProfile;
  rationale: string;
  structuralEvidence: {
    localContext: boolean;
    interactingWorkflow: boolean;
    correlatedSources: boolean;
    technicallyValidStrategies: number;
    feasibleStrategies: number;
    strategyChangesUnderConstraints: boolean;
    secondOrderConsequences: string[];
  };
}

/** Bands describe responsibility and overlap; defect counts never determine them. */
export function reasoningGrade(band: DifficultyBand): TargetGrade {
  return band.startsWith('junior') ? 'Junior' : band.startsWith('middle') ? 'Middle' : 'Senior';
}
/** Default item band before a pack selects its floor/core/ceiling position. */
export function defaultBand(grade: TargetGrade, stage?: Stage): DifficultyBand {
  return grade === 'Junior'
    ? stage === 'boundary'
      ? 'junior_upper'
      : 'junior_core'
    : grade === 'Middle'
      ? stage === 'boundary'
        ? 'middle_upper'
        : 'middle_core'
      : stage === 'boundary'
        ? 'senior_lower'
        : 'senior_core';
}
/** Expert-authored configurations, not a scalar difficulty ladder.
 * Each row describes a different work form. Values are ordinal, not calibrated.
 * Diagnostic ambiguity is independent of the responsibility of the decision.
 */
const forms: Record<TargetGrade, GradeProfile[]> = {
  Junior: [
    {
      scope: 'bounded',
      ambiguity: 1,
      causalDepth: 2,
      evidenceComplexity: 2,
      constraintComplexity: 1,
      decisionResponsibility: 'correctness',
      tradeoffComplexity: 1,
      evolutionComplexity: 1,
      consequenceRadius: 'bounded',
      secondOrderEffects: 1,
    },
    {
      scope: 'bounded',
      ambiguity: 2,
      causalDepth: 1,
      evidenceComplexity: 1,
      constraintComplexity: 2,
      decisionResponsibility: 'coordination',
      tradeoffComplexity: 1,
      evolutionComplexity: 1,
      consequenceRadius: 'shared',
      secondOrderEffects: 1,
    },
    {
      scope: 'shared',
      ambiguity: 1,
      causalDepth: 1,
      evidenceComplexity: 2,
      constraintComplexity: 2,
      decisionResponsibility: 'correctness',
      tradeoffComplexity: 2,
      evolutionComplexity: 1,
      consequenceRadius: 'bounded',
      secondOrderEffects: 2,
    },
  ],
  Middle: [
    {
      scope: 'shared',
      ambiguity: 1,
      causalDepth: 2,
      evidenceComplexity: 2,
      constraintComplexity: 2,
      decisionResponsibility: 'coordination',
      tradeoffComplexity: 2,
      evolutionComplexity: 2,
      consequenceRadius: 'shared',
      secondOrderEffects: 2,
    },
    {
      scope: 'bounded',
      ambiguity: 3,
      causalDepth: 3,
      evidenceComplexity: 3,
      constraintComplexity: 1,
      decisionResponsibility: 'correctness',
      tradeoffComplexity: 1,
      evolutionComplexity: 1,
      consequenceRadius: 'bounded',
      secondOrderEffects: 2,
    },
    {
      scope: 'portfolio',
      ambiguity: 2,
      causalDepth: 2,
      evidenceComplexity: 2,
      constraintComplexity: 3,
      decisionResponsibility: 'coordination',
      tradeoffComplexity: 2,
      evolutionComplexity: 1,
      consequenceRadius: 'portfolio',
      secondOrderEffects: 2,
    },
  ],
  Senior: [
    {
      scope: 'shared',
      ambiguity: 1,
      causalDepth: 2,
      evidenceComplexity: 2,
      constraintComplexity: 3,
      decisionResponsibility: 'policy',
      tradeoffComplexity: 3,
      evolutionComplexity: 3,
      consequenceRadius: 'portfolio',
      secondOrderEffects: 3,
    },
    {
      scope: 'bounded',
      ambiguity: 3,
      causalDepth: 3,
      evidenceComplexity: 3,
      constraintComplexity: 2,
      decisionResponsibility: 'coordination',
      tradeoffComplexity: 2,
      evolutionComplexity: 2,
      consequenceRadius: 'shared',
      secondOrderEffects: 3,
    },
    {
      scope: 'portfolio',
      ambiguity: 2,
      causalDepth: 1,
      evidenceComplexity: 2,
      constraintComplexity: 3,
      decisionResponsibility: 'policy',
      tradeoffComplexity: 3,
      evolutionComplexity: 3,
      consequenceRadius: 'portfolio',
      secondOrderEffects: 2,
    },
  ],
};

/** A band publishes an allowed region of complete configurations; no dimension determines grade. */
export function allowedProfiles(band: DifficultyBand): GradeProfile[] {
  const profiles = structuredClone(forms[reasoningGrade(band)]);
  // The neighbouring bands adjust a work requirement, never every dimension together.
  if (band === 'junior_upper')
    profiles.forEach((profile) => {
      profile.causalDepth = 2;
    });
  if (band === 'middle_lower')
    profiles.forEach((profile) => {
      profile.evolutionComplexity = 1;
    });
  if (band === 'middle_upper')
    profiles.forEach((profile) => {
      profile.tradeoffComplexity = 3;
      profile.decisionResponsibility = 'policy';
    });
  if (band === 'senior_lower')
    profiles.forEach((profile) => {
      profile.evolutionComplexity = 2;
    });
  return profiles;
}

/** Select an authored work form. Runtime stores this selection and renders its evidence contract. */
export function gradeProfile(band: DifficultyBand, form = 0): GradeProfile {
  const profiles = allowedProfiles(band);
  return profiles[((form % profiles.length) + profiles.length) % profiles.length]!;
}

export function profileAllowed(band: DifficultyBand, profile: GradeProfile): boolean {
  return allowedProfiles(band).some((allowed) =>
    (Object.keys(allowed) as (keyof GradeProfile)[]).every((key) => allowed[key] === profile[key]),
  );
}
/** Describe floor and ceiling probes while keeping the declared assessment grade immutable. */
export function anchorBands(grade: TargetGrade): DifficultyBand[] {
  return grade === 'Junior'
    ? ['junior_core', 'junior_core', 'junior_upper', 'junior_upper']
    : grade === 'Middle'
      ? ['junior_upper', 'middle_lower', 'middle_core', 'middle_upper']
      : ['middle_upper', 'senior_lower', 'senior_core', 'senior_core'];
}

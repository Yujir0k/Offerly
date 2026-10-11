import type { ArtifactType, GeneratedSnapshot, Topology } from '../generative/model.js';
import type { LabControl, Plan } from '../domain.js';
export type TargetGrade = 'Junior' | 'Middle' | 'Senior';
export type Specialization = string;
export const dimensions = [
  'diagnosis',
  'correctness',
  'engineering_judgment',
  'adaptation',
] as const;
export type CompetencyDimension = (typeof dimensions)[number];
export type Stage = 'anchors' | 'incident' | 'review' | 'boundary';
export type ItemType =
  'situational_choice' | 'artifact_interpretation' | 'design_review' | 'constraint_mutation';
export interface AssessmentGradeConfig {
  version: string;
  scoringVersion: string;
  targetGrade: TargetGrade;
  weights: Record<CompetencyDimension, number>;
  cutScore: number;
  minimumCoverage: number;
  hardCapMs: number;
  maxBoundaryItems: number;
  boundarySelection?: 'largest-margin' | 'weighted-information';
  enhancements?: {
    boundaryByConstruct?: boolean;
    targetedVerification?: boolean;
    separateExecution?: boolean;
    seniorCoreProbe?: boolean;
    honestRecommendation?: boolean;
    resolveUncertainDeficits?: boolean;
    discriminatingBoundary?: boolean;
  };
  boundaryCalibration?: {
    source: string;
    byItem: Record<
      string,
      Partial<
        Record<
          CompetencyDimension,
          {
            n: number;
            ownScore: number;
            lowerScore: number;
            discrimination: number;
          }
        >
      >
    >;
  };
  uncertainty: { base: number; floor: number; contradiction: number };
}
export interface AnswerOption {
  id: string;
  text: string;
}
export interface ScoringRubric {
  dimension: CompetencyDimension;
  informationWeight: number;
  resultWeight?: number;
  executionDimension?: CompetencyDimension;
  scores: Record<string, number>;
  rationale: string;
  expertExpectedSuccessRate: number;
  expertRatings: number[];
}
export interface Artifact {
  id: string;
  label: string;
  content: string;
  usefulness: number;
  type?: ArtifactType;
  data?: unknown;
}
export interface ItemStep {
  requiredEvidenceSources?: number;
  responseTask?: { title: string; instructions: string; controls: LabControl[] };
  id: string;
  type: ItemType;
  prompt: string;
  context: string;
  scenario?: {
    context: string;
    observations: string[];
    constraints: string[];
    assumptions: string[];
  };
  resetContext?: string;
  options: AnswerOption[];
  rubric: ScoringRubric;
  exploration?: boolean;
}
export interface ItemFamily {
  id: string;
  concept: string;
  version: string;
  specialization: Specialization;
  targetGrade: TargetGrade;
  stage: Stage;
  difficultyBand: string;
  measuredConstruct: string;
  contentTags: string[];
  approved: boolean;
  expertCalibration: {
    status: 'provisional';
    expectedSuccessRate: number;
    expertRatings: number[];
  };
  steps: ItemStep[];
  artifacts: Artifact[];
  architecture: string[];
}
export interface ItemVariant extends ItemFamily {
  variantSeed: number;
  parameters: Record<string, string | number>;
  generated?: GeneratedSnapshot;
  topology?: Topology;
}
export interface SessionItem {
  variant: ItemVariant;
  stage: Stage;
}
export interface ScoreContribution {
  dimension: CompetencyDimension;
  value: number;
  weight: number;
  resultWeight?: number;
  observation: string;
  familyId: string;
  source: 'answer' | 'evidence' | 'execution';
}
export interface CandidateResponse {
  execution?: Plan;
  itemId: string;
  stepId: string;
  optionId: string;
  at: string;
  responseTimeMs: number;
  contributions: ScoreContribution[];
}
export interface EvidenceSelection {
  itemId: string;
  stepId: string;
  artifactId: string;
  order: number;
  at: string;
  elapsedMs: number;
  usefulness: number;
  artifactType?: ArtifactType;
  diagnosticValue?: number;
}
export interface DimensionResult {
  dimension: CompetencyDimension;
  score: number;
  coverage: number;
  effectiveEvidence: number;
  margin: number;
  label: 'Strong' | 'Sufficient' | 'Uncertain' | 'Needs evidence';
  evidence: { familyId: string; source: string; value: number; explanation: string }[];
}
export interface DecisionBand {
  estimatedScore: number;
  lowerBound: number;
  upperBound: number;
  margin: number;
  cutScore: number;
  method: 'expert-rule-decision-band';
}
export interface AssessmentResult {
  assessmentStatus?: 'confirmed' | 'below-standard' | 'insufficient-evidence';
  targetGrade: TargetGrade;
  specialization: Specialization;
  decision: 'CONFIRMED' | 'NOT_CONFIRMED';
  title: string;
  reason: string;
  stopReason: 'above_band' | 'below_band' | 'boundary_exhausted' | 'timeout' | 'competency_deficit';
  dimensions: DimensionResult[];
  band: DecisionBand;
  contentTags: string[];
  recommendation: TargetGrade | null;
  assessmentVersion: string;
  gradeConfigVersion: string;
  scoringConfigVersion: string;
}
export interface CandidateResult {
  assessmentStatus?: AssessmentResult['assessmentStatus'];
  targetGrade: TargetGrade;
  specialization: Specialization;
  decision: AssessmentResult['decision'];
  title: string;
  reason: string;
  stopReason: AssessmentResult['stopReason'];
  dimensions: { dimension: CompetencyDimension; label: string; description: string }[];
  contentTags: string[];
  recommendation: TargetGrade | null;
}
export interface AssessmentDefinition {
  version: string;
  specialization: Specialization;
  families: ItemFamily[];
}
export interface AssessmentSession {
  packPresentation?: import('../generative/model.js').PackPresentation;
  id: string;
  candidateId: string;
  specialization: Specialization;
  targetGrade: TargetGrade;
  seed: number | string;
  assessmentVersion: string;
  config: AssessmentGradeConfig;
  items: SessionItem[];
  boundaryPool: ItemVariant[];
  cursor: { item: number; step: number };
  responses: CandidateResponse[];
  evidenceSelections: EvidenceSelection[];
  contributions: ScoreContribution[];
  startedAt: string;
  deadlineAt: string;
  stepStartedAt: string;
  finishedAt: string | null;
  state: 'active' | 'completed';
  stageTimeMs: Record<Stage, number>;
  result: AssessmentResult | null;
  generation?: {
    generatorVersion: string;
    packVersion: string;
    exposureSnapshot: string[];
    exposureContext?: import('../generative/model.js').ExposureRecord[];
    selectionAttempt?: number;
    fallbackUsed?: boolean;
    poolSnapshot?: string[];
  };
}
export interface SessionView {
  packPresentation?: import('../generative/model.js').PackPresentation;
  id: string;
  specialization: Specialization;
  specializationName: string;
  targetGrade: TargetGrade;
  state: AssessmentSession['state'];
  startedAt: string;
  deadlineAt: string;
  serverNow: string;
  finishedAt: string | null;
  stage: Stage | null;
  coreCompleted: boolean;
  boundaryUsed: boolean;
  progress: {
    answered: number;
    coreCompletedSteps: number;
    coreTotalSteps: number;
    remainingMin: number;
    remainingMax: number;
    stages: {
      stage: Stage;
      completed: number;
      total: number;
      status: 'complete' | 'active' | 'upcoming' | 'optional';
    }[];
  };
  current: {
    itemId: string;
    step: Omit<ItemStep, 'rubric'> & { difficultyPoints?: number };
    architecture: string[];
    topology?: Topology;
    artifacts: { id: string; type?: ArtifactType; label: string; content: string | null }[];
  } | null;
  result: CandidateResult | null;
}
export type ProfileSessionView = Omit<SessionView, 'result'> & { result: AssessmentResult | null };

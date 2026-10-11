import type { CompetencyDimension, SessionView, TargetGrade } from '../adaptive/model.js';
import type { GradeProfile } from '../generative/difficulty.js';
import type { Plan, PlanValue } from '../domain.js';

export const syntheticPolicyVersion = 'synthetic-policy-1.0.0';
export const behaviourKeys = [
  'evidenceSelection',
  'causalReasoning',
  'uncertaintyHandling',
  'constraintTracking',
  'misconceptionResistance',
] as const;
export type Behaviour = (typeof behaviourKeys)[number];
export type PolicyMode =
  | 'competency'
  | 'random'
  | 'memorizer'
  | 'keyword'
  | 'overengineer'
  | 'specialist'
  | 'weak-adaptation';
export interface SyntheticCandidateProfile {
  id: string;
  latentClass: TargetGrade | 'borderline' | 'adversarial';
  order: number | null;
  mode: PolicyMode;
  dimensions: Record<CompetencyDimension, number>;
  domainSkills: Record<string, number>;
  behaviours: Record<Behaviour, number>;
  misconceptionSusceptibility: Record<string, number>;
  consistency: number;
  noise: number;
  speed: number;
  specialistDomain?: string;
}
export type PolicyProfile = Omit<SyntheticCandidateProfile, 'latentClass' | 'order'>;
export type VisibleStep = NonNullable<SessionView['current']>['step'];
export interface SemanticAlternative {
  id: string;
  causalCoherence: number;
  hypothesis: string;
  misconception: string | null;
  constraintFitness: number;
  complexity: number;
  archetype: string | null;
}
export interface ControlAlternative {
  value: PlanValue;
  coherence: number;
  complexity: number;
  misconception: string;
}
export interface PlanAlternative {
  plan: Plan;
  contractFitness: number;
  minimality: number;
  complexity: number;
}
/** Allowlist boundary: no rubric, production weights, cut, band or final result. */
export interface ValidationMetadata {
  domain: string;
  dimension: CompetencyDimension;
  kind: string;
  requirements: GradeProfile;
  changed: boolean;
  knownCause: boolean;
  alternatives: SemanticAlternative[];
  controls: Record<string, ControlAlternative[]>;
  jointPlans: PlanAlternative[];
  evidence: {
    id: string;
    diagnosticValue: number;
    discriminative: boolean;
    symptomOnly: boolean;
  }[];
}
export interface CandidateMemory {
  hypothesis: string | null;
  hypothesisRevisions: number;
  opened: string[];
  previousPlan: Plan | null;
  previousArchetype: string | null;
}
export interface CandidateAction {
  optionId: string;
  execution?: Plan;
  evidenceOrder: string[];
  elapsedMs: number;
  localSuccessProbability: number;
  hypothesis: string | null;
  revisedHypothesis: boolean;
  misconception: string | null;
}

export type Grade = 'Junior' | 'Middle' | 'Senior';
export type AccountRole = 'candidate' | 'employer' | 'admin';
export type ToolMode = 'closed' | 'docs' | 'hint' | 'local' | 'extended';
export type LabKind = 'classification' | 'retrieval' | 'events';
export interface Skill {
  id: string;
  name: string;
  description: string;
}
export interface Track {
  id: string;
  name: string;
  skills: string[];
  lab: LabKind;
  focus: string;
}
export interface Need {
  id: string;
  employerId: string;
  title: string;
  trackId: string;
  grade: Grade;
  stack: string[];
  required: string[];
  weights: Record<string, number>;
  toolMode: ToolMode;
  salaryMin: number;
  salaryMax: number;
  description: string;
  familyIds?: string[];
}
export type PlanValue = string | number | string[];
export type Plan = Record<string, PlanValue>;
export type LabRow = Record<string, string | number | boolean | null>;
export interface LabData {
  rows: LabRow[];
  parameters: Record<string, string | number | boolean>;
}
export interface LabControl {
  id: string;
  label: string;
  help: string;
  type: 'select' | 'number' | 'multiselect';
  options: { value: string; label: string }[];
  values: number[];
  initial: PlanValue;
}
export interface SpecializedLab {
  kind: string;
  controls: LabControl[];
  data: LabData;
  change: string;
  measuredSkills: string[];
  rubric: string[];
}
export interface Question {
  id: string;
  prompt: string;
  scenario?: string;
  options: { id: string; text: string }[];
  skill: string;
  points: number;
}
export interface Artifact {
  name: string;
  content: string;
}
export interface DataRow {
  id: number;
  time: number;
  group: number;
  label: number;
  values: Record<string, number>;
}
export interface Document {
  id: string;
  text: string;
  current: boolean;
}
export interface RetrievalQuery {
  text: string;
  expectedId: string | null;
}
export interface EventRecord {
  id: string;
  entity: string;
  version: number;
  value: number;
  arrival: number;
}
export interface Oracle {
  answers: Record<string, string>;
  leakedFeature: string;
  validFeatures: string[];
  requiredSplit: string;
  eventStrategy: string;
  retrievalPolicy: string;
  specialized?: { referencePlans: [Plan, Plan]; mutants: [Plan[], Plan[]]; changedData: LabData };
  engineering?: { defects: Record<string, string> };
}
export type DiagnosticKind = 'logs' | 'metrics' | 'explain' | 'alternative';
export interface FspStatus {
  id: string | null;
  verified: boolean;
  competition?: string;
  topPercent?: number;
  verifiedAt?: string;
  modeled?: boolean;
  achievements?: string[];
}
export interface ExpressChoice {
  id: string;
  title: string;
  comment: string;
  plan: Plan;
}
export interface ExpressSpec {
  durationMinutes: [5, 7];
  strategies: ExpressChoice[];
  adaptations: ExpressChoice[];
  invalidRequests: { name: string; body: LabRow | null }[];
  focus: string;
  nodeControls: Record<string, string[]>;
}
export interface EngineeringCase {
  version: 'engineering-v1' | 'express-v1';
  benchmark: 'common' | 'legacy' | 'claimed';
  business: string;
  artifactSource: 'deterministic-template' | 'llm';
  nodes: { id: string; name: string; code: string; description: string }[];
  defectTypes: { id: string; label: string }[];
  decisions: LabControl[];
  express?: ExpressSpec;
  edge: {
    title: string;
    description: string;
    rps: number;
    durationSeconds: number;
    delaySeconds: number;
    failurePercent: number;
    responseBudgetSeconds: number;
    queueCapacity: number;
    data: LabData;
    decision: LabControl;
  };
}
export interface EngineeringProgress {
  audit: Record<string, string>;
  auditSaved: boolean;
  plans: Partial<Record<'main' | 'edge', Plan>>;
  diagnostics: {
    nodeId: string;
    kind: DiagnosticKind;
    question: string;
    text: string;
    at: string;
  }[];
}
export interface Maturity {
  rootCauseAccuracy: number;
  aiEfficiency: number | null;
  aiIterations: number;
  aiDepth: number;
  edgeCaseHandling: number;
  strategyQuality: number;
  theoryAccuracy: number;
}
export interface Variant {
  id: string;
  familyId: string;
  version: string;
  seed: number;
  trackId: string;
  grade: Grade;
  title: string;
  context: string;
  status: 'technical';
  questions: Question[];
  artifacts: Artifact[];
  rows: DataRow[];
  documents: Document[];
  queries: RetrievalQuery[];
  events: EventRecord[];
  oracle: Oracle;
  complexity: { steps: number; defects: number; distractors: number; rows: number };
  stageModes: ToolMode[];
  lab?: SpecializedLab;
  engineering?: EngineeringCase;
}
export interface ExperimentInput {
  features?: string[];
  split?: string;
  strategy?: string;
  topK?: number;
  policy?: string;
  plan?: Plan;
}
export interface Experiment {
  id: string;
  stage: number;
  input: ExperimentInput;
  metrics: Record<string, number>;
  checks: Record<string, boolean>;
  explanation: string;
  at: string;
  engineering?: true;
  trace?: string[];
}
export interface Evidence {
  skillId: string;
  score: number;
  source: string;
  explanation: string;
}
export interface AssessmentResult {
  score: number;
  proposedGrade: Grade | null;
  status: 'provisional' | 'review_required' | 'not_confirmed';
  evidence: Evidence[];
  feedback: string[];
  rubricVersion: string;
  maturity?: Maturity;
  maxScore?: number;
}
export interface Assessment {
  id: string;
  candidateId: string;
  needId: string | null;
  sessionId?: string;
  expertReview?: { decision: 'approved' | 'needs_revision'; notes: string; at: string } | null;
  variant: Variant;
  stage: number;
  state: 'active' | 'submitted' | 'archived';
  experiments: Experiment[];
  answers: Record<string, string>;
  recommendation: string;
  createdAt: string;
  submittedAt: string | null;
  result: AssessmentResult | null;
  engineeringProgress?: EngineeringProgress;
}

export interface AssessmentSession {
  id: string;
  candidateId: string;
  trackId: string;
  grade: Grade;
  needId: string | null;
  assessmentIds: string[];
  createdAt: string;
  submittedAt?: string;
  state: 'active' | 'submitted' | 'archived';
  format?: 'engineering-v1' | 'express-v1';
}

export interface SessionView extends AssessmentSession {
  assessments: Assessment[];
}
export interface CustomCase {
  id: string;
  employerId: string;
  title: string;
  trackId: string;
  skills: string[];
  context: string;
  deliverable: string;
  constraints: string;
  materials: Artifact[];
  questions: Question[];
  answers: Record<string, string>;
  variations: string[];
  rubric: string;
  mode: ToolMode;
  status: 'draft' | 'technical' | 'pilot';
}
export const grades: Grade[] = ['Junior', 'Middle', 'Senior'];
export const modes: ToolMode[] = ['closed', 'docs', 'hint', 'local', 'extended'];

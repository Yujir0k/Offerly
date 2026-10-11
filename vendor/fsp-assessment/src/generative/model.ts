import type {
  Artifact,
  CompetencyDimension,
  ItemVariant,
  Stage,
  TargetGrade,
} from '../adaptive/model.js';
import type {
  AssessmentRecipe,
  DifficultyBand,
  DifficultyMetadata,
  GradeConfiguration,
} from './difficulty.js';
import type { GradeWorkWorld } from './qualitative-runtime.js';

export type ArtifactType =
  | 'architecture'
  | 'code'
  | 'diff'
  | 'logs'
  | 'metrics'
  | 'trace'
  | 'db'
  | 'queue'
  | 'network'
  | 'deployment'
  | 'table'
  | 'chart'
  | 'console'
  | 'browser_state'
  | 'code_diff'
  | 'topology'
  | 'timeline'
  | 'schema'
  | 'dag'
  | 'dom'
  | 'accessibility_tree'
  | 'test_run'
  | 'ci_log'
  | 'model_metrics'
  | 'feature_distribution'
  | 'experiment_table'
  | 'security_policy'
  | 'http_exchange'
  | 'lifecycle'
  | 'crash_report'
  | 'retrieval_results'
  | 'tool_trace'
  | 'model_registry'
  | 'lineage';
export interface Topology {
  nodes: { id: string; label: string; state: string; highlightable: boolean }[];
  edges: { from: string; to: string; label: string }[];
}
export type Fact = string | number | boolean;
export type CompetencyDomain = string;
export interface StageBlueprint {
  id: Stage;
  label: string;
  purpose: string;
  allowedItemTypes: string[];
  minSteps: number;
  maxSteps: number;
  measuredDimensions: CompetencyDimension[];
}
export interface PackPresentation {
  evidenceVisibility: 'all-stages';
  groupId: string;
  groupName: string;
  trackId: string;
  role: string;
  dimensions: Record<CompetencyDimension, string>;
  domains: { id: string; label: string; description: string }[];
  stages: StageBlueprint[];
  gradeDescriptions: Record<TargetGrade, string>;
  sources: { title: string; url: string }[];
  workSamples: string[];
}
/** Pack-owned behavior is opaque to the shared assessment engine. */
export interface ItemRuntime {
  responseTask?: (
    model: ItemModel,
    world: WorldState,
    kind: AnswerIntent['kind'],
  ) => {
    task: NonNullable<import('../adaptive/model.js').ItemStep['responseTask']>;
    accepted: import('../domain.js').Plan[];
  };
  semanticState?: (world: WorldState) => unknown;
  prompt?: (kind: AnswerIntent['kind'], world?: WorldState) => string;
  createWorld(
    pack: SpecializationPack,
    model: ItemModel,
    grade: TargetGrade,
    seed: number,
    band?: DifficultyBand,
  ): WorldState;
  mutateWorld(model: ItemModel, world: WorldState, seed: number): WorldState;
  deriveTruth(model: ItemModel, world: WorldState): GroundTruth;
  createIntents(
    model: ItemModel,
    world: WorldState,
    kind: AnswerIntent['kind'],
    seed: number,
  ): AnswerIntent[];
  createArtifacts(model: ItemModel, world: WorldState, truth: GroundTruth): Artifact[];
  renderScenario(
    model: ItemModel,
    world: WorldState,
    truth: GroundTruth,
  ): {
    scenario: {
      context: string;
      observations: string[];
      constraints: string[];
      assumptions: string[];
    };
    text: string;
    templateIds: string[];
  };
  topology(model: ItemModel, grade: TargetGrade, facts: Record<string, Fact>): Topology;
}
export interface WorldState {
  work?: GradeWorkWorld;
  modelId: string;
  specialization: string;
  grade: TargetGrade;
  radicals: {
    workers: number;
    components: number;
    observability: 'clear' | 'correlated' | 'cohort';
    interactingFailures: number;
    legacyClients: boolean;
    rollbackRequired: boolean;
    failure: Record<string, Fact>;
  };
  incidentals: {
    domain: string;
    service: string;
    entity: string;
    table: string;
    endpoint: string;
    operationId: string;
    timestamp: string;
    rps: number;
    timeoutSeconds: number;
    wording: number;
  };
  assumptions: string[];
  constraints: string[];
  topology: Topology;
  mutation?: string;
}
export interface GroundTruth {
  hazard: string;
  violatedInvariant: string;
  causalChain: string[];
  requirements: string[];
  bestDiagnosticArtifact: string;
  falsifyingObservation: string;
}
export interface AnswerIntent {
  partialCredit?: number;
  id: string;
  kind:
    | 'diagnosis'
    | 'interpretation'
    | 'remediation'
    | 'adaptation'
    | 'falsification'
    | 'negative_guarantee'
    | 'critical_assumption';
  text: string;
  predictsHazard?: string;
  guarantees: string[];
  availableUnder: string[];
  misconception: string | null;
  applicability?: Record<string, Fact>;
}
export interface TemplateBlock {
  id: string;
  slot: 'intro' | 'symptom' | 'constraints' | 'question';
  requires: { path: string; equals: Fact }[];
  render: (world: WorldState, truth: GroundTruth) => string;
}
export interface FormalCase {
  id: string;
  facts: Record<string, Fact>;
  predicate: (facts: Record<string, Fact>) => boolean;
  hazard: string;
  invariant: string;
  cause: string;
  evidence: string;
  requirements: string[];
  repair: string;
  diagnostic: string;
  falsifier: string;
  minimumGrade?: TargetGrade;
  maximumGrade?: TargetGrade;
  narrative?: string;
}
export interface ItemModel {
  supportedGrades?: TargetGrade[];
  gradeExclusions?: Partial<Record<TargetGrade, string>>;
  decisionArchetypes?: string[];
  gradeConfigurations?: Partial<Record<TargetGrade, GradeConfiguration>>;
  supportsJunior?: boolean;
  supportsMiddle?: boolean;
  supportsSenior?: boolean;
  gradeSupportRationale?: string;
  worldBounds?: Partial<SpecializationPack['worldBounds']>;
  capabilities?: string[];
  runtime?: ItemRuntime;
  gradeRange?: TargetGrade[];
  competencyDomain?: CompetencyDomain;
  competencyDomains?: CompetencyDomain[];
  availableArtifacts?: ArtifactType[];
  worldStateSchema?: string;
  boundarySuitability?: boolean;
  informationWeight?: number;
  itemTypes?: AnswerIntent['kind'][];
  id: string;
  version: string;
  siblingGroup: string;
  title: string;
  specialization: string;
  measuredDimensions: CompetencyDimension[];
  stages: Stage[];
  contentTags: string[];
  radicalDefinitions: { name: string; affects: string }[];
  incidentalDefinitions: string[];
  misconceptionClasses: string[];
  cases: FormalCase[];
  topology: string[];
  introduction: string;
  code: (world: WorldState) => string;
}
export interface SpecializationPack {
  gradeProgressionVocabulary?: Record<TargetGrade, string>;
  decisionArchetypeCatalog?: import('./decision-archetypes.js').DecisionArchetypeCatalog;
  gradeConfigurations?: Record<TargetGrade, GradeConfiguration>;
  assessmentRecipes?: Record<TargetGrade, AssessmentRecipe>;
  coreDomainCounts?: Record<TargetGrade, Record<string, number>>;
  stageRequirements?: Partial<Record<Stage, string[]>>;
  presentation?: PackPresentation;
  contentBalance?: { minDomains: number; maxPerDomain: number };
  validateBalance?: (models: ItemModel[], grade: TargetGrade) => boolean;
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  competencyBlueprint: CompetencyDimension[];
  itemModels: ItemModel[];
  artifactGenerators: ArtifactType[];
  renderers: string[];
  misconceptionCatalog: string[];
  worldBounds: Record<
    TargetGrade,
    {
      workers: number[];
      maxComponents: number;
      legacyClients: boolean;
      rollbackRequired: boolean;
    }
  >;
}
export interface ValidationIssue {
  gate: string;
  message: string;
}
export interface GeneratedSnapshot {
  coreProbe?: boolean;
  difficulty?: DifficultyMetadata;
  responseChecks?: Record<string, { accepted: import('../domain.js').Plan[] }>;
  competencyDomain?: string;
  seed: number;
  generatorVersion: string;
  packVersion: string;
  itemModelId: string;
  itemModelVersion: string;
  siblingGroup: string;
  worldState: WorldState;
  groundTruth: GroundTruth;
  stepWorlds: Record<string, WorldState>;
  stepTruths: Record<string, GroundTruth>;
  stepArtifacts: Record<string, Artifact[]>;
  intents: Record<string, AnswerIntent[]>;
  optionIntents: Record<string, string>;
  templateIds: string[];
  semanticFingerprint: string;
  surfaceFingerprint: string;
  renderedContent: string;
  validation: { passed: boolean; issues: ValidationIssue[] };
  source: 'on-demand' | 'pool' | 'fallback';
}
export interface GeneratedItem extends ItemVariant {
  generated: GeneratedSnapshot;
  topology: Topology;
}
export interface ExposureRecord {
  questionFingerprints?: string[];
  specialization: string;
  targetGrade: TargetGrade;
  itemModelId: string;
  siblingGroup: string;
  familyExposureCount: number;
  itemModelExposureCount: number;
  variantExposureCount: number;
  semanticFingerprint: string;
  surfaceFingerprint: string;
  lastUsedAt: string;
  userId: string;
  sessionId: string;
}

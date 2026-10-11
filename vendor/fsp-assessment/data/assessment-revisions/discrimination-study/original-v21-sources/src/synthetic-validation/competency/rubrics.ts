import { readFileSync } from 'node:fs';
import type { TargetGrade } from '../../adaptive/model.js';
import type { ItemVariant, ItemStep } from '../../adaptive/model.js';
import { validationMetadata } from '../metadata.js';
import { actionToken } from '../../generative/decision-archetypes.js';
import type { SemanticAlternative, ValidationMetadata } from '../model.js';

export const facets = ['bounded', 'integrated', 'strategic'] as const;
export type Facet = (typeof facets)[number];
export type Mastery = 'stable' | 'moderate' | 'inconsistent' | 'weak' | 'not_expected';
export interface Capability {
  id: string;
  domain: string;
  description: string;
  middleTier: 'core' | 'upper';
  juniorExpectation: string;
  middleExpectation: string;
  seniorExpectation: string;
  behaviouralAnchors: Record<TargetGrade, Record<'weak' | 'borderline' | 'clear', string>>;
  evidenceOfCompetence: string[];
  commonFailureModes: string[];
  sourceBasis: string[];
}
export interface ProfessionalRubric {
  version: string;
  track: string;
  name: string;
  roleScope: string;
  gradeStandards: Record<TargetGrade, string>;
  sources: string[];
  knownLimitations: string[];
  capabilities: Capability[];
}
export interface CapabilityMapping {
  track: string;
  model: string;
  domain: string;
  requiredCapabilities: string[];
  supportingCapabilities: string[];
  optionalCapabilities: string[];
  strategicResponsibilities: { capability: string; responsibility: string }[];
  gradeJustification: Partial<Record<TargetGrade, string[]>>;
  contentAudit: {
    meaningfulCapability: boolean;
    reviewFlags: string[];
    reviewPriority: string;
  };
}
const rubrics = new Map<string, ProfessionalRubric>();
export function professionalRubric(track: string): ProfessionalRubric {
  if (!rubrics.has(track))
    rubrics.set(track, JSON.parse(readFileSync(`data/competency-rubrics/${track}.json`, 'utf8')));
  return rubrics.get(track)!;
}
const mappings = new Map<string, CapabilityMapping>(
  (
    JSON.parse(readFileSync('data/competency-rubrics/ITEM_CAPABILITY_MAPPING.json', 'utf8')) as {
      models: CapabilityMapping[];
    }
  ).models.map((m) => [`${m.track}/${m.model}`, m]),
);
export function capabilityMapping(track: string, model: string): CapabilityMapping {
  const mapping = mappings.get(`${track}/${model}`);
  if (!mapping) throw new Error(`No authored capability mapping: ${track}/${model}`);
  return mapping;
}
/** The policy receives task demands, never grade/band/profile/score keys. */
export interface CompetencyMetadata extends Omit<
  ValidationMetadata,
  'requirements' | 'alternatives'
> {
  alternatives: (SemanticAlternative & { executionStrategy: string | null })[];
  requiredCapabilities: string[];
  supportingCapabilities: string[];
  facet: Facet;
  demandBasis: string[];
}
export function competencyMetadata(
  item: ItemVariant,
  step: ItemStep,
  source = validationMetadata(item, step),
): CompetencyMetadata {
  const { requirements: _requirements, ...semantic } = source;
  const mapping = capabilityMapping(item.specialization, item.generated!.itemModelId);
  const work = item.generated!.stepWorlds[step.id]!.work;
  const demands: string[] = [];
  // Responsibility is inferred from the instance's work structure, not targetGrade or band.
  if (work?.historicalWorld) demands.push('historical-current-state-reconciliation');
  if ((work?.actors.length || 0) > 1) demands.push('interacting-actors');
  if (step.responseTask?.controls.some((c) => c.id === 'sourceRevision'))
    demands.push('independent-source-revision');
  if (step.exploration && (step.requiredEvidenceSources || 0) > 1)
    demands.push('independent-evidence-integration');
  const strategy = semantic.alternatives.some((a) => a.archetype !== null);
  if (strategy && work?.policy) demands.push('feasible-strategy-with-evolution-cost-rollback');
  return {
    ...semantic,
    alternatives: semantic.alternatives.map((a) => ({
      ...a,
      executionStrategy: a.archetype
        ? actionToken(work!.decisionArchetypes.find((x) => x.id === a.archetype)!)
        : null,
    })),
    requiredCapabilities: mapping.requiredCapabilities,
    supportingCapabilities: mapping.supportingCapabilities,
    facet: strategy && work?.policy ? 'strategic' : demands.length ? 'integrated' : 'bounded',
    demandBasis: demands.length ? demands : ['bounded-local-contract'],
  };
}
export function prepareCompetencyMetadata(
  template: {
    items: { variant: ItemVariant }[];
    boundaryPool: ItemVariant[];
  },
  source?: Map<string, ValidationMetadata>,
): Map<string, CompetencyMetadata> {
  return new Map(
    [...template.items.map((i) => i.variant), ...template.boundaryPool].flatMap((item) =>
      item.steps.map(
        (step) =>
          [
            `${item.id}/${step.id}`,
            competencyMetadata(item, step, source?.get(`${item.id}/${step.id}`)),
          ] as const,
      ),
    ),
  );
}

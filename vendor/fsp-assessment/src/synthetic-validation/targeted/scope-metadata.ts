/** Targeted responsibility correction: using a supplied policy is not owning its definition. */
import type { AssessmentSession, ItemVariant, ItemStep } from '../../adaptive/model.js';
import type { ValidationMetadata } from '../model.js';
import { competencyMetadata, type CompetencyMetadata } from '../competency/rubrics.js';
export function scopedMetadata(
  item: ItemVariant,
  step: ItemStep,
  source?: ValidationMetadata,
): CompetencyMetadata {
  const metadata = competencyMetadata(item, step, source);
  const work = item.generated!.stepWorlds[step.id]!.work;
  // The authored decision contract supplies budgets/priority and names only the workflow handoff.
  // In contrast, ownership tasks declare independent system consequences in this contract.
  // Do not infer responsibility from the item target grade, band, score, actor count or action name.
  const handoffOnly = work?.consequences.length === 1 && work.consequences[0] === work.handoff;
  if (metadata.facet === 'strategic' && handoffOnly) {
    return {
      ...metadata,
      facet: 'integrated',
      demandBasis: [
        ...metadata.demandBasis,
        'provided-policy-under-workflow-handoff; no-independent-policy-ownership-contract',
      ],
    };
  }
  return metadata;
}
export function prepareScopedMetadata(
  template: AssessmentSession,
  source?: Map<string, ValidationMetadata>,
) {
  return new Map(
    [...template.items.map((i) => i.variant), ...template.boundaryPool].flatMap((item) =>
      item.steps.map(
        (step) =>
          [
            `${item.id}/${step.id}`,
            scopedMetadata(item, step, source?.get(`${item.id}/${step.id}`)),
          ] as const,
      ),
    ),
  );
}

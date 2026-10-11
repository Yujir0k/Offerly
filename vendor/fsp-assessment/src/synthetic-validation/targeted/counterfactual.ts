import { evaluateEvidence } from '../../adaptive/engine.js';
import type { AssessmentSession } from '../../adaptive/model.js';
export function removeItems(session: AssessmentSession, ids: string[]) {
  const keep = {
    ...session,
    items: session.items.filter((i) => !ids.includes(i.variant.id)),
    responses: session.responses.filter((r) => !ids.includes(r.itemId)),
    contributions: session.contributions.filter((c) => !ids.includes(c.familyId)),
  };
  const evaluation = evaluateEvidence(keep);
  const coverage = evaluation.dimensions.every((d) => d.coverage >= session.config.minimumCoverage);
  return {
    confirmed: Number(coverage && evaluation.band.lowerBound > evaluation.band.cutScore),
    coverageSatisfied: coverage,
    ...evaluation,
  };
}

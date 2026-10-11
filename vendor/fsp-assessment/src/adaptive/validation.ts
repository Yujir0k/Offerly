import { random } from '../random.js';
import { answer, createSession, openEvidence, sessionTelemetry } from './engine.js';
import type { CompetencyDimension, TargetGrade } from './model.js';

export type ValidationObservation = ReturnType<typeof sessionTelemetry> & {
  persona?: string;
  expertDecision?: 'CONFIRMED' | 'NOT_CONFIRMED';
};
const personas = [
  { id: 'clear-junior', quality: [1, 0.3, 0] },
  { id: 'borderline-junior-middle', quality: [1, 0.65, 0.3] },
  { id: 'clear-middle', quality: [1, 1, 0.3] },
  { id: 'borderline-middle-senior', quality: [1, 1, 0.65] },
  { id: 'clear-senior', quality: [1, 1, 1] },
];
const mean = (values: number[]) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
function pearson(pairs: [number, number][]): number | null {
  if (pairs.length < 3) return null;
  const x = mean(pairs.map((p) => p[0]))!;
  const y = mean(pairs.map((p) => p[1]))!;
  const numerator = pairs.reduce((sum, p) => sum + (p[0] - x) * (p[1] - y), 0);
  const denominator = Math.sqrt(
    pairs.reduce((sum, p) => sum + (p[0] - x) ** 2, 0) *
      pairs.reduce((sum, p) => sum + (p[1] - y) ** 2, 0),
  );
  return denominator ? numerator / denominator : null;
}
function quantile(values: number[], q: number): number | null {
  return values.length
    ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) * q)]!
    : null;
}

/** Scripted personas exercise mechanics; these are not people or an expert-labeled study. */
export function simulateAssessment(seeds = 32): ValidationObservation[] {
  const observations: ValidationObservation[] = [];
  const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
  for (const persona of personas)
    for (const [gradeIndex, grade] of grades.entries())
      for (let seed = 0; seed < seeds; seed++) {
        const start = Date.parse('2026-10-06T08:00:00Z');
        const session = createSession(
          `sim-${persona.id}-${grade}-${seed}`,
          'synthetic',
          grade,
          seed,
          start,
        );
        const rng = random(seed + gradeIndex * 100 + persona.id.length);
        let now = start;
        while (session.state === 'active') {
          const item = session.items[session.cursor.item]!.variant;
          const step = item.steps[session.cursor.step]!;
          const baseQuality = persona.quality[gradeIndex]!;
          const quality = rng() < 0.08 ? (baseQuality === 1 ? 0.65 : 0.3) : baseQuality;
          now += 55000 + Math.floor(rng() * 25000);
          if (step.exploration) {
            const artifacts = [...item.artifacts].sort((a, b) =>
              quality >= 0.65 ? b.usefulness - a.usefulness : a.usefulness - b.usefulness,
            );
            artifacts
              .slice(0, 2)
              .forEach((a, i) =>
                openEvidence(session, item.id, step.id, a.id, now - 10000 + i * 3000),
              );
            answer(session, item.id, step.id, 'continue', now);
          } else {
            const option = [...step.options].sort(
              (left, right) =>
                Math.abs(step.rubric.scores[left.id]! - quality) -
                Math.abs(step.rubric.scores[right.id]! - quality),
            )[0]!;
            answer(
              session,
              item.id,
              step.id,
              option.id,
              now,
              item.generated?.responseChecks?.[step.id]?.accepted[0],
            );
          }
        }
        observations.push({ ...sessionTelemetry(session), persona: persona.id });
      }
  return observations;
}
/** Descriptive metrics for either explicit simulations or real telemetry exports. */
export function validationReport(
  observations: ValidationObservation[],
  source: 'simulation' | 'observed',
) {
  const completed = observations.filter((o) => o.finishedAt);
  const cohorts = [
    ...new Set(observations.map((o) => `${o.persona || 'observed'}:${o.targetGrade}`)),
  ].map((key) => {
    const cohort = observations.filter(
      (o) => `${o.persona || 'observed'}:${o.targetGrade}` === key,
    );
    const passRate = cohort.filter((o) => o.decision === 'CONFIRMED').length / cohort.length;
    const scores = cohort.flatMap((o) => (o.result ? [o.result.band.estimatedScore] : []));
    return {
      cohort: key,
      count: cohort.length,
      confirmationRate: passRate,
      meanScore: mean(scores),
      scoreSpread: scores.length ? Math.max(...scores) - Math.min(...scores) : null,
      decisionStability: Math.max(passRate, 1 - passRate),
    };
  });
  const families = [...new Set(completed.flatMap((o) => o.items.map((i) => i.familyId)))].map(
    (familyId) => {
      const observationsForFamily = completed.filter((o) =>
        o.contributions.some((c) => c.familyId === familyId),
      );
      const pairs = observationsForFamily.flatMap((o): [number, number][] => {
        const local = o.contributions.filter((c) => c.familyId === familyId);
        const other = o.contributions.filter((c) => c.familyId !== familyId);
        if (!other.length) return [];
        const weighted = (cs: typeof other) =>
          cs.reduce((sum, c) => sum + c.value * c.weight, 0) /
          cs.reduce((sum, c) => sum + c.weight, 0);
        return [[weighted(local), weighted(other)]];
      });
      const groups = new Map<string, number[]>();
      for (const o of observationsForFamily) {
        const cs = o.contributions.filter((c) => c.familyId === familyId);
        const score =
          cs.reduce((sum, c) => sum + c.value * c.weight, 0) /
          cs.reduce((sum, c) => sum + c.weight, 0);
        const key = `${o.persona || o.sessionId}:${o.targetGrade}`;
        groups.set(key, [...(groups.get(key) || []), score]);
      }
      const spreads = [...groups.values()]
        .filter((g) => g.length > 1)
        .map((g) => Math.max(...g) - Math.min(...g));
      return {
        familyId,
        observations: observationsForFamily.length,
        discriminationProxy: pearson(pairs),
        withinPersonaVariantScoreSpread: mean(spreads),
        note: 'Association with other-family evidence; not an IRT discrimination parameter.',
      };
    },
  );
  const duration = completed.flatMap((o) =>
    o.totalTimeMs === null ? [] : [o.totalTimeMs / 60000],
  );
  const labeled = completed.filter((o) => o.expertDecision);
  const coverage = (
    ['diagnosis', 'correctness', 'engineering_judgment', 'adaptation'] as CompetencyDimension[]
  ).map((dimension) => ({
    dimension,
    meanIndependentFamilies: mean(
      completed.map(
        (o) => o.dimensionCoverage.find((d) => d.dimension === dimension)?.coverage || 0,
      ),
    ),
    coveredRate: mean(
      completed.map((o) =>
        (o.dimensionCoverage.find((d) => d.dimension === dimension)?.coverage || 0) > 0 ? 1 : 0,
      ),
    ),
  }));
  return {
    source,
    label:
      source === 'simulation'
        ? 'SIMULATION / INTERNAL VALIDATION — scripted evidence and response times, no human pilot'
        : 'OBSERVED TELEMETRY — descriptive, not psychometric certification',
    sessions: observations.length,
    resultStabilityAndGradeSeparation: cohorts,
    itemDiscriminationAndVariantAgreement: families,
    durationMinutes: {
      p10: quantile(duration, 0.1),
      p50: quantile(duration, 0.5),
      p90: quantile(duration, 0.9),
      max: duration.length ? Math.max(...duration) : null,
    },
    boundaryUsageRate: mean(observations.map((o) => (o.boundaryUsed ? 1 : 0))),
    completionRate: observations.length ? completed.length / observations.length : null,
    timeoutRate: mean(observations.map((o) => (o.timeout ? 1 : 0))),
    dimensionCoverage: coverage,
    expertAgreement: {
      labeledSessions: labeled.length,
      rate: labeled.length
        ? labeled.filter((o) => o.decision === o.expertDecision).length / labeled.length
        : null,
      note: labeled.length
        ? 'Agreement against supplied labels only.'
        : 'No expert labels provided; cannot estimate agreement.',
    },
    limitations: [
      'Cut scores and information weights are provisional seeded configuration.',
      'Decision bands are rule-based margins, not calibrated confidence intervals.',
      'Variant agreement is measurable within personas only in simulation; real agreement requires repeated or matched labeled candidates.',
      'Synthetic durations are authored inputs, not observed candidate completion times.',
    ],
  };
}

import {
  expireSession,
  evaluateEvidence,
} from "../vendor/fsp-assessment/dist/src/adaptive/engine.js";
import type { AssessmentSession } from "../vendor/fsp-assessment/src/adaptive/model";
export type TimeoutSummary = {
  policy: "unanswered-zero-v1";
  answered: number;
  unanswered: number;
  total: number;
  score: number;
};
/** Only timed-out attempts use this policy. Frozen history and actual answers remain untouched. */
export function settleAssessmentTimeout(
  session: AssessmentSession,
  now: number,
): boolean {
  if (session.state !== "active" || now < Date.parse(session.deadlineAt))
    return false;
  const missing = session.items.flatMap((item) =>
    item.variant.steps
      .filter(
        (step) =>
          !session.responses.some(
            (r) => r.itemId === item.variant.id && r.stepId === step.id,
          ),
      )
      .map((step) => ({ item, step })),
  );
  expireSession(session, now);
  if (!session.result) return true;
  const result = session.result as typeof session.result & {
    timeoutSummary?: TimeoutSummary;
  };
  result.timeoutSummary = {
    policy: "unanswered-zero-v1",
    answered: session.responses.length,
    unanswered: missing.length,
    total: session.responses.length + missing.length,
    score: Math.round(result.band.estimatedScore * 100),
  };
  if (!missing.length) return true;
  // Temporary scoring-only observations: never manufacture or persist candidate responses.
  const scoring = structuredClone(session);
  for (const { item, step } of missing) {
    const c = {
      dimension: step.rubric.dimension,
      value: 0,
      weight: step.rubric.informationWeight,
      ...(step.rubric.resultWeight !== undefined
        ? { resultWeight: step.rubric.resultWeight }
        : {}),
      observation: `${item.variant.id}/${step.id}`,
      familyId: item.variant.id,
      source: step.exploration ? ("evidence" as const) : ("answer" as const),
    };
    const cs = [c];
    if (step.responseTask && session.config.enhancements?.separateExecution)
      cs.push({
        ...c,
        dimension: step.rubric.executionDimension || step.rubric.dimension,
        source: "execution" as any,
        observation: `${c.observation}#execution`,
      });
    scoring.contributions.push(...cs);
    scoring.responses.push({
      itemId: item.variant.id,
      stepId: step.id,
      optionId: "",
      at: session.deadlineAt,
      responseTimeMs: 0,
      contributions: cs,
    });
  }
  const zero = evaluateEvidence(scoring);
  const absent = new Set(
    missing.map(({ item, step }) => `${item.variant.id}/${step.id}`),
  );
  result.dimensions = zero.dimensions.map((d) => {
    const actual = result.dimensions.find((v) => v.dimension === d.dimension)!;
    return {
      ...d,
      coverage: actual.coverage,
      effectiveEvidence: actual.effectiveEvidence,
      margin: actual.margin,
      label:
        d.score - actual.margin > session.config.cutScore
          ? "Strong"
          : d.score >= session.config.cutScore
            ? "Sufficient"
            : d.score + actual.margin >= session.config.cutScore
              ? "Uncertain"
              : "Needs evidence",
      evidence: d.evidence.map((e) =>
        absent.has(e.source.split("#")[0])
          ? { ...e, explanation: "Время истекло. Ответ не получен: 0 баллов." }
          : e,
      ),
    };
  });
  const score = result.dimensions.reduce(
    (sum, d) => sum + d.score * session.config.weights[d.dimension],
    0,
  );
  const spread =
    Math.max(...result.dimensions.map((d) => d.score)) -
    Math.min(...result.dimensions.map((d) => d.score));
  const margin =
    result.dimensions.reduce(
      (sum, d) => sum + d.margin * session.config.weights[d.dimension],
      0,
    ) +
    session.config.uncertainty.contradiction * spread;
  result.timeoutSummary.score = Math.round(score * 100);
  result.band = {
    ...result.band,
    estimatedScore: score,
    margin,
    lowerBound: Math.max(0, score - margin),
    upperBound: Math.min(1, score + margin),
  };
  result.scoringConfigVersion = `${result.scoringConfigVersion}+unanswered-zero-v1`;
  if (
    result.decision === "CONFIRMED" &&
    result.band.lowerBound <= result.band.cutScore
  ) {
    result.decision = "NOT_CONFIRMED";
    result.title = `${session.targetGrade.toUpperCase()} NOT CONFIRMED`;
    result.assessmentStatus = "insufficient-evidence";
    result.recommendation = null;
  }
  result.reason =
    "Лимит времени исчерпан. Сохранённые ответы оценены по методике; неотвеченные задания учтены как 0. " +
    (result.decision === "CONFIRMED"
      ? "Заявленный уровень подтверждён."
      : "Заявленный уровень в этой попытке не подтверждён.");
  return true;
}

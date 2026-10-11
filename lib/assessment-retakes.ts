/** Product access policy, separate from the frozen assessment/scoring algorithm. */
export const retakePolicy = {
  version: "retakes-2026-10-10-v1",
  confirmedDays: 90,
  unsuccessfulDays: 7,
} as const;
export type AttemptSummary = {
  id: string;
  specialization: string;
  targetGrade: string;
  state: string;
  finishedAt?: string | null;
  deadlineAt?: string | null;
  decision?: string | null;
};
export type RetakeEligibility = {
  allowed: boolean;
  nextEligibleAt: string | null;
  reason: "confirmed" | "unsuccessful" | null;
  policy: typeof retakePolicy;
  serverNow: string;
};
export function retakeEligibility(
  attempts: AttemptSummary[],
  specialization: string,
  targetGrade: string,
  now: number,
): RetakeEligibility {
  let next = 0;
  let reason: RetakeEligibility["reason"] = null;
  for (const attempt of attempts) {
    if (attempt.specialization !== specialization) continue;
    // A timed-out active snapshot already consumes its attempt even before sweep
    // persists the result; client refreshes cannot extend the server deadline.
    const expired =
      attempt.state === "active" && Date.parse(attempt.deadlineAt || "") <= now;
    if (attempt.state !== "completed" && !expired) continue;
    const finished = Date.parse(
      expired ? attempt.deadlineAt! : attempt.finishedAt || "",
    );
    if (!Number.isFinite(finished)) continue;
    const confirmed = attempt.decision === "CONFIRMED";
    if (!confirmed && attempt.targetGrade !== targetGrade) continue;
    const until =
      finished +
      (confirmed ? retakePolicy.confirmedDays : retakePolicy.unsuccessfulDays) *
        86400000;
    if (until > next && until > now) {
      next = until;
      reason = confirmed ? "confirmed" : "unsuccessful";
    }
  }
  return {
    allowed: next <= now,
    nextEligibleAt: next ? new Date(next).toISOString() : null,
    reason,
    policy: retakePolicy,
    serverNow: new Date(now).toISOString(),
  };
}

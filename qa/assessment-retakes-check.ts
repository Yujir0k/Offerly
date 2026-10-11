import assert from "node:assert/strict";
import {
  retakeEligibility,
  retakePolicy,
  type AttemptSummary,
} from "../lib/assessment-retakes";
const now = Date.parse("2026-10-10T12:00:00Z"),
  day = 86400000;
const completed: AttemptSummary = {
  id: "fixture",
  specialization: "backend",
  targetGrade: "Junior",
  state: "completed",
  finishedAt: new Date(now).toISOString(),
  decision: "CONFIRMED",
};
let checks = 0;
function allowed(
  rows: AttemptSummary[],
  spec = "backend",
  grade = "Junior",
  at = now,
) {
  const r = retakeEligibility(rows, spec, grade, at);
  checks++;
  return r;
}
assert(allowed([]).allowed);
for (const grade of ["Junior", "Middle", "Senior"]) {
  const r = allowed([completed], "backend", grade);
  assert(!r.allowed);
  assert.equal(r.nextEligibleAt, new Date(now + 90 * day).toISOString());
}
assert(allowed([completed], "frontend").allowed);
assert(!allowed([completed], "backend", "Junior", now + 90 * day - 1).allowed);
assert(allowed([completed], "backend", "Junior", now + 90 * day).allowed);
assert(allowed([completed], "backend", "Junior", now + 90 * day + 1).allowed);
const failed = {
  ...completed,
  targetGrade: "Middle",
  decision: "NOT_CONFIRMED",
};
assert(!allowed([failed], "backend", "Middle").allowed);
assert(allowed([failed], "backend", "Junior").allowed);
assert(!allowed([failed], "backend", "Middle", now + 7 * day - 1).allowed);
assert(allowed([failed], "backend", "Middle", now + 7 * day).allowed);
assert(!allowed([completed, failed], "backend", "Junior").allowed);
assert.equal(
  allowed([completed, failed], "backend", "Middle").reason,
  "confirmed",
);
assert(
  allowed(
    [
      {
        ...failed,
        state: "active",
        finishedAt: null,
        deadlineAt: new Date(now + 1).toISOString(),
      },
    ],
    "backend",
    "Middle",
  ).allowed,
);
assert(
  !allowed(
    [
      {
        ...failed,
        state: "active",
        finishedAt: null,
        deadlineAt: new Date(now).toISOString(),
      },
    ],
    "backend",
    "Middle",
  ).allowed,
);
assert(
  allowed([{ ...failed, finishedAt: "invalid" }], "backend", "Middle").allowed,
);
assert.deepEqual(retakePolicy, {
  version: "retakes-2026-10-10-v1",
  confirmedDays: 90,
  unsuccessfulDays: 7,
});
checks++;
console.log(
  JSON.stringify({
    checks,
    exactBoundaries: true,
    otherTrackIndependent: true,
    failedLowerGradeAllowed: true,
    timeoutConsumesAttempt: true,
    priorConfirmationCannotBeBypassed: true,
  }),
);

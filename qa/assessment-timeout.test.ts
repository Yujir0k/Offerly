import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSession,
  answer,
  openEvidence,
  expireSession,
} from "../vendor/fsp-assessment/dist/src/adaptive/engine.js";
import { settleAssessmentTimeout } from "../lib/assessment-timeout";
const now = Date.now();
function session() {
  return createSession(
    "timeout-session",
    "timeout-qa",
    "Junior",
    "timeout-seed",
    now,
    undefined,
    undefined,
    { specialization: "backend" },
  );
}
test("timeout with no answers is zero, closes execution and freezes the result", () => {
  const s = session();
  const responses = structuredClone(s.responses);
  assert.equal(settleAssessmentTimeout(s, Date.parse(s.deadlineAt) - 1), false);
  assert.equal(settleAssessmentTimeout(s, Date.parse(s.deadlineAt)), true);
  const r = s.result as NonNullable<typeof s.result> & {
    timeoutSummary: import("../lib/assessment-timeout").TimeoutSummary;
  };
  assert.equal(s.state, "completed");
  assert.equal(r.band.estimatedScore, 0);
  assert.equal(r.timeoutSummary.score, 0);
  assert.equal(r.timeoutSummary.answered, 0);
  assert.ok(r.timeoutSummary.unanswered > 0);
  assert.equal(r.decision, "NOT_CONFIRMED");
  assert.deepEqual(s.responses, responses);
  const frozen = JSON.stringify(s);
  assert.equal(
    settleAssessmentTimeout(s, Date.parse(s.deadlineAt) + 60000),
    false,
  );
  assert.equal(JSON.stringify(s), frozen);
});
test("partial timeout counts all assigned missing steps as zero without manufacturing answers or increasing evidence coverage", () => {
  const s = session(),
    item = s.items[s.cursor.item].variant,
    step = item.steps[s.cursor.step];
  if (step.exploration)
    for (const a of [...item.artifacts]
      .sort((a, b) => b.usefulness - a.usefulness)
      .slice(0, step.requiredEvidenceSources || 2))
      openEvidence(s, item.id, step.id, a.id, now + 1);
  const option = step.exploration
    ? "continue"
    : Object.entries(step.rubric.scores).sort((a, b) => b[1] - a[1])[0][0];
  answer(
    s,
    item.id,
    step.id,
    option,
    now + 2,
    item.generated?.responseChecks?.[step.id]?.accepted[0],
  );
  const original = structuredClone(s),
    baseline = structuredClone(s);
  expireSession(baseline, Date.parse(s.deadlineAt));
  settleAssessmentTimeout(s, Date.parse(s.deadlineAt));
  const r = s.result as NonNullable<typeof s.result> & {
    timeoutSummary: import("../lib/assessment-timeout").TimeoutSummary;
  };
  assert.ok(r.timeoutSummary.answered > 0);
  assert.ok(r.timeoutSummary.unanswered > 0);
  assert.equal(
    r.timeoutSummary.total,
    r.timeoutSummary.answered + r.timeoutSummary.unanswered,
  );
  assert.ok(r.band.estimatedScore < baseline.result!.band.estimatedScore);
  assert.deepEqual(s.responses, original.responses);
  assert.deepEqual(s.contributions, original.contributions);
  for (const d of r.dimensions)
    assert.equal(
      d.coverage,
      baseline.result!.dimensions.find((v) => v.dimension === d.dimension)!
        .coverage,
    );
  assert.ok(
    r.dimensions.some((d) =>
      d.evidence.some(
        (e) => e.value === 0 && e.explanation.includes("Ответ не получен"),
      ),
    ),
  );
  assert.throws(
    () => answer(s, item.id, step.id, option, Date.parse(s.deadlineAt) + 1),
    /завершена/,
  );
});

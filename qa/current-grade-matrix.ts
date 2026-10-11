import assert from "node:assert/strict";
import {
  createSession,
  answer,
  openEvidence,
  publicSession,
} from "../vendor/fsp-assessment/dist/src/adaptive/engine.js";
import { packs } from "../vendor/fsp-assessment/dist/src/generative/packs.js";
import { settleAssessmentTimeout } from "../lib/assessment-timeout";
import { writeFile } from "node:fs/promises";
const rows = [];
let steps = 0;
function respond(s: any, good: boolean, t: number) {
  const item = s.items[s.cursor.item].variant,
    step = item.steps[s.cursor.step];
  if (step.exploration) {
    for (const a of [...item.artifacts]
      .sort((a, b) =>
        good ? b.usefulness - a.usefulness : a.usefulness - b.usefulness,
      )
      .slice(0, step.requiredEvidenceSources || 2))
      openEvidence(s, item.id, step.id, a.id, t);
    answer(s, item.id, step.id, "continue", t);
  } else {
    const option = Object.entries(step.rubric.scores).sort((a: any, b: any) =>
      good ? b[1] - a[1] : a[1] - b[1],
    )[0][0];
    answer(
      s,
      item.id,
      step.id,
      option,
      t,
      item.generated?.responseChecks?.[step.id]?.accepted[0],
    );
  }
  steps++;
}
for (const pack of packs.filter((p) => p.enabled))
  for (const grade of ["Junior", "Middle", "Senior"] as const) {
    const now = Date.now(),
      seed = createSession(
        "matrix-" + pack.id + grade,
        "matrix-owner",
        grade,
        "current-matrix-" + pack.id + grade,
        now,
        undefined,
        undefined,
        { specialization: pack.id },
      );
    for (const good of [true, false]) {
      const s = structuredClone(seed);
      let n = 0;
      while (s.state === "active") {
        assert(++n < 100);
        respond(s, good, now + n * 1000);
      }
      assert.equal(
        s.result!.decision,
        good ? "CONFIRMED" : "NOT_CONFIRMED",
        pack.id + " " + grade + " " + good,
      );
      const publicValue = JSON.stringify(publicSession(s));
      assert(!publicValue.includes('"rubric"'));
      assert(!publicValue.includes('"responseChecks"'));
      rows.push({
        track: pack.id,
        grade,
        case: good ? "success" : "failure",
        decision: s.result!.decision,
        steps: n,
      });
    }
    const timed = structuredClone(seed);
    respond(timed, true, now + 1);
    settleAssessmentTimeout(timed, Date.parse(timed.deadlineAt));
    const result = timed.result as any;
    assert(result.timeoutSummary.unanswered > 0);
    assert.equal(timed.state, "completed");
    assert.equal(result.stopReason, "timeout");
    assert.equal(publicSession(timed).current, null);
    const frozen = JSON.stringify(timed);
    assert.throws(() => respond(timed, true, Date.parse(timed.deadlineAt) + 1));
    assert.equal(JSON.stringify(timed), frozen);
    rows.push({
      track: pack.id,
      grade,
      case: "timeout",
      summary: result.timeoutSummary,
    });
    console.log("PASS", pack.id, grade, "success/failure/timeout");
  }
await writeFile(
  process.env.TEST_RESULT_FILE || "qa/results/latest/grade-matrix.json",
  JSON.stringify(
    { tracks: 12, grades: 3, cases: rows.length, steps, rows },
    null,
    2,
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    tracks: 12,
    grades: 3,
    cases: rows.length,
    steps,
  }),
);

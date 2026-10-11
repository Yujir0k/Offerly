import assert from "node:assert/strict";
import {
  createSession,
  answer,
  openEvidence,
  publicSession,
  expireSession,
} from "../vendor/fsp-assessment/dist/src/adaptive/engine.js";
import { packs } from "../vendor/fsp-assessment/dist/src/generative/packs.js";
import {
  assessmentNavigation,
  navigateIndependent,
  reopenAnswer,
  restorePendingAnchor,
  type EditableAssessmentSession,
} from "../lib/professional-navigation";
const now = Date.now();
let checks = 0;
function respond(s: EditableAssessmentSession, wrong = false) {
  const item = s.items[s.cursor.item]!.variant,
    step = item.steps[s.cursor.step]!;
  if (step.exploration) {
    for (const a of [...item.artifacts]
      .sort((a, b) => b.usefulness - a.usefulness)
      .slice(0, step.requiredEvidenceSources || 2))
      openEvidence(s, item.id, step.id, a.id, now + 1000);
    answer(s, item.id, step.id, "continue", now + 1000);
  } else {
    const opts = [...step.options].sort(
      (a, b) => step.rubric.scores[a.id]! - step.rubric.scores[b.id]!,
    );
    answer(
      s,
      item.id,
      step.id,
      (wrong ? opts[0] : opts.at(-1))!.id,
      now + 1000,
      item.generated?.responseChecks?.[step.id]?.accepted[0],
    );
  }
}
for (const p of packs.filter((p) => p.enabled))
  for (const grade of ["Junior", "Middle", "Senior"] as const) {
    const seed = createSession(
      "revision-test",
      "synthetic-user",
      grade,
      "revision-" + p.id + grade,
      now,
      undefined,
      undefined,
      { specialization: p.id },
    );
    const edited = structuredClone(seed) as EditableAssessmentSession;
    const first = edited.items[0]!.variant,
      step = first.steps[0]!;
    respond(edited);
    respond(edited);
    const cursor = structuredClone(edited.cursor),
      contributions = structuredClone(edited.contributions),
      progress = publicSession(edited, now).progress;
    navigateIndependent(edited, first.id, step.id, now + 1200);
    assert.deepEqual(edited.cursor, cursor);
    assert.deepEqual(edited.contributions, contributions);
    assert.deepEqual(publicSession(edited, now).progress, progress);
    checks += 3;
    assert(
      assessmentNavigation(edited).find((n) => n.itemId === first.id)
        ?.available,
    );
    checks++;
    const deadline = edited.deadlineAt,
      config = structuredClone(edited.config);
    reopenAnswer(edited, first.id, step.id, now + 1300);
    assert.equal(edited.responses.length, 1);
    assert.equal(publicSession(edited, now).progress.coreCompletedSteps, 1);
    assert(!edited.reviewCursor);
    checks += 3;
    respond(edited, true);
    restorePendingAnchor(edited, true, now + 1400);
    assert.equal(edited.responses.length, 2);
    assert.equal(
      edited.contributions.length,
      new Set(edited.contributions.map((c) => c.observation)).size,
    );
    checks += 2;
    // Pass into a linked case, then rewind. Later dependent evidence is withdrawn; viewed sources are retained.
    while (edited.items[edited.cursor.item]?.stage === "anchors")
      respond(edited);
    respond(edited);
    const evidence = structuredClone(edited.evidenceSelections);
    reopenAnswer(edited, first.id, step.id, now + 1500);
    assert.equal(edited.responses.length, 0);
    assert.deepEqual(edited.evidenceSelections, evidence);
    assert.equal(edited.deadlineAt, deadline);
    assert.deepEqual(edited.config, config);
    checks += 4;
    const expected = structuredClone(seed) as EditableAssessmentSession;
    respond(expected, true);
    respond(edited, true);
    restorePendingAnchor(edited, true, now + 1600);
    for (const s of [expected, edited]) {
      let guard = 0;
      while (s.state === "active") {
        assert(++guard < 70);
        respond(s);
      }
    }
    assert.equal(edited.result?.decision, expected.result?.decision);
    assert.equal(edited.result?.stopReason, expected.result?.stopReason);
    checks += 2;
    assert.deepEqual(
      edited.items.map((i) => i.variant.id),
      expected.items.map((i) => i.variant.id),
    );
    checks++;
    const scores = (s: EditableAssessmentSession) =>
      s.responses.map((r) => [
        r.itemId,
        r.stepId,
        r.optionId,
        r.execution,
        r.contributions,
      ]);
    assert.deepEqual(scores(edited), scores(expected));
    assert.deepEqual(edited.result?.band, expected.result?.band);
    assert.deepEqual(edited.result?.dimensions, expected.result?.dimensions);
    checks += 3;
    assert.throws(() => reopenAnswer(edited, first.id, step.id, now + 1800));
    checks++;
    const expired = structuredClone(seed);
    respond(expired);
    expireSession(expired, now + 1200001);
    assert.throws(() =>
      reopenAnswer(expired, first.id, step.id, now + 1200001),
    );
    checks++;
    console.log("PASS", p.id, grade);
  }
console.log(
  JSON.stringify({
    checks,
    tracks: 12,
    grades: 3,
    algorithm: "native scoring unchanged",
    revisions: "progress, linked invalidation, evidence, timer, frozen results",
  }),
);

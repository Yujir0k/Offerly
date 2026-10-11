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
  navigateIndependent,
  restorePendingAnchor,
  assessmentNavigation,
} from "../lib/professional-navigation";
let checks = 0;
const start = Date.now();
function respond(s: ReturnType<typeof createSession>, quality: number, t: number) {
  const item = s.items[s.cursor.item].variant,
    step = item.steps[s.cursor.step];
  if (step.exploration) {
    for (const a of [...item.artifacts]
      .sort((a, b) => b.usefulness - a.usefulness)
      .slice(0, step.requiredEvidenceSources || 2))
      openEvidence(s, item.id, step.id, a.id, t);
    answer(s, item.id, step.id, "continue", t);
  } else {
    const choices = [...step.options].sort(
      (a, b) => step.rubric.scores[a.id] - step.rubric.scores[b.id],
    );
    const chosen =
      quality === 1
        ? choices.at(-1)
        : quality === 0
          ? choices[0]
          : choices[Math.floor(choices.length / 2)];
    answer(
      s,
      item.id,
      step.id,
      chosen.id,
      t,
      item.generated?.responseChecks?.[step.id]?.accepted[0],
    );
  }
}
for (const pack of packs.filter((p) => p.enabled))
  for (const grade of ["Junior", "Middle", "Senior"] as const) {
    const seed = createSession(
      "nav-test",
      "test-owner",
      grade,
      "navigation-ux-" + pack.id + grade,
      start,
      undefined,
      undefined,
      { specialization: pack.id },
    );
    const native = structuredClone(seed),
      reordered = structuredClone(seed);
    let t = start + 1000;
    const quality = grade === "Junior" ? 1 : grade === "Middle" ? 0.5 : 0;
    const anchorIndices = reordered.items
      .map((item, i) => (item.stage === "anchors" ? i : -1))
      .filter((i) => i >= 0);
    assert(
      anchorIndices.length === 4 &&
        anchorIndices.every(
          (i) => reordered.items[i].variant.steps.length === 1,
        ),
    );
    checks++;
    const linked = reordered.items.find((i) => i.stage === "incident")!;
    assert.throws(() =>
      navigateIndependent(
        reordered,
        linked.variant.id,
        linked.variant.steps[0].id,
        t,
      ),
    );
    checks++;
    for (const i of anchorIndices.toReversed()) {
      const item = reordered.items[i].variant;
      navigateIndependent(reordered, item.id, item.steps[0].id, t);
      const visible = publicSession(reordered, t);
      assert.equal(visible.current?.itemId, item.id);
      assert(!JSON.stringify(visible).includes('"rubric"'));
      checks += 2;
      respond(reordered, quality, t);
      restorePendingAnchor(reordered, true, t);
      t += 1000;
      const priorCursor = structuredClone(reordered.cursor);
      navigateIndependent(reordered, item.id, item.steps[0].id, t);
      assert.deepEqual(reordered.cursor, priorCursor);
      checks++;
    }
    assert.equal(reordered.items[reordered.cursor.item].stage, "incident");
    checks++;
    for (const s of [native, reordered]) {
      let rounds = 0;
      while (s.state === "active") {
        assert(++rounds < 60);
        respond(s, quality, start + rounds * 1000);
      }
    }
    assert.equal(reordered.result?.decision, native.result?.decision);
    assert.equal(reordered.result?.stopReason, native.result?.stopReason);
    assert.deepEqual(
      reordered.items.map((i) => i.variant.id),
      native.items.map((i) => i.variant.id),
    );
    checks += 3;
    const responseScores = (s: ReturnType<typeof createSession>) =>
      s.responses
        .map((r) => [
          r.itemId,
          r.stepId,
          r.contributions.map((c) => ({
            dimension: c.dimension,
            value: c.value,
            weight: c.weight,
            resultWeight: c.resultWeight,
          })),
        ])
        .sort((a, b) =>
          JSON.stringify(a).localeCompare(JSON.stringify(b)),
        );
    assert.deepEqual(responseScores(reordered), responseScores(native));
    checks++;
    assert.deepEqual(reordered.config, native.config);
    checks++;
    for (const key of [
      "estimatedScore",
      "lowerBound",
      "upperBound",
      "cutScore",
    ] as const) {
      assert(
        Math.abs(reordered.result!.band[key] - native.result!.band[key]) <
          1e-12,
      );
      checks++;
    }
    for (const d of reordered.result!.dimensions) {
      const expected = native.result!.dimensions.find(
        (e) => e.dimension === d.dimension,
      )!;
      assert.equal(d.label, expected.label);
      assert(Math.abs(d.score - expected.score) < 1e-12);
      assert(Math.abs(d.coverage - expected.coverage) < 1e-12);
      checks += 3;
    }

    const late = structuredClone(seed);
    expireSession(late, start + 1200001);
    assert(assessmentNavigation(late).every((n) => !n.available));
    checks++;
    console.log("PASS", pack.id, grade);
  }
console.log(
  JSON.stringify({
    checks,
    tracks: 12,
    grades: 3,
    scoring: "native unchanged",
    navigation: "independent anchors only",
  }),
);

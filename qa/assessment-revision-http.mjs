// Run only against the isolated QA app, with assessment-fixture-route installed there.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL;
if (
  !base ||
  !["localhost", "127.0.0.1"].includes(new URL(base).hostname) ||
  new URL(base).port === "5173"
)
  throw Error("Use a separate localhost QA server");
const {
  users: [a, b],
} = JSON.parse(await readFile("/tmp/offerly-assessment-qa.json", "utf8"));
let checks = 0,
  view;
async function call(user, path, body, status = 200, role = "candidate") {
  const res = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Cookie: user.cookie,
      Origin: base,
      "Content-Type": "application/json",
      "X-Offerly-Role": role,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  assert.equal(res.status, status, JSON.stringify(data));
  checks++;
  return data;
}
const root = "/api/professional/adaptive-sessions";
view = await call(a, root, {
  specialization: "backend",
  targetGrade: "Junior",
});
const id = view.id,
  path = root + "/" + id,
  first = view.current,
  deadline = view.deadlineAt;
const input = () => ({
  itemId: view.current.itemId,
  stepId: view.current.step.id,
  interactionRevision: view.interactionRevision,
});
async function respond() {
  const raw = await call(a, "/api/qa-assessment", { id });
  const item = raw.items[raw.cursor.item].variant,
    step = item.steps[raw.cursor.step];
  if (step.exploration) {
    for (const artifact of [...item.artifacts]
      .sort((x, y) => y.usefulness - x.usefulness)
      .slice(0, step.requiredEvidenceSources || 2))
      view = await call(a, path + "/evidence", {
        ...input(),
        artifactId: artifact.id,
      });
  }
  const optionId = step.exploration
    ? "continue"
    : [...step.options].sort(
        (x, y) => step.rubric.scores[y.id] - step.rubric.scores[x.id],
      )[0].id;
  const execution = item.generated?.responseChecks?.[step.id]?.accepted[0];
  view = await call(a, path + "/answer", {
    ...input(),
    optionId,
    ...(execution ? { execution } : {}),
  });
}
await respond();
const initialProgress = view.progress.coreCompletedSteps;
view = await call(a, path + "/navigate", {
  itemId: first.itemId,
  stepId: first.step.id,
  interactionRevision: view.interactionRevision,
});
assert(view.savedAnswer);
assert.equal(view.progress.coreCompletedSteps, initialProgress);
checks += 2;
const publicText = JSON.stringify(view);
for (const key of [
  "rubric",
  "groundTruth",
  "responseChecks",
  "contributions",
  "answerRevisions",
  "reviewCursor",
  "seed",
]) {
  assert(!publicText.includes('"' + key + '"'));
  checks++;
}
const selected = view.savedAnswer.optionId,
  oldRevision = view.interactionRevision;
view = await call(a, path + "/revise", { ...input() });
assert.equal(view.progress.coreCompletedSteps, initialProgress - 1);
assert.equal(view.deadlineAt, deadline);
assert(!view.savedAnswer);
checks += 3;
await call(
  a,
  path + "/answer",
  { ...input(), interactionRevision: oldRevision, optionId: selected },
  409,
);
await call(b, path + "/revise", { ...input() }, 404);
await call(a, path + "/revise", { ...input() }, 403, "employer");
view = await call(a, path);
assert.equal(view.progress.coreCompletedSteps, 0);
checks++;
await respond();
assert.equal(view.progress.coreCompletedSteps, 1);
checks++;
while (view.state === "active") await respond();
assert(view.result);
const result = structuredClone(view.result);
checks++;
await call(
  a,
  path + "/revise",
  {
    itemId: first.itemId,
    stepId: first.step.id,
    interactionRevision: view.interactionRevision,
  },
  409,
);
view = await call(a, path);
assert.deepEqual(view.result, result);
checks++;
const history = await call(a, root);
assert.deepEqual(history.find((s) => s.id === id).result, result);
checks++;
// Active second session remains available for visual QA; first session supplies a real report.
const active = await call(a, root, {
  specialization: "backend",
  targetGrade: "Middle",
});
await writeFile(
  "/tmp/offerly-revision-views.json",
  JSON.stringify({ report: id, active: active.id }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    checks,
    report: id,
    active: active.id,
    foreign: "denied",
    stale: "denied",
    frozen: "passed",
  }),
);

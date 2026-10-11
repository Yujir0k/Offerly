// Disposable policy fixtures, not evidence of assessment accuracy on humans.
import assert from "node:assert/strict";
import { getDb } from "../db";
import { createAccount } from "../lib/platform";
import {
  professionalOperation,
  AssessmentHttpError,
} from "../lib/professional-assessment";
import {
  createSession,
  expireSession,
} from "../vendor/fsp-assessment/dist/src/adaptive/engine.js";
if (
  !process.env.PGLITE_PATH?.startsWith("/tmp/offerly-retakes-") ||
  process.env.DATABASE_URL
)
  throw Error("Disposable database required");
const db = await getDb();
const now = Date.parse("2026-10-10T12:00:00Z"),
  day = 86400000;
let checks = 0;
const account = () => ({
  id: crypto.randomUUID(),
  email: crypto.randomUUID() + "@example.test",
  name: "Policy fixture",
  scope: "public",
  demo: false,
  verified_at: new Date(now).toISOString(),
  deleted_at: null,
});
const confirmed = account(),
  failed = account(),
  fresh = account();
for (const a of [confirmed, failed, fresh]) await createAccount(db, a, null);
async function history(a: any, decision: string) {
  const s = createSession(
    "policy-" + a.id,
    a.id,
    "Middle",
    "policy-fixture",
    now - 1200000,
    undefined,
    undefined,
    { specialization: "backend" },
  );
  expireSession(s, now);
  s.result!.decision = decision as any;
  s.finishedAt = new Date(now).toISOString();
  await db.query(
    "INSERT INTO professional_assessment_records(scope,collection,id,user_id,body) VALUES('public','adaptive-sessions',$1,$2,$3)",
    [s.id, a.id, JSON.stringify(s)],
  );
  // Mark this deliberately synthetic fixture already projected, so no fake grade
  // enters a profile. Only availability rules are under test here.
  await db.query(
    "INSERT INTO assessments(id,user_id,payload) VALUES($1,$2,'{}')",
    [s.id, a.id],
  );
  return s;
}
const frozen = await history(confirmed, "CONFIRMED");
await history(failed, "NOT_CONFIRMED");
for (const grade of ["Junior", "Middle", "Senior"]) {
  await assert.rejects(
    professionalOperation(
      confirmed,
      "start",
      { specialization: "backend", targetGrade: grade },
      now + 90 * day - 1,
    ),
    (e) => e instanceof AssessmentHttpError && e.status === 429,
  );
  checks++;
}
await assert.rejects(
  professionalOperation(
    failed,
    "start",
    { specialization: "backend", targetGrade: "Middle" },
    now + 7 * day - 1,
  ),
  (e) => e instanceof AssessmentHttpError && e.status === 429,
);
checks++;
const lower = await professionalOperation(
  failed,
  "start",
  { specialization: "backend", targetGrade: "Junior" },
  now,
);
assert(lower && !Array.isArray(lower) && lower.state === "active");
checks++;
const pair = await Promise.all([
  professionalOperation(
    fresh,
    "start",
    { specialization: "ios", targetGrade: "Junior" },
    now,
  ),
  professionalOperation(
    fresh,
    "start",
    { specialization: "ios", targetGrade: "Junior" },
    now,
  ),
]);
assert(
  pair[0] &&
    pair[1] &&
    !Array.isArray(pair[0]) &&
    !Array.isArray(pair[1]) &&
    pair[0].id === pair[1].id,
);
checks++;
const rows = (
  await db.query(
    "SELECT body FROM professional_assessment_records WHERE user_id=$1 AND collection='adaptive-sessions'",
    [fresh.id],
  )
).rows;
assert.equal(rows.length, 1);
assert.equal(rows[0].body.retakePolicy.version, "retakes-2026-10-10-v1");
checks += 2;
// Timeout consumption commits the expired snapshot despite denying a new start.
await assert.rejects(
  professionalOperation(
    fresh,
    "start",
    { specialization: "ios", targetGrade: "Junior" },
    now + 1200001,
  ),
  (e) => e instanceof AssessmentHttpError && e.status === 429,
);
checks++;
assert.equal(
  (
    await db.query(
      "SELECT body->>'state' AS state FROM professional_assessment_records WHERE user_id=$1 AND collection='adaptive-sessions'",
      [fresh.id],
    )
  ).rows[0].state,
  "completed",
);
checks++;
const allowed = await professionalOperation(
  confirmed,
  "start",
  { specialization: "backend", targetGrade: "Senior" },
  now + 90 * day,
);
assert(allowed && !Array.isArray(allowed) && allowed.state === "active");
checks++;
assert.deepEqual(
  (
    await db.query(
      "SELECT body FROM professional_assessment_records WHERE id=$1",
      [frozen.id],
    )
  ).rows[0].body,
  frozen,
);
checks++;
console.log(
  JSON.stringify({
    checks,
    transactionalPolicy: true,
    timeoutCommittedOnDenial: true,
    activeResume: true,
    concurrentStarts: true,
    historyByteEquivalent: true,
  }),
);
process.exit(0);

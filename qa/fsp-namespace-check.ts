import assert from "node:assert/strict";
import { FspError } from "../lib/fsp-errors";
import { getDb } from "../db";
import { createAccount } from "../lib/platform";
import { resolveFspIdentity } from "../lib/fsp-identity";
const db = await getDb(),
  id = crypto.randomUUID(),
  email = `fsp-shared-${Date.now()}@example.test`;
const demo = {
  id,
  email,
  name: "Private Demo",
  scope: id,
  demo: true,
  verified_at: null,
  deleted_at: null,
};
await db.transaction((tx) => createAccount(tx, demo, null));
const before = await db.query(
  "SELECT payload FROM candidate_profiles WHERE user_id=$1",
  [id],
);
const result = await resolveFspIdentity({
  issuer: "https://test.example/realms/fsp",
  claims: { sub: id, email, email_verified: true, name: "Real Signup" },
  intent: "register",
  consent: true,
  participantClaim: "fsp_id",
});
assert(!result.account.demo);
assert.notEqual(result.account.id, id);
assert.equal(result.account.email, email);
assert.deepEqual(
  (
    await db.query("SELECT payload FROM candidate_profiles WHERE user_id=$1", [
      id,
    ])
  ).rows,
  before.rows,
);
await assert.rejects(
  resolveFspIdentity({
    issuer: "https://test.example/realms/fsp",
    claims: { sub: id + "-other", email, email_verified: true },
    intent: "register",
    consent: true,
    participantClaim: "fsp_id",
  }),
  (e) => e instanceof FspError && e.code === "existing",
);
console.log(
  JSON.stringify({
    postgresMigration: true,
    demoDoesNotReserveRealEmail: true,
    noMergeOrDemoDataChange: true,
    publicEmailStillUnique: true,
  }),
);
process.exit(0);

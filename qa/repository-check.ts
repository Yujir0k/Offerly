import assert from "node:assert/strict";
import { getDb } from "../db";
import { createAccount, loadPlatform, savePlatform } from "../lib/platform";
const db = await getDb();
const suffix = Date.now();
const a = {
  id: crypto.randomUUID(),
  email: `repository-${suffix}@example.test`,
  name: "Repository Test",
  scope: "public",
  demo: false,
  verified_at: null,
  deleted_at: null,
};
await db.transaction((tx) => createAccount(tx, a, null));
const first = await loadPlatform(a),
  second = await loadPlatform(a);
first.profile.headline = "First update";
second.profile.headline = "Second update";
const attempts = await Promise.allSettled([
  savePlatform(a.id, first),
  savePlatform(a.id, second),
]);
assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
assert(
  attempts.some(
    (r) => r.status === "rejected" && r.reason.message === "CONFLICT",
  ),
);
const viewer = {
  ...a,
  id: crypto.randomUUID(),
  email: `viewer-${suffix}@example.test`,
};
await db.transaction(async (tx) => {
  await createAccount(tx, viewer, null);
  await tx.query("DELETE FROM company_memberships WHERE user_id=$1", [
    viewer.id,
  ]);
  await tx.query(
    "INSERT INTO company_memberships(company_id,user_id,role) VALUES($1,$2,'viewer')",
    [first.company.id, viewer.id],
  );
});
const view = await loadPlatform(viewer);
view.company.name = "Unauthorized edit";
await assert.rejects(savePlatform(viewer.id, view), /Доступ|доступ|права|прав/);
console.log(
  JSON.stringify({ concurrentConflict: true, viewerWriteDenied: true }),
);
process.exit(0);

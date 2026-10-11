import assert from "node:assert/strict";
import { getDb } from "../db";
import { createAccount, loadPlatform } from "../lib/platform";
import { searchCatalog } from "../lib/catalog";
if (
  !process.env.PGLITE_PATH?.startsWith("/tmp/offerly-showcase-policy-") ||
  process.env.DATABASE_URL
)
  throw Error("Disposable database required");
process.env.ENABLE_DEMO_DATA = "true";
const db = await getDb();
const a = {
  id: crypto.randomUUID(),
  email: "showcase-policy@example.test",
  name: "Fixture policy",
  scope: "public",
  demo: false,
  verified_at: new Date().toISOString(),
  deleted_at: null,
};
await createAccount(db, a, null);
let checks = 0;
const shown = await loadPlatform(a);
assert(shown.jobs.some((j) => j.demo));
checks++;
assert(
  (await searchCatalog(a, shown, "candidates", {}, "employer", 1, "market")).total >= 72,
);
checks++;
process.env.ENABLE_DEMO_DATA = "false";
const hidden = await loadPlatform(a);
assert(!hidden.jobs.some((j) => j.demo));
checks++;
assert(!hidden.candidates.some((p) => p.demonstration));
checks++;
assert.equal(
  (await searchCatalog(a, hidden, "candidates", {}, "employer", 1, "market")).total,
  0,
);
checks++;
assert.equal(
  (await searchCatalog(a, hidden, "jobs", {}, "candidate", 1, "market")).total,
  0,
);
checks++;
assert.equal(hidden.catalogStats?.market, 0);
checks++;
process.env.ENABLE_DEMO_DATA = "true";
assert((await loadPlatform(a)).jobs.some((j) => j.demo));
checks++;
console.log(
  JSON.stringify({ checks, fixturesHiddenWithoutDeletingData: true }),
);

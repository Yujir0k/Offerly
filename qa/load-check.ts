import { createHash, randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { getDb } from "../db";
import { createAccount } from "../lib/platform";
const db = await getDb(),
  cookies: string[] = [];
const run = Date.now();
for (let i = 0; i < 50; i++) {
  const account = {
      id: crypto.randomUUID(),
      email: `load-${run}-${i}@example.test`,
      name: "Load Test",
      scope: "public",
      demo: false,
      verified_at: null,
      deleted_at: null,
    },
    token = randomBytes(32).toString("hex");
  await db.transaction(async (tx) => {
    await createAccount(tx, account, null);
    await tx.query(
      "INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",
      [createHash("sha256").update(token).digest("hex"), account.id],
    );
  });
  cookies.push("offerly_session=" + token);
}
const base = process.env.TEST_BASE_URL || "http://localhost:5174",
  latencies: number[] = [],
  errors: number[] = [];
const started = performance.now();
await Promise.all(
  cookies.map(async (cookie, i) => {
    for (let n = 0; n < 3; n++) {
      const at = performance.now();
      const r = await fetch(
        base + "/api/state?role=" + (i % 2 ? "employer" : "candidate"),
        { headers: { Cookie: cookie } },
      );
      await r.arrayBuffer();
      latencies.push(performance.now() - at);
      if (!r.ok) errors.push(r.status);
    }
  }),
);
latencies.sort((a, b) => a - b);
const report = {
  accounts: 50,
  parallelUsers: 50,
  requests: latencies.length,
  elapsedMs: Math.round(performance.now() - started),
  p50ms: Math.round(latencies[Math.floor(latencies.length * 0.5)]),
  p95ms: Math.round(latencies[Math.floor(latencies.length * 0.95)]),
  errors,
  environment:
    "local Next development + PostgreSQL16, empty user profiles, read /api/state; not production capacity",
};
await writeFile("qa/results/latest/load-result.json", JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
process.exit(errors.length ? 1 : 0);

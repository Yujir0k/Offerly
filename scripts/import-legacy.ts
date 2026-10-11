/** Offline import of the user's private local prototype. Never exposes it in the public scope. */
import { readFile } from "node:fs/promises";
import { getDb } from "../db/index";
import { seedDemo } from "../lib/demo-platform";
import { normalizeState } from "../lib/model";
import type { Account } from "../lib/platform";
const input = process.argv[2];
if (!input) throw new Error("Usage: tsx scripts/import-legacy.ts export.json");
const legacy = JSON.parse(await readFile(input, "utf8")) as { workspaces: { owner: string; state: unknown }[]; drafts: { owner: string; id: string; payload: unknown; updated_at: string }[] };
const db = await getDb();
let imported = 0;
for (const row of legacy.workspaces) {
  const id = row.owner;
  const exists = await db.query("SELECT id FROM users WHERE id=$1", [id]);
  if (exists.rows.length) continue;
  const seed = normalizeState(row.state),
    account: Account = {
      id,
      email: seed.profile.email || `demo-${id}@example.test`,
      name: seed.profile.name,
      scope: id,
      demo: true,
      verified_at: null,
      deleted_at: null,
    };
  await seedDemo(account, seed);
  const preferences = {
    settings: seed.settings,
    onboarded: seed.onboarded,
    notifications: seed.notifications,
    journey: seed.journey,
    taskAnswer: seed.taskAnswer,
    role: seed.role,
  };
  await db.query("UPDATE account_state SET payload=$2 WHERE user_id=$1", [
    id,
    JSON.stringify(preferences),
  ]);
  for (const draft of legacy.drafts.filter((d) => d.owner === id))
    await db.query(
      "INSERT INTO drafts(user_id,id,payload,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [id, draft.id, JSON.stringify(draft.payload), draft.updated_at],
    );
  imported++;
}
console.log(JSON.stringify({ imported }));
process.exit(0);

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
await db.waitReady;
for (const f of (await readdir("db/migrations"))
  .filter((f) => f.endsWith(".sql") && !f.startsWith("014_"))
  .sort())
  await db.exec(await readFile("db/migrations/" + f, "utf8"));
let checks = 0;
for (const [id, role, settings] of [
  ["default", "candidate", {}],
  ["withdrawn", "candidate", {}],
  ["privacy", "candidate", { timeZone: "Europe/Moscow" }],
  ["employer", "employer", {}],
  ["deleted", "candidate", {}],
]) {
  await db.query(
    "INSERT INTO users(id,email,name,deleted_at) VALUES($1,$2,'QA',CASE WHEN $1='deleted' THEN now() ELSE NULL END)",
    [id, id + "@example.test"],
  );
  await db.query(
    "INSERT INTO candidate_profiles(user_id,visible,consent,payload) VALUES($1,false,false,$2)",
    [
      id,
      JSON.stringify({
        visible: false,
        consent: false,
        skills: ["Python"],
        grade: null,
      }),
    ],
  );
  await db.query("INSERT INTO account_state(user_id,payload) VALUES($1,$2)", [
    id,
    JSON.stringify({
      role,
      settings: { email: id + "@example.test", ...settings },
    }),
  ]);
  await db.query("INSERT INTO drafts(id,user_id,payload) VALUES($1,$2,$3)", [
    id + ":setup",
    id,
    JSON.stringify({
      step: 1,
      profile: { visible: false, consent: false, city: "Москва" },
    }),
  ]);
}
await db.query(
  "INSERT INTO consent_events(id,user_id,version,purpose,granted) VALUES('withdrawal','withdrawn','test','profile-matching',false)",
);
const migration = await readFile(
  "db/migrations/014_matching_defaults.sql",
  "utf8",
);
await db.exec(migration);
for (const [id, visible, consent] of [
  ["default", true, true],
  ["withdrawn", false, false],
  ["privacy", false, true],
  ["employer", false, false],
  ["deleted", false, false],
]) {
  const {
    rows: [row],
  } = await db.query("SELECT * FROM candidate_profiles WHERE user_id=$1", [id]);
  assert.equal(row.visible, visible, id);
  assert.equal(row.consent, consent, id);
  assert.equal(row.payload.visible, visible);
  assert.equal(row.payload.consent, consent);
  assert.deepEqual(row.payload.skills, ["Python"]);
  assert.equal(row.grade, null);
  checks += 6;
  const {
    rows: [draft],
  } = await db.query("SELECT payload FROM drafts WHERE id=$1", [id + ":setup"]);
  assert.equal(draft.payload.profile.consent, consent);
  assert.equal(draft.payload.profile.visible, visible);
  assert.equal(draft.payload.profile.city, "Москва");
  checks += 3;
}
await db.query(
  "UPDATE candidate_profiles SET visible=false,consent=false WHERE user_id='default'",
);
await db.exec(migration);
assert.equal(
  (
    await db.query(
      "SELECT consent FROM candidate_profiles WHERE user_id='default'",
    )
  ).rows[0].consent,
  false,
);
checks++;
await db.query(
  "INSERT INTO users(id,email,name) VALUES('new','new@example.test','QA')",
);
await db.query(
  "INSERT INTO candidate_profiles(user_id,payload) VALUES('new','{}')",
);
const {
  rows: [fresh],
} = await db.query(
  "SELECT visible,consent FROM candidate_profiles WHERE user_id='new'",
);
assert.deepEqual(fresh, { visible: true, consent: true });
checks++;
// Exercise the actual employer catalogue eligibility SQL with database defaults.
const source = await readFile("lib/catalog.ts", "utf8");
const predicate = source
  .match(/export const eligibleCandidate = `([\s\S]*?)`;/)[1]
  .replaceAll("\\\\", "\\");
await db.query("UPDATE candidate_profiles SET payload=$1 WHERE user_id='new'", [
  JSON.stringify({
    name: "Тест Подбора",
    email: "new@example.test",
    skills: ["Python"],
    roles: ["Backend"],
    city: "Москва",
    salaryMin: 100000,
    salaryMax: 150000,
    jobStatus: "open",
  }),
]);
async function eligible() {
  return (
    await db.query(
      `SELECT (${predicate}) AS eligible FROM candidate_profiles p WHERE p.user_id='new'`,
    )
  ).rows[0].eligible;
}
assert.equal(await eligible(), false);
checks++;
await db.query(
  "UPDATE candidate_profiles SET grade='Junior' WHERE user_id='new'",
);
assert.equal(await eligible(), true);
checks++;
await db.query(
  "UPDATE candidate_profiles SET visible=false WHERE user_id='new'",
);
assert.equal(await eligible(), false);
checks++;
await db.query(
  "UPDATE candidate_profiles SET visible=true,consent=false WHERE user_id='new'",
);
assert.equal(await eligible(), false);
checks++;
await db.query(
  "UPDATE candidate_profiles SET consent=true,payload=jsonb_set(payload,'{jobStatus}','\"paused\"') WHERE user_id='new'",
);
assert.equal(await eligible(), false);
checks++;
await db.close();
console.log(
  `${checks} migration/catalog checks passed: legacy defaults, withdrawals, privacy settings, deleted/employer exclusion, drafts, idempotence, schema defaults, confirmed grade visibility and pause.`,
);

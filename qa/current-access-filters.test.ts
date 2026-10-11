import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import type { Database } from "../db";
import {
  createAccount,
  loadPlatform,
  savePlatform,
  type Account,
} from "../lib/platform";
import { searchCatalog } from "../lib/catalog";
import { createMcpToken, authenticateMcp } from "../lib/mcp-auth";
import { callMcpTool } from "../lib/mcp-tools";
import { decideMcpDraft, listMcpDrafts } from "../lib/mcp-drafts";
import { checkMcpTransport } from "../lib/mcp-policy";
const pg = new PGlite();
for (const f of (await readdir("db/migrations"))
  .filter((v) => v.endsWith(".sql"))
  .sort())
  await pg.exec(await readFile("db/migrations/" + f, "utf8"));
const wrap = (c: Pick<PGlite, "query">): Database => ({
    query: (s, p = []) => c.query(s, p),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  }),
  db = wrap(pg);
(globalThis as typeof globalThis & {offerlyDb?: Promise<Database>}).offerlyDb = Promise.resolve(db);
after(async () => {
  delete (globalThis as typeof globalThis & {offerlyDb?: Promise<Database>}).offerlyDb;
  await pg.close();
});
const person = (id: string, scope = "access-qa"): Account => ({
  id,
  email: id + "@example.test",
  name: "Синтетический " + id,
  scope,
  demo: false,
  verified_at: new Date().toISOString(),
  deleted_at: null,
});
const a = person("alpha"),
  b = person("beta"),
  pure = person("candidate-only");
for (const u of [a, b, pure]) await createAccount(db, u, null);
const sa = await loadPlatform(a),
  sb = await loadPlatform(b);
for (const [u, state] of [
  [a, sa],
  [b, sb],
] as const) {
  Object.assign(state.company, {
    name: "Проверочная компания " + u.id,
    description: "Синтетическая команда разработки",
    email: u.email,
  });
  await db.query("UPDATE companies SET payload=$2 WHERE id=$1", [
    state.company.id,
    JSON.stringify(state.company),
  ]);
}
const candidates: import("../lib/model").Profile[] = [];
for (let i = 0; i < 6; i++) {
  const u = person("filter-" + i, i === 5 ? "foreign-scope" : "access-qa");
  await createAccount(db, u, null);
  const p = (await loadPlatform(u)).profile;
  Object.assign(p, {
    name: "Кандидат " + i,
    email: u.email,
    phone: "+70000000000",
    bio: "Связь hidden@example.test +70000000000",
    skills: i === 2 ? ["React"] : ["Python", "SQL"],
    verified: i === 1 ? ["Python", "SQL"] : [],
    roles: ["Разработчик"],
    specialty: i === 2 ? "Frontend" : "Backend",
    grade: i === 1 ? "Middle" : "Junior",
    claimed: "Junior",
    score: i === 1 ? 100 : 81,
    city: i === 2 ? "Томск" : "Москва",
    region: "Москва",
    preferredLocations: [],
    format: i === 1 ? "Офис" : "Удалённо",
    formats: [i === 1 ? "Офис" : "Удалённо"],
    salaryMin: i === 1 ? 200000 : 100000,
    salaryMax: i === 1 ? 300000 : 160000,
    experience: i === 1 ? 5 : 0,
    visible: i !== 4,
    consent: true,
    jobStatus: "open",
  });
  if (i === 0)
    Object.assign(p, {
      fsp: "QA-FSP-1",
      achievements: ["Тестовый кубок"],
      competitionResults: [
        {
          id: "qa-event",
          title: "Тестовый кубок",
          date: "2026-10-01",
          discipline: "Продуктовая разработка",
          specialties: ["Backend"],
          skills: ["Python"],
          source: "verified",
          result: "prize",
          team: true,
        },
      ],
    });
  await db.query(
    "UPDATE candidate_profiles SET payload=$2,specialty=$3,grade=$4,visible=$5,consent=true WHERE user_id=$1",
    [u.id, JSON.stringify(p), p.specialty, p.grade, p.visible],
  );
  candidates.push(p);
}
const ids = candidates.map((p) => p.id);
const search = async (f: Record<string, unknown> = {}) =>
  searchCatalog(a, sa, "candidates", f, "employer", 1, "market");
test('stored search fields follow profile edits, pause and consent atomically', async () => {
  const p = candidates[0];
  try {
    await db.query("UPDATE candidate_profiles SET payload=jsonb_set(payload,'{skills}','[\"Rust\"]') WHERE id=$1", [p.id]);
    assert(!(await search({ skills: ['Python'], skillSource: 'declared' })).items.some(x => x!.id === p.id));
    assert((await search({ skills: ['Rust'] })).items.some(x => x!.id === p.id));
    await db.query("UPDATE candidate_profiles SET payload=jsonb_set(payload,'{jobStatus}','\"paused\"') WHERE id=$1", [p.id]);
    assert(!(await search()).items.some(x => x!.id === p.id));
    await db.query('UPDATE candidate_profiles SET payload=$2,consent=false WHERE id=$1', [p.id, JSON.stringify(p)]);
    assert(!(await search()).items.some(x => x!.id === p.id));
  } finally {
    await db.query('UPDATE candidate_profiles SET payload=$2,consent=true WHERE id=$1', [p.id, JSON.stringify(p)]);
  }
});
test("candidate filters combine on the server, keep zero experience, intersect salary and honour privacy/scope", async () => {
  assert.equal((await search()).total, 4);
  assert.deepEqual(
    (await search({ fsp: true })).items.map((p) => p!.id),
    [ids[0]],
  );
  assert.equal((await search({ fsp: true, spec: "Frontend" })).total, 0);
  assert.deepEqual(
    (
      await search({
        spec: "Backend",
        grade: "Junior",
        skills: ["Python", "SQL"],
        formats: ["Удалённо"],
        location: "Москва",
        salaryMin: "150000",
        salaryMax: "180000",
        experienceMin: "0",
        experienceMax: "0",
      })
    ).items
      .map((p) => p!.id)
      .sort(),
    [ids[0], ids[3]].sort(),
  );
  assert.deepEqual(
    (
      await search({ skills: ["Python", "SQL"], skillSource: "verified" })
    ).items.map((p) => p!.id),
    [ids[1]],
  );
  assert.equal((await search({ skills: ["React", "SQL"] })).total, 0);
  assert.deepEqual(
    (await search({ query: String(ids[2]) })).items.map((p) => p!.id),
    [ids[2]],
  );
  sa.saved = [ids[0]];
  await db.query(
    "INSERT INTO saved_candidates(user_id,candidate_id) VALUES($1,$2)",
    [a.id, ids[0]],
  );
  assert.deepEqual(
    (await search({ savedOnly: true })).items.map((p) => p!.id),
    [ids[0]],
  );
  await assert.rejects(
    () => search({ salaryMin: "200000", salaryMax: "100000" }),
    /не меньше/,
  );
  const sorted = (await search({ sort: "По результату теста" })).items;
  assert.equal(sorted[0]!.id, ids[1]);
  const json = JSON.stringify(sorted);
  assert(!json.includes("hidden@example.test"));
  assert(!json.includes("+70000000000"));
  await db.query(
    "INSERT INTO blocked_companies(candidate_id,company_id) VALUES($1,$2)",
    [ids[3], sa.company.id],
  );
  assert.equal((await search()).total, 3);
});
test("MCP binds tokens and drafts to the company, hides contacts, rejects candidate membership and respects hidden profiles", async () => {
  await db.query(
    "INSERT INTO blocked_companies(candidate_id,company_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
    [ids[3], sa.company.id],
  );
  process.env.MCP_ENABLED = "true";
  process.env.MCP_TOKEN_ENCRYPTION_KEY = "0123456789abcdef".repeat(4);
  process.env.APP_URL = "http://localhost:5174";
  const ca = { account: a, companyId: sa.company.id, db },
    cb = { account: b, companyId: sb.company.id, db };
  const token = await createMcpToken(ca);
  const context = await authenticateMcp(
    new Request("http://localhost:5174/api/mcp", {
      headers: { Authorization: "Bearer " + token },
    }),
  );
  assert.equal(context.companyId, sa.company.id);
  const result = (await callMcpTool(context, "search_candidates", {})) as { total: number };
  assert.equal(result.total, 3);
  const json = JSON.stringify(result);
  for (const k of [
    "email",
    "phone",
    "name",
    "resumeKey",
    "avatarKey",
    "bio",
    "workHistory",
  ])
    assert(!json.includes('"' + k + '"'));
  for (const id of [ids[3], ids[4], ids[5]])
    await assert.rejects(
      () => callMcpTool(context, "get_candidate_profile", { candidateId: id }),
      /недоступен/,
    );
  const draft = (await callMcpTool(context, "draft_invitation", {
    candidateId: ids[0],
    title: "Тестовое приглашение",
    description: "Проверка прав разных компаний",
    salaryMin: 150000,
    salaryMax: 200000,
    requestId: "company-access-check-01",
  })) as { sent: boolean; draftId: string };
  assert.equal(draft.sent, false);
  assert.equal((await listMcpDrafts(cb)).length, 0);
  await assert.rejects(
    () => decideMcpDraft(cb, draft.draftId, "approve"),
    /недоступен/,
  );
  assert.equal((await db.query("SELECT * FROM invitations")).rows.length, 0);
  await decideMcpDraft(ca, draft.draftId, "approve");
  assert.equal((await db.query("SELECT * FROM invitations")).rows.length, 1);
  const recipient = person("filter-0"),
    beforeContact = await searchCatalog(
      b,
      sb,
      "candidates",
      { ids: [ids[0]] },
      "employer",
      1,
      "market",
    );
  assert(
    !(beforeContact.items[0] && "email" in beforeContact.items[0]
      ? beforeContact.items[0].email
      : undefined),
  );
  const accepted = await loadPlatform(recipient);
  accepted.invitations[0].status = "accepted";
  accepted.invitations[0].respondedAt = new Date().toISOString();
  await savePlatform(recipient.id, accepted);
  const ownContact = await searchCatalog(
    a,
    await loadPlatform(a),
    "candidates",
    { ids: [ids[0]] },
    "employer",
    1,
    "market",
  );
  assert.equal(
    ownContact.items[0] && "email" in ownContact.items[0]
      ? ownContact.items[0].email
      : undefined,
    recipient.email,
  );
  const otherContact = await searchCatalog(
    b,
    await loadPlatform(b),
    "candidates",
    { ids: [ids[0]] },
    "employer",
    1,
    "market",
  );
  assert(
    !(otherContact.items[0] && "email" in otherContact.items[0]
      ? otherContact.items[0].email
      : undefined),
  );
  const agentContact = await callMcpTool(context, "get_candidate_profile", {
    candidateId: ids[0],
  });
  assert(!JSON.stringify(agentContact).includes(recipient.email));
  await db.query(
    "UPDATE company_memberships SET role='viewer' WHERE user_id=$1",
    [a.id],
  );
  await assert.rejects(
    () =>
      authenticateMcp(
        new Request("http://localhost:5174/api/mcp", {
          headers: { Authorization: "Bearer " + token },
        }),
      ),
    /Нет прав/,
  );
  const sp = await loadPlatform(pure);
  const bad = await createMcpToken({
    account: pure,
    companyId: sp.company.id,
    db,
  });
  await assert.rejects(
    () =>
      authenticateMcp(
        new Request("http://localhost:5174/api/mcp", {
          headers: { Authorization: "Bearer " + bad },
        }),
      ),
    /Нет прав/,
  );
  assert.throws(
    () =>
      checkMcpTransport(
        new Request("http://localhost:5174/api/mcp", {
          headers: { Host: "localhost:5174", Origin: "https://foreign.test" },
        }),
      ),
    /источник/,
  );
});

test('read-only catalogue context preserves current results and contact permissions without dashboard/history reads', async()=>{
 for(const account of [a,b]) {
  const full=await loadPlatform(account),lean=await loadPlatform(account,{catalogOnly:true});
  for(const [kind,role,filters] of [
   ['candidates','employer',{}],['candidates','employer',{skills:['Python']}],
   ['candidates','employer',{savedOnly:true}],['candidates','employer',{sort:'По зарплате'}],
   ['jobs','candidate',{}],['jobs','candidate',{favoritesOnly:true}],
   ['jobs','candidate',{applicationsOnly:true}],['jobs','employer',{}],
  ] as const) assert.deepEqual(await searchCatalog(account,lean,kind,filters,role,1,null),await searchCatalog(account,full,kind,filters,role,1,null));
  assert.equal(lean.attempts.length,0);assert.equal(lean.surveys.length,0);
  await assert.rejects(savePlatform(account.id,lean),/AUTH/);
 }
});

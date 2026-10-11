import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
const qaRoot = (await readFile("/tmp/offerly-resume-qa-root", "utf8")).trim();
assert(qaRoot.startsWith(tmpdir()) && qaRoot.includes("offerly-resume-qa-"));
assert.notEqual(resolve(qaRoot), resolve("."));
const dir = await mkdtemp(join(tmpdir(), "offerly-invites-"));
const base = "http://127.0.0.1:5174";
const headers = {
  Cookie: "__sites_local_auth=1",
  Origin: base,
  "Content-Type": "application/json",
};
async function state(role = "candidate") {
  const r = await fetch(base + "/api/state?role=" + role, { headers });
  assert.equal(r.status, 200);
  return r.json();
}
async function action(type, data = {}, role = "candidate", status = 200) {
  const r = await fetch(base + "/api/action", {
    method: "POST",
    headers,
    body: JSON.stringify({ type, role, ...data }),
  });
  const body = await r.json();
  assert.equal(r.status, status, JSON.stringify(body.error));
  return body;
}
try {
  await build({
    entryPoints: ["lib/invitations.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: join(dir, "invitations.mjs"),
  });
  const { exampleInvitations, invitationUnread, invitationMatches } =
    await import(join(dir, "invitations.mjs"));
  const rows = exampleInvitations(1042);
  assert.equal(rows.filter(invitationUnread).length, 2);
  assert.equal(rows.filter((i) => invitationMatches(i, "read")).length, 2);
  assert.equal(
    invitationUnread({ ...rows[0], readAt: new Date().toISOString() }),
    false,
  );
  assert.equal(
    invitationMatches({ ...rows[0], status: "viewed" }, "read"),
    true,
  );
  assert.equal(invitationMatches(rows[3], "accepted"), true);
  // Seed only this disposable QA database; never the main workspace database.
  function seed(includeOrion) {
    const result = spawnSync(
      "python3",
      [
        "-c",
        `import json,sqlite3,glob,sys
root=sys.argv[1]
paths=[p for p in glob.glob(root+'/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite') if not p.endswith('metadata.sqlite')]
assert len(paths)==1
c=sqlite3.connect(paths[0]); owner,payload,version=c.execute('select owner,payload,version from workspaces').fetchone();s=json.loads(payload);s['version']=version+1
s['profile'].update(visible=True,consent=True,grade='Middle',specialty='Backend',verified=['Python','SQL'],score=86,jobStatus='looking');s['applications']=[]
rows=json.loads(sys.argv[2]);s['invitations']=rows
for i in s['invitations']:i['candidateId']=s['profile']['id']
c.execute('update workspaces set payload=?,version=? where owner=?',(json.dumps(s,ensure_ascii=False),s['version'],owner));c.commit()
`,
        qaRoot,
        JSON.stringify(includeOrion ? rows : rows.slice(1)),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  await state();
  seed(false);
  const initial = await state();
  const candidateId = initial.profile.id;
  const sent = await action(
    "invite",
    {
      candidateId,
      title: "Backend-разработчик Python",
      description: rows[0].description,
      min: 220000,
      max: 280000,
      contact: "team@example.test",
      format: "Удалённо",
      city: "Москва",
      grade: "Middle",
      skills: ["Python", "FastAPI", "PostgreSQL"],
    },
    "employer",
  );
  const invite = sent.invitations[0];
  assert.equal(invite.status, "sent");
  assert.equal(invite.city, "Москва");
  assert.equal(invite.format, "Удалённо");
  assert.equal(invite.skills.length, 3);
  assert(sent.invitations.every((i) => i.company === sent.company.name));
  await action(
    "invite",
    {
      candidateId,
      title: "Повторное приглашение",
      description: "Предложение",
      min: 220000,
      max: 280000,
      contact: "team@example.test",
    },
    "employer",
    400,
  );
  const hidden = sent.candidates.find((p) => p.id === candidateId);
  assert(hidden && !hidden.email && !hidden.phone);
  const candidate = await state();
  assert(candidate.invitations.some((i) => i.id === invite.id));
  assert(candidate.invitations.every((i) => i.candidateId === candidateId));
  await action(
    "respond",
    { id: invite.id, status: "accepted" },
    "employer",
    400,
  );
  await action(
    "respond",
    { id: "missing-invitation", status: "viewed" },
    "candidate",
    400,
  );
  const viewed = await action("respond", { id: invite.id, status: "viewed" });
  const read = viewed.invitations.find((i) => i.id === invite.id);
  assert.equal(read.status, "viewed");
  assert(read.readAt);
  assert(!read.respondedAt);
  const stillHidden = (await state("employer")).candidates.find(
    (p) => p.id === candidateId,
  );
  assert(!stillHidden.email && !stillHidden.phone);
  const accepted = await action("respond", {
    id: invite.id,
    status: "accepted",
  });
  const decision = accepted.invitations.find((i) => i.id === invite.id);
  assert.equal(decision.status, "accepted");
  assert.equal(decision.readAt, read.readAt);
  assert(decision.respondedAt);
  const shared = (await state("employer")).candidates.find(
    (p) => p.id === candidateId,
  );
  assert.equal(shared.email, initial.profile.email);
  assert.equal(shared.phone, initial.profile.phone);
  await action(
    "respond",
    { id: invite.id, status: "declined" },
    "candidate",
    400,
  );
  const declined = await action("respond", {
    id: rows[1].id,
    status: "declined",
  });
  assert(declined.invitations.find((i) => i.id === rows[1].id).respondedAt);
  seed(true);
  console.log(
    "Invitation filters, legacy read states, employer→candidate delivery, offer metadata, read/decision timestamps, contact consent and terminal responses passed in isolated QA.",
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}

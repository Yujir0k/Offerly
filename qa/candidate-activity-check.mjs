import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
const root = (await readFile("/tmp/offerly-resume-qa-root", "utf8")).trim();
assert(root.startsWith(tmpdir()) && root.includes("offerly-resume-qa-"));
const dir = await mkdtemp(join(tmpdir(), "offerly-activity-"));
const base = "http://127.0.0.1:5174";
const headers = {
  Cookie: "__sites_local_auth=1",
  Origin: base,
  "Content-Type": "application/json",
};
const checks = [];
async function request(
  path,
  payload,
  status = 200,
  method = payload ? "POST" : "GET",
) {
  const r = await fetch(base + path, {
    method,
    headers,
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const b = await r.json();
  assert.equal(r.status, status, JSON.stringify(b.error));
  return b;
}
const action = (type, data = {}, status = 200) =>
  request("/api/action", { type, role: "candidate", ...data }, status);
try {
  await build({
    entryPoints: [
      "lib/candidate-dashboard.ts",
      "lib/account-settings.ts",
      "lib/model.ts",
      "lib/invitations.ts",
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    outdir: dir,
  });
  const { initialState } = await import(join(dir, "model.js"));
  const { exampleInvitations } = await import(join(dir, "invitations.js"));
  const { dashboardActivity } = await import(
    join(dir, "candidate-dashboard.js")
  );
  const {
    userSettings,
    accountNotifications,
    displayDate,
    deletedAccountState,
  } = await import(join(dir, "account-settings.js"));
  const s = initialState();
  s.invitations = [
    ...exampleInvitations(s.profile.id),
    { ...exampleInvitations(9999)[0], id: "foreign" },
  ];
  s.applications = [
    {
      jobId: "missing",
      candidateId: 9999,
      status: "viewed",
      createdAt: new Date().toISOString(),
    },
  ];
  const a = dashboardActivity(s);
  assert.equal(a.invitations.length, 4);
  assert.equal(a.unread, 2);
  assert.equal(a.applications.length, 0);
  assert(a.recent.every((j) => j.specialty === s.profile.specialty));
  s.jobs = [
    { ...s.jobs[0], id: "future", publishedAt: "2099-01-01T00:00:00Z" },
    { ...s.jobs[0], id: "old", publishedAt: "2020-01-01T00:00:00Z" },
  ];
  assert.equal(dashboardActivity(s).recent.length, 0);
  assert.equal(dashboardActivity(s).opportunities.length, 2);
  s.settings = { ...userSettings(s), timeZone: "Europe/Moscow" };
  const day1 = displayDate("2026-10-07T16:00:00Z", s, {
    day: "numeric",
    month: "numeric",
  });
  s.settings.timeZone = "Asia/Vladivostok";
  assert.notEqual(
    displayDate("2026-10-07T16:00:00Z", s, {
      day: "numeric",
      month: "numeric",
    }),
    day1,
  );
  s.settings.snoozedUntil = "2099-01-01T00:00:00Z";
  assert.equal(accountNotifications(s).length, 0);
  s.settings.snoozedUntil = null;
  assert(accountNotifications(s).length);
  s.settings.notificationReadAt = new Date(Date.now() + 1000).toISOString();
  assert.equal(accountNotifications(s).length, 0);
  const cleared = deletedAccountState(s);
  assert(cleared.accountDeletedAt);
  assert(
    !cleared.profile.email && !cleared.profile.name && !cleared.profile.grade,
  );
  assert(!cleared.applications.length && !cleared.invitations.length);
  checks.push(
    "Own data only, read/unread, recent date boundaries, matching, timezone day boundary, notification pause/read, deletion reset",
  );
  await action(
    "account-settings",
    {
      ...userSettings(s),
      timeZone: "Invalid/Zone",
      notifications: true,
      visible: true,
      snooze: "off",
    },
    400,
  );
  await action("account-email", { email: "bad" }, 400);
  let state = await action("account-email", { email: "activity@example.test" });
  assert.equal(state.profile.email, "activity@example.test");
  assert.equal(state.emailVerification.status, "unverified");
  state = await action("account-settings", {
    ...userSettings(state),
    timeZone: "Asia/Vladivostok",
    notifications: true,
    visible: true,
    snooze: "7",
    emailDigest: "weekly",
  });
  assert.equal(state.settings.timeZone, "Asia/Vladivostok");
  assert(Date.parse(state.settings.snoozedUntil) > Date.now());
  assert.equal(state.settings.emailDigest, "weekly");
  await action("notifications-read");
  assert(
    (await request("/api/state?role=candidate")).settings.notificationReadAt,
  );
  checks.push(
    "Settings/email server validation and persistence, notification read marker",
  );
  state = await action("onboard", {
    name: "Проверочный Кандидат",
    email: "activity@example.test",
    consent: true,
  });
  const profile = {
    ...state.profile,
    claimed: "Middle",
    specialty: "Backend",
    skills: ["Python", "SQL", "FastAPI"],
    roles: ["Разработчик"],
    city: "Москва",
    salaryMin: 180000,
    salaryMax: 360000,
    experience: 3,
    consent: true,
    formats: ["Любой"],
    employmentTypes: ["Полная занятость"],
    preferredIndustries: [],
    availabilities: ["Сразу"],
    phone: "+7 (999) 123-45-67",
  };
  state = await action("profile", profile);
  assert.equal(state.journey, "survey");
  const survey = {
    industry: "Разработка цифровых продуктов",
    specialty: "Backend",
    grade: "Middle",
    roles: ["Разработчик"],
    experience: 3,
    goal: "Развивать API",
  };
  state = await action("survey", survey);
  assert.equal(state.journey, "assessment");
  async function complete(correct) {
    let current = await action("start", {
      specialty: "Backend",
      grade: "Middle",
    });
    const attempt = current.attempts.find((a) => !a.completedAt);
    assert.equal(attempt.questions.length, 4);
    assert(attempt.questions.every((q) => !("correct" in q)));
    await action("finish", { id: attempt.id }, 400);
    for (const q of attempt.questions) {
      let answer = "Неверный ответ";
      if (correct)
        answer =
          {
            Python: "3",
            API: "Idempotency key и проверка на сервере",
            Архитектура: "Одна транзакция",
          }[q.family] || q.options.find((o) => o.startsWith("HAVING"));
      await action("answer", { id: attempt.id, question: q.id, answer });
    }
    return action("finish", { id: attempt.id });
  }
  state = await complete(false);
  assert.equal(state.profile.grade, null);
  state = await complete(true);
  assert.equal(state.profile.grade, "Middle");
  assert.equal(state.attempts[0].score, 100);
  assert.deepEqual(state.profile.verified, ["Python", "SQL"]);
  state = await complete(false);
  assert.equal(state.profile.grade, "Middle");
  await action("survey", { ...survey, grade: "Junior" });
  await action("start", { specialty: "Backend", grade: "Junior" }, 400);
  await action("survey", survey);
  state = await action("task", {
    answer:
      "Проверить idempotency key на сервере, сохранить результат в транзакции и вернуть прежний заказ при повторе.",
  });
  assert(state.profile.freshAt);
  checks.push(
    "Profile→survey→test→results, no answer keys, fail/pass, competencies, unchanged grade after failure, 90 day cooldown, task answer",
  );
  await request(
    "/api/drafts?key=profile",
    { value: { secret: "test-only" } },
    200,
    "PUT",
  );
  const avatar = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jp1sAAAAASUVORK5CYII=",
    "base64",
  );
  const form = new FormData();
  form.set("file", new Blob([avatar], { type: "image/png" }), "test.png");
  const uploaded = await fetch(base + "/api/avatar", {
    method: "POST",
    headers: { Cookie: headers.Cookie, Origin: base },
    body: form,
  });
  assert.equal(uploaded.status, 200);
  assert.equal((await fetch(base + "/api/avatar", { headers })).status, 200);
  await action(
    "delete-account",
    { confirmation: "NO", email: "activity@example.test" },
    400,
  );
  state = await action("delete-account", {
    confirmation: "УДАЛИТЬ",
    email: "activity@example.test",
  });
  assert(state.accountDeletedAt);
  assert(
    !state.profile.name &&
      !state.profile.email &&
      !state.profile.avatarKey &&
      !state.attempts.length &&
      !state.surveys.length,
  );
  assert.equal((await fetch(base + "/api/avatar", { headers })).status, 404);
  assert.equal((await request("/api/drafts?key=profile")).value, null);
  await request(
    "/api/drafts?key=profile",
    { value: { name: "resurrect" } },
    400,
    "PUT",
  );
  await action("profile", profile, 400);
  assert((await request("/api/state?role=candidate")).accountDeletedAt);
  checks.push(
    "Delete confirmation, account data/history/drafts/file removal, persistent tombstone, stale writes rejected",
  );
  // Prepare fictional activity for browser verification, exclusively in the disposable QA workspace.
  state = await action("onboard", {
    name: "Алексей Крылов",
    email: "alex@example.test",
    consent: true,
  });
  state = await action("profile", {
    ...profile,
    email: "alex@example.test",
    name: "Алексей Крылов",
    firstName: "Алексей",
    lastName: "Крылов",
    headline: "Backend-разработчик",
    bio: "Развиваю API и продуктовые сервисы.",
  });
  await action("survey", survey);
  state = await complete(true);
  const fixture = {
    invitations: exampleInvitations(state.profile.id),
    applications: state.jobs
      .filter((j) => j.specialty !== state.profile.specialty)
      .slice(0, 3)
      .map((job, i) => ({
        id: "qa-application-" + i,
        jobId: job.id,
        candidateId: state.profile.id,
        status: ["sent", "viewed", "declined"][i],
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date(Date.now() - i * 3600000).toISOString(),
      })),
  };
  const seeded = spawnSync(
    "python3",
    [
      "-c",
      `import sqlite3,glob,json,sys
paths=[p for p in glob.glob(sys.argv[1]+'/.wrangler/state/v3/d1/miniflare-D1DatabaseObject/*.sqlite') if not p.endswith('metadata.sqlite')];assert len(paths)==1
c=sqlite3.connect(paths[0]);owner,payload,version=c.execute('select owner,payload,version from workspaces').fetchone();s=json.loads(payload);s.update(json.loads(sys.argv[2]));s['version']=version+1;c.execute('update workspaces set payload=?,version=? where owner=?',(json.dumps(s,ensure_ascii=False),s['version'],owner));c.commit()`,
      root,
      JSON.stringify(fixture),
    ],
    { encoding: "utf8" },
  );
  assert.equal(seeded.status, 0, seeded.stderr);
  await writeFile(
    "qa/2026-10-07-candidate-path/checks.json",
    JSON.stringify({ checks, passed: true }, null, 2),
  );
  console.log(checks.join("\n"));
} finally {
  await rm(dir, { recursive: true, force: true });
}

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://localhost:5174";
if (!["localhost","127.0.0.1"].includes(new URL(base).hostname) || new URL(base).port === "5173") throw Error("Use isolated QA app with qa-assessment fixture");
const users = [];
const run = Date.now();
let checks = 0;
async function call(user, path, data, expected = 200) {
  const r = await fetch(base + path, {
    method: data ? "POST" : "GET",
    headers: {
      Origin: base,
      ...(path.startsWith("/api/professional/") ? {"X-Offerly-Role":"candidate"} : {}),
      "Content-Type": "application/json",
      ...(user.cookie ? { Cookie: user.cookie } : {}),
    },
    body: data ? JSON.stringify(data) : undefined,
  });
  const b = await r.json();
  if (r.headers.get("set-cookie"))
    user.cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal(r.status, expected, JSON.stringify(b));
  checks++;
  return b;
}
for (let i = 0; i < 3; i++) {
  const u = { email: `session-qa-platform-${run}-${i}@example.test` };
  u.state = await call(u, "/api/auth", {
    type: "register",
    role: "candidate",
    email: u.email,
    name: `Тестовый Пользователь ${i}`,
    password: "test-password-1234",
    consent: true,
  });
  users.push(u);
  assert(u.state.jobs.some(j => j.id.startsWith("offerly-market-example-") && j.demo));
}
const [a, b, c] = users;
await call(
  a,
  "/api/action",
  {
    type: "invite",
    role: "employer",
    candidateId: b.state.profile.id,
    title: "Новая роль",
    description: "Предложение",
    min: 100000,
    max: 200000,
    contact: a.email,
  },
  400,
);
for (const u of users) {
  await call(u, "/api/action", { type: "email-request", automatic: true });
  const dir = process.env.TEST_MAIL_DIR || ".data/mail-outbox";
  const messages = await Promise.all(
    (await readdir(dir)).map(async (f) =>
      JSON.parse(await readFile(dir + "/" + f, "utf8")),
    ),
  );
  const mail = messages.find((m) => m.to === u.email);
  assert(mail);
  await call(u, "/api/action", {
    type: "email-confirm",
    code: mail.text.match(/\d{6}/)[0],
  });
  await call(
    u,
    "/api/action",
    { type: "email-confirm", code: mail.text.match(/\d{6}/)[0] },
    400,
  );
}
for (const u of users) {
  u.state = await call(u, "/api/state?role=candidate");
  u.state = await call(u, "/api/action", {
    ...u.state.profile,
    type: "profile",
    role: "candidate",
    phone: "+79991234567",
    city: "Москва",
    skills: ["Python", "SQL"],
    roles: ["Backend-разработчик"],
    salaryMin: 100000,
    salaryMax: 200000,
    consent: true,
    visible: true,
    availability: "В течение месяца",
  });
}
for (const u of users)
  await call(u, "/api/action", {
    type: "privacy",
    role: "candidate",
    visible: true,
    notifications: true,
  });
for (const [i, u] of users.entries()) {
  u.state = await call(u, "/api/action", {
    type: "company",
    role: "employer",
    name: `QA Компания ${i}`,
    email: u.email,
    description: "Разработка программного обеспечения",
  });
}
// The catalog must contain certified candidates only. Certify through the actual engine.
let attempt = await call(b, "/api/professional/adaptive-sessions", {specialization:"backend",targetGrade:"Junior"});
while (attempt.state === "active") {
 const raw = await call(b,"/api/qa-assessment",{id:attempt.id});
 const item=raw.items[raw.cursor.item].variant, step=item.steps[raw.cursor.step];
 if (step.exploration) for (const artifact of [...item.artifacts].sort((x,y)=>y.usefulness-x.usefulness).slice(0,step.requiredEvidenceSources||2)) attempt=await call(b,`/api/professional/adaptive-sessions/${attempt.id}/evidence`,{itemId:item.id,stepId:step.id,artifactId:artifact.id,interactionRevision:attempt.interactionRevision});
 const optionId=step.exploration?"continue":[...step.options].sort((x,y)=>step.rubric.scores[y.id]-step.rubric.scores[x.id])[0].id;
 const execution=item.generated?.responseChecks?.[step.id]?.accepted[0];
 attempt=await call(b,`/api/professional/adaptive-sessions/${attempt.id}/answer`,{itemId:item.id,stepId:step.id,optionId,...(execution?{execution}:{}),interactionRevision:attempt.interactionRevision});
}
assert.equal(attempt.result.decision,"CONFIRMED");
let employer = await call(a, "/api/state?role=employer");
const candidate = (await call(a, `/api/catalog/candidates?role=employer&filters=${encodeURIComponent(JSON.stringify({query:String(b.state.profile.id)}))}`)).items.find((p) => p.id === b.state.profile.id);
assert(candidate);
assert.equal(candidate.email, "");
assert.equal(candidate.phone, "");
assert.equal(candidate.grade, "Junior");
employer = await call(a, "/api/action", {
  type: "invite",
  role: "employer",
  candidateId: b.state.profile.id,
  title: "Backend",
  description: "Обсудим продукт и задачи",
  min: 100000,
  max: 200000,
  contact: a.email,
});
const invite = employer.invitations.find(
  (i) => i.candidateId === b.state.profile.id,
);
assert(invite);
const recipient = await call(b, "/api/state?role=candidate");
assert(recipient.invitations.some((i) => i.id === invite.id));
assert(
  !(await call(c, "/api/state?role=candidate")).invitations.some(
    (i) => i.id === invite.id,
  ),
);
await call(
  c,
  "/api/action",
  { type: "respond", role: "candidate", id: invite.id, status: "accepted" },
  400,
);
await call(b, "/api/action", {
  type: "respond",
  role: "candidate",
  id: invite.id,
  status: "accepted",
});
assert.equal(
  (await call(a, "/api/state?role=employer")).candidates.find(
    (p) => p.id === b.state.profile.id,
  ).email,
  b.email,
);
assert.equal(
  (await call(c, `/api/catalog/candidates?role=employer&filters=${encodeURIComponent(JSON.stringify({query:String(b.state.profile.id)}))}`)).items.find(p => p.id === b.state.profile.id).email,
  "",
);
const revealed = (await call(a, "/api/state?role=employer")).candidates.find(
  (p) => p.id === b.state.profile.id,
);
assert(revealed.phone.includes("123"));
assert.equal(
  (await call(c, `/api/catalog/candidates?role=employer&filters=${encodeURIComponent(JSON.stringify({query:String(b.state.profile.id)}))}`)).items.find(p => p.id === b.state.profile.id).phone,
  "",
);
const jobData = {
  type: "job",
  role: "employer",
  title: "Backend QA",
  description: "Задачи разработки API",
  specialty: "Backend",
  grade: "Junior",
  format: "Удалённо",
  skills: ["Python"],
  min: 100000,
  max: 200000,
  status: "published",
};
employer = await call(a, "/api/action", jobData);
const job = employer.jobs.find((j) => j.title === jobData.title && j.companyId === employer.company.id);
assert(job);
await call(
  c,
  "/api/action",
  { ...jobData, id: job.id, title: "Чужая правка" },
  400,
);
await call(b, "/api/action", {
  type: "apply",
  role: "candidate",
  id: job.id,
  shareContacts: true,
  message: "Хочу обсудить",
});
employer = await call(a, "/api/state?role=employer");
const app = employer.applications.find((x) => x.jobId === job.id);
assert(app);
assert(app.candidate.phone.includes("123"));
assert.equal(app.candidate.email, b.email);
assert(
  !(await call(c, "/api/state?role=employer")).applications.some(
    (x) => x.id === app.id,
  ),
);
await call(
  c,
  "/api/action",
  {
    type: "application-status",
    role: "employer",
    id: app.id,
    jobId: job.id,
    status: "Просмотрен",
  },
  400,
);
await call(a, "/api/action", {
  type: "application-status",
  role: "employer",
  id: app.id,
  jobId: job.id,
  status: "Просмотрен",
});
assert.equal(
  (await call(b, "/api/state?role=candidate")).applications.find(
    (x) => x.id === app.id,
  ).status,
  "Просмотрен",
);
employer = await call(a, "/api/action", {
  ...jobData,
  title: "Секретный черновик",
  status: "draft",
});
assert(
  !(await call(b, "/api/state?role=candidate")).jobs.some(
    (j) => j.title === "Секретный черновик",
  ),
);
const demo = {};
const ds = await call(demo, "/api/auth", {
  type: "demo-login",
  role: "employer",
});
assert(!ds.candidates.some((p) => p.id === b.state.profile.id));
assert(!ds.jobs.some((j) => j.id === job.id));
await call(a, "/api/auth", { type: "logout" });
await call(a, "/api/state?role=employer", null, 401);
await call(
  a,
  "/api/auth",
  { type: "login", role: "employer", email: a.email, password: "wrong" },
  400,
);
const login = await call(a, "/api/auth", {
  type: "login",
  role: "employer",
  email: a.email,
  password: "test-password-1234",
});
assert(login.invitations.some((i) => i.id === invite.id));
await call(c, "/api/action", {type:"delete-account", confirmation:"УДАЛИТЬ",email:c.email,role:"candidate"});
await call(c,"/api/state?role=candidate",null,401);
const removed = await call(a,"/api/state?role=employer");
assert(!removed.candidates.some(p=>p.id===c.state.profile.id));
console.log(
  JSON.stringify({
    checks,
    sharedInvitations: true,
    sharedApplications: true,
    contactPermissions: true,
    foreignWritesDenied: true,
    demoIsolated: true,
    loginPersistence: true,
  }),
);

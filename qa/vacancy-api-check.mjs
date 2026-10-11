import assert from "node:assert/strict";
// Only the isolated, disposable QA preview; never the user's 5173 workspace.
const base = "http://127.0.0.1:5174";
const headers = {
  Cookie: "__sites_local_auth=1",
  "Content-Type": "application/json",
  Origin: base,
};
async function action(type, body = {}, role = "candidate", expected = 200) {
  const r = await fetch(`${base}/api/action`, {
    method: "POST",
    headers,
    body: JSON.stringify({ type, role, ...body }),
  });
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data));
  return data;
}
async function state(role = "candidate") {
  const r = await fetch(`${base}/api/state?role=${role}`, { headers });
  assert.equal(r.status, 200);
  return r.json();
}
await action("onboard", {
  name: "Александр Тестовый",
  email: "candidate@example.test",
  consent: true,
});
let s = await state();
await action("profile-draft", {
  ...s.profile,
  name: "Александр Тестовый",
  email: "candidate@example.test",
  phone: "+7 900 000-00-00",
  city: "Москва",
  headline: "Python-разработчик",
  skills: ["Python", "SQL", "FastAPI"],
  roles: ["Backend-разработчик"],
  consent: false,
  claimed: "Middle",
  specialty: "Backend",
});
await action(
  "apply",
  { id: "job-backend", message: "", shareContacts: false },
  "candidate",
  400,
);
await action(
  "apply",
  { id: "missing", message: "", shareContacts: true },
  "candidate",
  400,
);
await action(
  "apply",
  { id: "job-backend", message: "x".repeat(2001), shareContacts: true },
  "candidate",
  400,
);
await action(
  "apply",
  {
    id: "job-backend",
    message: "Сообщение тестового кандидата. Интересны задачи команды.",
    shareContacts: true,
  },
  "employer",
  400,
);
s = await action("apply", {
  id: "job-backend",
  message: "Сообщение тестового кандидата. Интересны задачи команды.",
  shareContacts: true,
});
assert.equal(s.applications.length, 1);
assert.equal(s.applications[0].candidate.email, "candidate@example.test");
await action(
  "apply",
  { id: "job-backend", message: "", shareContacts: true },
  "candidate",
  400,
);
await action("apply", { id: "job-go", message: "", shareContacts: true });
let employer = await state("employer");
assert.equal(employer.applications.length, 1);
assert.equal(employer.applications[0].jobId, "job-backend");
assert.equal(employer.profile.email, "");
await action(
  "application-status",
  {
    jobId: "job-go",
    id: (await state()).applications.find((a) => a.jobId === "job-go").id,
    status: "Просмотрен",
  },
  "employer",
  400,
);
await action(
  "application-status",
  {
    jobId: "job-backend",
    id: employer.applications[0].id,
    status: "Просмотрен",
  },
  "candidate",
  400,
);
await action(
  "application-status",
  {
    jobId: "job-backend",
    id: employer.applications[0].id,
    status: "Просмотрен",
  },
  "employer",
);
s = await state();
assert.equal(
  s.applications.find((a) => a.jobId === "job-backend").status,
  "Просмотрен",
);
await action("favorite-job", { id: "job-backend", saved: true });
await action("favorite-job", { id: "job-backend", saved: true });
assert.deepEqual((await state()).favoriteJobs, ["job-backend"]);
await action("favorite-job", { id: "job-go", saved: true }, "employer", 400);
await action("favorite-job", { id: "missing", saved: true }, "candidate", 400);
await action("profile-draft", { ...s.profile, name: "Новое имя кандидата" });
assert.equal(
  (await state("employer")).applications[0].candidate.name,
  "Александр Тестовый",
);
// Renaming a company must never grant access to another employer's applications.
const company = (await state("employer")).company;
await action(
  "company",
  { ...company, name: "Вектор Финтех", id: "vector" },
  "employer",
);
const renamed = await state("employer");
assert.equal(renamed.company.id, company.id);
assert.deepEqual(
  renamed.applications.map((a) => a.jobId),
  ["job-backend"],
);
await action("company", company, "employer");
// Restore the synthetic profile display without changing the stored snapshot.
await action("profile-draft", { ...s.profile });
console.log(
  "PASS: consent, message size, role checks, unknown job, duplicate protection, persistent applications/favorites/status, company-scoped contact snapshots.",
);

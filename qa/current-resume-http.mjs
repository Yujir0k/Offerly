// Disposable localhost QA account only; never use a production or main-server session.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL;
assert(base && ["localhost", "127.0.0.1"].includes(new URL(base).hostname));
assert(
  !["5173", "5174"].includes(new URL(base).port),
  "Use the isolated QA server",
);
const { account: a } = JSON.parse(
  await readFile(process.env.TEST_FIXTURE_FILE, "utf8"),
);
assert(a.email.startsWith("session-qa-"));
const headers = {
  Cookie: a.cookie,
  Origin: base,
  "X-Offerly-Role": "candidate",
};
async function call(path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      ...headers,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const d = await r.json();
  assert.equal(r.status, 200, JSON.stringify(d));
  return d;
}
const before = await call("/api/state");
const bytes = await readFile(
  "output/pdf/resume-benchmark/authored-photo-top-right.pdf",
);
const form = new FormData();
form.set(
  "file",
  new File([bytes], "synthetic-resume.pdf", { type: "application/pdf" }),
);
const response = await fetch(base + "/api/resume", {
  method: "POST",
  headers,
  body: form,
});
const imported = await response.json();
assert.equal(response.status, 200, JSON.stringify(imported));
const p = imported.parsed;
assert.match(p.name, /Смирнова/);
assert(p.skills.includes("Python") && p.skills.includes("SQL"));
assert.equal(p.city, "Москва");
assert.equal(p.experience, 3);
assert.equal(p.claimed, "Middle");
assert(!p.grade);
assert(imported.photos.length > 0);
await call("/api/action", {
  ...before.profile,
  ...p,
  type: "profile-draft",
  role: "candidate",
  specialty: "Backend",
  claimed: p.claimed,
  formats: ["Удалённо"],
  employmentTypes: ["Полная занятость"],
  availabilities: [],
  salaryMin: 150000,
  salaryMax: 200000,
});
const after = await call("/api/state");
assert.equal(after.profile.name, p.name);
assert(after.profile.skills.includes("SQL"));
assert.equal(after.profile.grade, before.profile.grade);
assert.equal(after.profile.score, before.profile.score);
assert(after.profile.resumeKey);
const original = await fetch(base + "/api/resume", { headers });
assert.equal(original.status, 200);
assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
const info = await call("/api/resume?info");
assert.equal(info.size, bytes.length);
const again = new FormData();
again.set("reparse", "true");
const rerun = await fetch(base + "/api/resume", {
  method: "POST",
  headers,
  body: again,
});
const reparsed = await rerun.json();
assert.equal(rerun.status, 200);
assert.equal(reparsed.parsed.name, p.name);
assert.deepEqual(reparsed.parsed.skills, p.skills);
const bad = new FormData();
bad.set(
  "file",
  new File(["not a PDF"], "fake.pdf", { type: "application/pdf" }),
);
const rejected = await fetch(base + "/api/resume", {
  method: "POST",
  headers,
  body: bad,
});
assert(rejected.status >= 400);
assert.equal(
  (await call("/api/state")).profile.resumeKey,
  after.profile.resumeKey,
);
const report = {
  passed: true,
  fieldsPersisted: true,
  photoExtracted: true,
  originalBytesPreserved: true,
  reparse: true,
  invalidFileRejected: true,
  gradeUnchanged: true,
};
if (process.env.TEST_RESULT_FILE)
  await writeFile(
    process.env.TEST_RESULT_FILE,
    JSON.stringify(report, null, 2) + "\n",
  );
console.log(report);

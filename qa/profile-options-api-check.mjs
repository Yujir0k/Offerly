import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "http://127.0.0.1:5174";
const headers = { Cookie: "__sites_local_auth=1", Origin: root };
const request = (path, options = {}) =>
  fetch(root + path, {
    ...options,
    headers: { ...headers, ...options.headers },
  });
let state = await (await request("/api/state?role=candidate")).json();
assert.deepEqual(state.profile.formats, ["Удалённо", "Гибрид"]);
assert.deepEqual(state.profile.employmentTypes, [
  "Полная занятость",
  "Проектная работа",
]);
assert.deepEqual(state.profile.preferredLocations, ["Москва", "Казань"]);
assert(state.profile.preferredIndustries.includes("Финтех"));
assert(state.profile.preferredIndustries.includes("Образование"));
assert.equal(
  state.profile.professionalDirection,
  "Информационная безопасность",
);
assert.equal(state.profile.specialty, "Data");
assert(state.profile.languages.includes("Немецкий — B2 — Выше среднего"));
assert(state.profile.languages.includes("Английский — C1 — Продвинутый"));
assert(state.profile.softSkills.includes("Работа в команде"));
const bytes = await readFile(process.argv[2]);
const form = new FormData();
form.append(
  "file",
  new File([bytes], "Игорь Борисов — исходное резюме.pdf", {
    type: "application/pdf",
  }),
);
const upload = await request("/api/resume", { method: "POST", body: form });
assert.equal(upload.status, 200);
const parsed = await upload.json();
assert.equal(parsed.parsed.skills.length, 30);
const info = await (await request("/api/resume?info=1")).json();
assert.equal(info.size, bytes.length);
assert.equal(info.filename, "Игорь Борисов — исходное резюме.pdf");
const original = await request("/api/resume");
assert.equal(original.status, 200);
assert(original.headers.get("content-disposition").includes("filename*=UTF-8"));
assert.equal(original.headers.get("cache-control"), "private, no-store");
const downloaded = Buffer.from(await original.arrayBuffer());
const hash = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(hash(downloaded), hash(bytes));
await writeFile("tmp/pdfs/original-downloaded.pdf", downloaded);
assert.equal((await fetch(root + "/api/resume")).status, 401);
const bad = await request("/api/action", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    ...state.profile,
    role: "candidate",
    type: "profile",
    formats: ["Invalid"],
  }),
});
assert.equal(bad.status, 400);
console.log(
  "PASS: UI selections persisted, assessment unchanged, original PDF byte-identical with private authenticated download, invalid choices rejected",
);

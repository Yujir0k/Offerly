import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
const url = new URL(base);
if (!["localhost", "127.0.0.1"].includes(url.hostname) || url.port === "5173")
  throw Error("Use an isolated QA server, never the main database");
let checks = 0;
const a = {}, b = {}, ordinary = {};
async function call(user, path, body, expected = 200, origin = base) {
  const r = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Origin: origin, "Content-Type": "application/json", ...(user.cookie ? { Cookie: user.cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (r.headers.get("set-cookie")) user.cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.equal(r.status, expected, JSON.stringify(data)); checks++;
  return data;
}
await call({}, "/api/identity/fsp/history", undefined, 401);
await call({}, "/api/identity/fsp/history", { id: "FSP-DEMO-1042" }, 401);
const initial = await call(a, "/api/auth", { type: "demo-login", role: "candidate" });
const second = await call(b, "/api/auth", { type: "demo-login", role: "candidate" });
assert.notEqual(initial.auth.userId, second.auth.userId);
let value = await call(a, "/api/identity/fsp/history", { id: "FSP-DEMO-1042", userId: second.auth.userId, achievements: ["forged"] });
assert.equal(value.achievements.length, 1);
assert(value.achievements[0].endsWith("(демо)"));
assert(!value.achievements.includes("forged"));
assert.equal(value.source, "demo");
assert(Number.isFinite(Date.parse(value.syncedAt)));
await call(a, "/api/identity/fsp/history", { id: "FSP-DEMO-UNKNOWN" }, 404);
assert.equal((await call(a, "/api/identity/fsp/history")).participantId, "FSP-DEMO-1042");
await call(a, "/api/identity/fsp/history", { id: "FSP-DEMO-1043" });
value = await call(a, "/api/state?role=candidate");
assert.equal(value.profile.fsp, "FSP-DEMO-1043");
assert.deepEqual(value.profile.achievements, []);
assert.equal(value.profile.grade, initial.profile.grade);
assert.equal(value.profile.score, initial.profile.score);
assert.deepEqual(value.profile.verified, initial.profile.verified);
assert.equal((await call(b, "/api/identity/fsp/history")).participantId, second.profile.fsp);
await call(a, "/api/identity/fsp/history", { id: "FSP-DEMO-1042" }, 400, "https://outside.example");
await call(a, "/api/identity/fsp/history", null, 400);
await call(a, "/api/identity/fsp/history", { id: 1042 }, 400);
await call(a, "/api/identity/fsp/history", { id: "x".repeat(1000) }, 400);
value = await call(a, "/api/action", { type: "fsp", role: "candidate", id: "FSP-DEMO-1042" });
assert.equal(value.profile.achievements.length, 1);
await call(a, "/api/action", { type: "fsp", role: "employer", id: "FSP-DEMO-1042" }, 400);
await call(a, "/api/identity/fsp/history", { id: "" });
value = await call(a, "/api/state?role=candidate");
assert.equal(value.profile.fsp, null);
assert.deepEqual(value.profile.achievements, []);
assert.equal(value.profile.fspHistory, null);
await call(ordinary, "/api/auth", { type: "register", role: "candidate", name: "Тестовый Пользователь", email: `fsp-history-${Date.now()}@example.test`, password: "Synthetic-Only!2026", consent: true });
await call(ordinary, "/api/identity/fsp/history", { id: "FSP-DEMO-1042" }, 503);
value = await call(ordinary, "/api/identity/fsp/history");
assert.equal(value.source, "unavailable");
assert.equal(value.participantId, null);
assert.deepEqual(value.achievements, []);
console.log(JSON.stringify({ httpChecks: checks, passed: true, scenarios: ["demo-history", "no-history", "unknown-preserves", "clear", "grade-unchanged", "ordinary-denied", "ownership", "Origin", "payload-validation"] }));

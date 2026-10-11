import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname) || new URL(base).port === "5173") throw Error("Use isolated QA, never the main app.");
let checks = 0;
async function call(user, path, value, method = "GET", expected = 200) {
  const response = await fetch(base + path, { method, headers: { Origin: base, "Content-Type": "application/json", Cookie: user.cookie || "" }, body: value === undefined ? undefined : JSON.stringify(value) });
  const body = await response.json();
  assert.equal(response.status, expected, JSON.stringify(body));
  if (response.headers.get("set-cookie")) user.cookie = response.headers.get("set-cookie").split(";")[0];
  checks++;
  return body;
}
const stamp = Date.now();
const a = { email: `hints-candidate-${stamp}@example.test`, role: "candidate" };
const b = { email: `hints-employer-${stamp}@example.test`, role: "employer" };
const keys = ["settings:tour_candidate_v1", "settings:tour_employer_v1", "settings:tour_preferences_v1"];
for (const user of [a, b]) await call(user, "/api/auth", { type: "register", role: user.role, name: "Тест Подсказок", email: user.email, password: "hints-test-pass-1234", consent: true }, "POST");
await call(a, `/api/drafts?key=${keys[0]}`, {value:{overview:true,profile:true}}, "PUT");
await call(a, `/api/drafts?key=${keys[2]}`, {value:{disabled:true}}, "PUT");
await call(b, `/api/drafts?key=${keys[1]}`, {value:{overview:true,company:true}}, "PUT");
for (const user of [a,b]) {
  await call(user, "/api/auth", {type:"logout"}, "POST");
  user.cookie = "";
  await call(user, "/api/auth", { type: "login", role: user.role, email: user.email, password: "hints-test-pass-1234" }, "POST");
}
assert.deepEqual((await call(a, `/api/drafts?key=${keys[0]}`)).value, {overview:true,profile:true});
assert.deepEqual((await call(a, `/api/drafts?key=${keys[2]}`)).value, {disabled:true});
assert.deepEqual((await call(b, `/api/drafts?key=${keys[1]}`)).value, {overview:true,company:true});
assert.equal((await call(b, `/api/drafts?key=${keys[2]}`)).value, null, "Account A must not disable hints for B.");
assert.equal((await call(b, `/api/drafts?key=${keys[0]}`)).value, null, "Viewed sections are scoped to account.");
await call({}, `/api/drafts?key=${keys[2]}`, undefined, "GET", 401);
console.log(`${checks} HTTP checks passed: both roles survive logout/login; viewed and disabled settings persist; separate accounts and anonymous access isolated.`);

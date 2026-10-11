import assert from "node:assert/strict";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
if (
  !["127.0.0.1", "localhost"].includes(new URL(base).hostname) ||
  new URL(base).port === "5173"
)
  throw Error("Isolated QA only");
let cookie = "",
  checks = 0;
async function call(path, body) {
  const r = await fetch(base + path, {
    method: body ? "POST" : "GET",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: cookie,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.headers.get("set-cookie"))
    cookie = r.headers.get("set-cookie").split(";")[0];
  const data = await r.json();
  assert.equal(r.status, 200, JSON.stringify(data));
  checks++;
  return data;
}
const email = `matching-defaults-${Date.now()}@example.test`,
  password = "Matching-Test-1234";
let s = await call("/api/auth", {
  type: "register",
  role: "candidate",
  name: "Тест Подбора",
  email,
  password,
  consent: true,
});
assert.equal(s.profile.consent, true);
assert.equal(s.profile.visible, true);
assert.equal(s.profile.grade, null);
s = await call("/api/action", {
  type: "profile-draft",
  role: "candidate",
  ...s.profile,
  city: "Москва",
  skills: ["Python"],
  salaryMin: 100000,
  salaryMax: 150000,
});
assert.equal(s.profile.consent, true);
assert.equal(s.profile.visible, true);
s = await call("/api/action", {
  type: "privacy",
  role: "candidate",
  visible: false,
  notifications: true,
});
assert.equal(s.profile.visible, false);
s = await call("/api/action", {
  type: "profile-draft",
  role: "candidate",
  ...s.profile,
  consent: false,
});
assert.equal(s.profile.consent, false);
await call("/api/auth", { type: "logout" });
cookie = "";
s = await call("/api/auth", {
  type: "login",
  role: "candidate",
  email,
  password,
});
assert.equal(s.profile.visible, false);
assert.equal(s.profile.consent, false);
s = await call("/api/action", {
  type: "profile-draft",
  role: "candidate",
  ...s.profile,
  consent: true,
});
assert.equal(s.profile.consent, true);
assert.equal(s.profile.visible, false);
s = await call("/api/action", {
  type: "privacy",
  role: "candidate",
  visible: true,
  notifications: true,
});
assert.equal(s.profile.visible, true);
console.log(
  `${checks} HTTP checks passed: new account defaults, draft save, explicit withdrawal and privacy, logout/login persistence and re-enable.`,
);

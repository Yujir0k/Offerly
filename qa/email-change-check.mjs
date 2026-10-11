import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174",
  password = "Qa-password-2026";
let checks = 0;
const run = Date.now();
async function call(u, type, data = {}, status = 200) {
  const r = await fetch(
    base +
      (["register", "login", "logout"].includes(type)
        ? "/api/auth"
        : "/api/action"),
    {
      method: "POST",
      headers: {
        Origin: base,
        "Content-Type": "application/json",
        ...(u.cookie ? { Cookie: u.cookie } : {}),
      },
      body: JSON.stringify({ role: u.role || "candidate", type, ...data }),
    },
  );
  const b = await r.json();
  assert.equal(r.status, status, JSON.stringify(b));
  if (r.headers.get("set-cookie"))
    u.cookie = r.headers.get("set-cookie").split(";")[0];
  checks++;
  return b;
}
async function codeFor(email) {
  const list = await (
    await fetch("http://127.0.0.1:8025/api/v1/messages")
  ).json();
  const msg = list.messages.find((m) => m.To.some((t) => t.Address === email));
  assert(msg);
  const body = await (
    await fetch("http://127.0.0.1:8025/api/v1/message/" + msg.ID)
  ).json();
  return body.Text.match(/\d{6}/)[0];
}
const ui = [];
for (const [role, method] of [
  ["candidate", "old-email"],
  ["employer", "password"],
]) {
  const u = { role, email: `change-${role}-${run}@example.test` },
    email = `changed-${role}-${run}@example.test`;
  await call(u, "register", {
    name: "Тестовый Пользователь",
    email: u.email,
    password,
    consent: true,
    company: "Тестовая компания",
  });
  await call(u, "email-request");
  await call(u, "email-confirm", { code: await codeFor(u.email) });
  const probe = { role };
  await call(probe, "login", { email: u.email, password });
  await call(u, "account-email", { email }, 400);
  await call(
    u,
    "email-change-begin",
    { email, method: "password", password: "wrong" },
    400,
  );
  const flow = (
    await call(u, "email-change-begin", { email, method, password })
  ).emailChange;
  assert.equal(flow.stage, method === "password" ? "new-code" : "old-code");
  assert.equal(flow.delivery.inboxUrl, "http://localhost:8025");
  await call(probe, "email-change-resend", { flowId: flow.id }, 400);
  if (method === "old-email") {
    await call(
      u,
      "email-change-confirm",
      { flowId: flow.id, code: "123456" },
      400,
    );
    await call(
      u,
      "email-change-authorize",
      { flowId: flow.id, code: "000000" },
      400,
    );
    const oldCode = await codeFor(u.email);
    const result = await call(u, "email-change-authorize", {
      flowId: flow.id,
      code: oldCode,
    });
    assert.equal(result.emailChange.stage, "new-code");
    await call(
      u,
      "email-change-confirm",
      { flowId: flow.id, code: oldCode },
      400,
    );
  }
  await call(
    u,
    "email-change-confirm",
    { flowId: flow.id, code: "000000" },
    400,
  );
  await call(u, "email-confirm", { code: await codeFor(email) }, 400);
  const changed = await call(u, "email-change-confirm", {
    flowId: flow.id,
    code: await codeFor(email),
  });
  assert.equal(changed.emailVerification.email, email);
  assert.equal(changed.emailVerification.status, "verified");
  await call(
    u,
    "email-change-confirm",
    { flowId: flow.id, code: await codeFor(email) },
    400,
  );
  const revoked = await fetch(base + "/api/state?role=" + role, {
    headers: { Cookie: probe.cookie },
  });
  assert.equal(revoked.status, 401);
  checks++;
  await call({}, "login", { role, email: u.email, password }, 400);
  const login = await call({}, "login", { role, email, password });
  assert.equal(login.emailVerification.status, "verified");
  ui.push({ role, email, password });
}
await writeFile("/tmp/offerly-email-change-ui.json", JSON.stringify(ui), {
  mode: 0o600,
});
console.log(
  JSON.stringify({
    checks,
    oldEmailAndPasswordPaths: true,
    purposeSeparation: true,
    sessionBinding: true,
    otherSessionsRevoked: true,
    newEmailLoginVerified: true,
  }),
);

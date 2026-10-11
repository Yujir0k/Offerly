import assert from "node:assert/strict";
import { readdir, readFile, writeFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://127.0.0.1:5174";
let count = 0;
const run = Date.now(),
  password = "Qa-password-2026";
async function call(user, type, data = {}, expected = 200, path = "/api/auth") {
  const r = await fetch(base + path, {
    method: "POST",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      ...(user.cookie ? { Cookie: user.cookie } : {}),
    },
    body: JSON.stringify({ type, ...data }),
  });
  const b = await r.json();
  assert.equal(r.status, expected, JSON.stringify(b));
  if (r.headers.get("set-cookie"))
    user.cookie = r.headers.get("set-cookie").split(";")[0];
  count++;
  return b;
}
const candidate = {},
  employer = {};
for (const [u, role] of [
  [candidate, "candidate"],
  [employer, "employer"],
]) {
  u.email = `password-${role}-${run}@example.test`;
  const registered = await call(u, "register", {
    role,
    name: "Тестовый Пользователь",
    email: u.email,
    password,
    consent: true,
    company: role === "employer" ? "Тестовая компания" : "",
  });
  u.id = registered.auth.userId;
  const duplicate = await call(
    {},
    "register",
    {
      role,
      name: "Тестовый Пользователь",
      email: u.email,
      password,
      consent: true,
    },
    400,
  );
  assert(duplicate.error.includes("уже зарегистрирован"));
  await call({}, "login", { email: u.email, password: "incorrect" }, 400);
  await call(u, "logout");
  const pending = await call(u, "login", { role, email: u.email, password });
  assert.equal(pending.auth.userId, u.id);
  assert.equal(pending.emailVerification.status, "unverified");
  await call(u, "email-request", {}, 200, "/api/action");
  const dir = process.env.TEST_MAIL_DIR || ".data/mail-outbox",
    mails = await Promise.all(
      (await readdir(dir)).map(async (f) =>
        JSON.parse(await readFile(dir + "/" + f, "utf8")),
      ),
    );
  const mail = mails.find((m) => m.to === u.email);
  assert(mail);
  await call(
    u,
    "email-confirm",
    { code: mail.text.match(/\d{6}/)[0] },
    200,
    "/api/action",
  );
  await call(u, "logout");
  const login = await call(u, "login", { role, email: u.email, password });
  assert.equal(login.auth.userId, u.id);
  assert.equal(login.emailVerification.status, "verified");
  assert(!login.auth.demo);
}
await writeFile(
  "/tmp/offerly-password-qa.json",
  JSON.stringify({ email: candidate.email, password }),
  { mode: 0o600 },
);
console.log(
  JSON.stringify({
    httpChecks: count,
    bothRolesPasswordLogin: true,
    wrongPasswordRejected: true,
    duplicateRegistrationExplained: true,
    emailConfirmationThenLogin: true,
  }),
);

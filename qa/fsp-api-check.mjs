import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
const base = process.env.TEST_BASE_URL || "http://localhost:5174",
  mock = "http://127.0.0.1:5290";
let checks = 0;
const run = Date.now();
const user = () => ({ jar: new Map() });
async function request(u, path, { method = "GET", body, expected = 200 } = {}) {
  const r = await fetch(path.startsWith("http") ? path : base + path, {
    method,
    redirect: "manual",
    headers: {
      Origin: base,
      "Content-Type": "application/json",
      Cookie: [...u.jar].map(([k, v]) => k + "=" + v).join("; "),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const cookie of r.headers.getSetCookie()) {
    const [kv] = cookie.split(";"),
      index = kv.indexOf("=");
    u.jar.set(kv.slice(0, index), kv.slice(index + 1));
  }
  assert.equal(
    r.status,
    expected,
    await (r.status !== expected ? r.text() : Promise.resolve("")),
  );
  checks++;
  return r;
}
async function begin(
  u,
  scenario,
  {
    intent = "register",
    role = "candidate",
    consent = true,
    link = false,
    alterChallenge = false,
  } = {},
) {
  await fetch(mock + "/test-scenario", {
    method: "POST",
    body: JSON.stringify(scenario),
  });
  const start = await (
    await request(u, "/api/identity/fsp/" + (link ? "link" : "start"), {
      method: "POST",
      body: { intent, role, consent },
    })
  ).json();
  const auth = new URL(start.authorizationUrl);
  assert.equal(auth.searchParams.get("code_challenge_method"), "S256");
  assert(auth.searchParams.get("state"));
  assert(auth.searchParams.get("nonce"));
  if (alterChallenge) auth.searchParams.set("code_challenge", "wrong");
  const response = await fetch(auth, { redirect: "manual" });
  assert.equal(response.status, 302);
  return response.headers.get("location");
}
async function callback(u, url) {
  const r = await request(u, url, { expected: 303 });
  return r.headers.get("location");
}
const person = {
  sub: `new-${run}`,
  name: "Тестовый Участник ФСП",
  email: `fsp-new-${run}@example.test`,
  email_verified: true,
  fsp_id: "FSP-TEST-123",
};
const created = user(),
  url = await begin(created, person);
assert((await callback(created, url)).endsWith("/onboarding/candidate"));
const state = await (
  await request(created, "/api/state?role=candidate")
).json();
assert.equal(state.profile.fsp, "FSP-TEST-123");
assert.equal(state.profile.grade, null);
assert.deepEqual(state.profile.achievements, []);
assert((await callback(created, url)).includes("fsp=expired"));
const again = user();
assert(
  (
    await callback(
      again,
      await begin(again, person, { intent: "login", consent: false }),
    )
  ).endsWith("/demo/candidate/overview"),
);
const repeatState = await (
  await request(again, "/api/state?role=candidate")
).json();
assert.equal(repeatState.auth.userId, state.auth.userId);
const needConsent = user();
assert(
  (
    await callback(
      needConsent,
      await begin(
        needConsent,
        { ...person, sub: `unknown-${run}` },
        { intent: "login", consent: false },
      ),
    )
  ).includes("/register?role=candidate&fsp=consent"),
);
await request(user(), "/api/identity/fsp/start", {
  method: "POST",
  body: { intent: "register", consent: false },
  expected: 400,
});
for (const mutation of ["badNonce", "badAudience", "badSignature", "expired"]) {
  const u = user();
  assert(
    (
      await callback(
        u,
        await begin(u, { ...person, sub: mutation + run, [mutation]: true }),
      )
    ).includes("fsp=failed"),
    mutation,
  );
  await request(u, "/api/state?role=candidate", { expected: 401 });
}
const pkce = user();
assert(
  (
    await callback(
      pkce,
      await begin(
        pkce,
        { ...person, sub: "pkce" + run },
        { alterChallenge: true },
      ),
    )
  ).includes("fsp=failed"),
);
const cancelled = user(),
  cancelUrl = new URL(
    await begin(cancelled, { ...person, sub: "cancel" + run }),
  );
cancelUrl.searchParams.delete("code");
cancelUrl.searchParams.set("error", "access_denied");
assert((await callback(cancelled, cancelUrl.href)).includes("fsp=cancelled"));
const csrf = user(),
  legit = await begin(csrf, {
    ...person,
    sub: "csrf" + run,
    email: `csrf-${run}@example.test`,
  });
const tampered = new URL(legit);
tampered.searchParams.set("state", "wrong");
assert((await callback(csrf, tampered.href)).includes("fsp=expired"));
assert((await callback(csrf, legit)).endsWith("/onboarding/candidate"));
const stolenCookie = user();
assert(
  (
    await callback(
      stolenCookie,
      await begin(user(), { ...person, sub: "stolen" + run }),
    )
  ).includes("fsp=expired"),
);
const emailUnverified = user();
assert(
  (
    await callback(
      emailUnverified,
      await begin(emailUnverified, {
        ...person,
        sub: "unverified" + run,
        email: `unverified-${run}@example.test`,
        email_verified: false,
      }),
    )
  ).includes("/verify-email?role=candidate"),
);
const company = user();
assert(
  (
    await callback(
      company,
      await begin(
        company,
        {
          ...person,
          sub: "employer" + run,
          email: `employer-${run}@example.test`,
        },
        { role: "employer" },
      ),
    )
  ).endsWith("/onboarding/employer"),
);
const own = user(),
  email = `native-fsp-${run}@example.test`;
const registered = await (
  await request(own, "/api/auth", {
    method: "POST",
    body: {
      type: "register",
      name: "Тестовый Пользователь",
      email,
      password: "test-password-1234",
      consent: true,
    },
  })
).json();
await request(own, "/api/action", {
  method: "POST",
  body: { type: "email-request" },
});
const mails = await Promise.all(
  (await readdir(process.env.TEST_MAIL_DIR || ".data/mail-outbox")).map(
    async (f) =>
      JSON.parse(
        await readFile(
          (process.env.TEST_MAIL_DIR || ".data/mail-outbox") + "/" + f,
          "utf8",
        ),
      ),
  ),
);
const mail = mails.find((m) => m.to === email);
await request(own, "/api/action", {
  method: "POST",
  body: { type: "email-confirm", code: mail.text.match(/\d{6}/)[0] },
});
const matching = { ...person, sub: "native-sub" + run, email };
const duplicate = user();
assert(
  (await callback(duplicate, await begin(duplicate, matching))).includes(
    "fsp=existing",
  ),
);
await request(user(), "/api/identity/fsp/link", {
  method: "POST",
  body: {},
  expected: 401,
});
const link = await begin(own, matching, { link: true });
assert((await callback(own, link)).includes("/settings?fsp=linked"));
const linked = await (await request(own, "/api/identity/fsp")).json();
assert(linked.linked);
const after = user();
assert(
  (
    await callback(
      after,
      await begin(after, matching, { intent: "login", consent: false }),
    )
  ).endsWith("/demo/candidate/overview"),
);
assert.equal(
  (await (await request(after, "/api/state?role=candidate")).json()).auth
    .userId,
  registered.auth.userId,
);
// Linking must use the initiating native session, even for the same user ID.
const session = user();
await request(session, "/api/auth", {
  method: "POST",
  body: { type: "login", email, password: "test-password-1234" },
});
const interrupted = await begin(
  session,
  { ...matching, sub: "other-sub" + run },
  { link: true },
);
session.jar.delete("offerly_session");
assert((await callback(session, interrupted)).includes("fsp=session"));
const conflictUrl = await begin(own, person, { link: true });
assert((await callback(own, conflictUrl)).includes("fsp=linked_elsewhere"));
const secondUrl = await begin(
  own,
  { ...matching, sub: "second-identity" + run },
  { link: true },
);
assert((await callback(own, secondUrl)).includes("fsp=already_linked"));
const noHistory = user();
assert(
  (
    await callback(
      noHistory,
      await begin(noHistory, {
        sub: "no-history" + run,
        email: `no-history-${run}@example.test`,
        email_verified: true,
        given_name: "Елена",
        family_name: "Соколова",
      }),
    )
  ).endsWith("/onboarding/candidate"),
);
const noHistoryState = await (
  await request(noHistory, "/api/state?role=candidate")
).json();
assert.equal(noHistoryState.profile.fsp, null);
assert.deepEqual(noHistoryState.profile.achievements, []);
assert.equal(noHistoryState.profile.firstName, "Елена");
assert.equal(noHistoryState.profile.lastName, "Соколова");
console.log(
  JSON.stringify({
    checks,
    firstLoginAndRegistration: true,
    repeatedIdentityNoDuplicates: true,
    emailCollisionDoesNotMerge: true,
    linkToOwnVerifiedAccount: true,
    pkceStateNonceSignatureAudienceExpiry: true,
    oneTimeBrowserBoundCallback: true,
    unverifiedEmailRequiresConfirmation: true,
    noFabricatedAchievements: true,
  }),
);

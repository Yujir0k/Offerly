import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5174';
const provider = process.env.TEST_FSP_DEMO_URL || 'http://127.0.0.1:5292';
for (const url of [base, provider])
  assert(['localhost', '127.0.0.1'].includes(new URL(url).hostname));
let checks = 0;
const user = () => ({ jar: new Map() });
async function request(account, url, body, expected = 200, extra = {}) {
  const response = await fetch(url.startsWith('http') ? url : base + url, {
    redirect: 'manual',
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      Cookie: [...account.jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  for (const cookie of response.headers.getSetCookie()) {
    const [pair] = cookie.split(';'),
      pos = pair.indexOf('=');
    if (pair.slice(pos + 1))
      account.jar.set(pair.slice(0, pos), pair.slice(pos + 1));
    else account.jar.delete(pair.slice(0, pos));
  }
  assert.equal(response.status, expected, 'Unexpected HTTP response');
  checks++;
  return response;
}
async function call(account, path, body, expected = 200) {
  return (await request(account, path, body, expected)).json();
}
async function start(account, intent = 'link', role = 'candidate') {
  const result = await call(account, '/api/identity/fsp-demo/start', {
    intent,
    role,
  });
  const issuer = new URL(result.authorizationUrl);
  assert.equal(issuer.origin, provider);
  assert.equal(issuer.searchParams.get('code_challenge_method'), 'S256');
  const remote = user(),
    response = await request(remote, result.authorizationUrl);
  const html = await response.text();
  assert(html.includes('Демонстрационный сервис'));
  assert(!html.includes('type="password"'));
  const token = html.match(/name="request" value="([a-f0-9]+)"/)?.[1];
  assert(token);
  return { remote, token, authUrl: issuer.origin + issuer.pathname };
}
async function grant(
  flow,
  subject = 'demo-winner',
  decision = 'allow',
  asJson = false,
) {
  const response = await fetch(flow.authUrl, {
    method: 'POST',
    redirect: 'manual',
    headers: {
      Origin: provider,
      ...(asJson ? { Accept: 'application/json' } : {}),
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: [...flow.remote.jar].map(([k, v]) => `${k}=${v}`).join('; '),
    },
    body: new URLSearchParams({ request: flow.token, subject, decision }),
  });
  assert.equal(response.status, asJson ? 200 : 303);
  checks++;
  return asJson
    ? (await response.json()).redirectUrl
    : response.headers.get('location');
}
async function connect(account, subject, intent = 'link') {
  const flow = await start(account, intent),
    callback = await grant(flow, subject, 'allow', true);
  const result = await request(account, callback, undefined, 303);
  assert(
    new URL(result.headers.get('location')).searchParams.get('fspDemo') ===
      'linked',
  );
  return { callback, status: await call(account, '/api/identity/fsp-demo') };
}
const state = (account) => call(account, '/api/state?role=candidate');
const catalog = (account, filters = {}) =>
  call(
    account,
    `/api/catalog/candidates?role=employer&filters=${encodeURIComponent(JSON.stringify(filters))}`,
  );
const a = user(),
  b = user(),
  ordinary = user(),
  anonymous = user();
await call(ordinary, '/api/auth', {
  type: 'register',
  role: 'candidate',
  name: 'Проверка изоляции ФСП',
  email: `fsp-demo-${Date.now()}@example.test`,
  password: 'local-fsp-demo-password-1234',
  consent: true,
});
const ordinaryTotal = (await catalog(ordinary)).total;
const initialStatus = await call(a, '/api/identity/fsp-demo');
assert(
  initialStatus.enabled && initialStatus.available && !initialStatus.linked,
);
await call(anonymous, '/api/identity/fsp-demo/start', { intent: 'link' }, 401);
await call(anonymous, '/api/identity/fsp-demo/sync', {}, 401);
const login = await connect(a, 'demo-winner', 'login');
assert.equal(login.status.events.length, 2);
const before = (await state(a)).profile;
await call(a, '/api/action', { type: 'fsp', role: 'candidate', id: 'FSP-DEMO-1042' }, 400);
assert.equal((await state(a)).profile.fsp, 'FSP-DEMO-WINNER');
const winnerCard = (
  await catalog(a, {
    ids: [login.status.catalogCandidateId],
    spec: 'Backend',
    sort: 'По достижениям ФСП',
  })
).items[0];
assert.equal(winnerCard.competitionResults.length, 2);
assert(winnerCard.ranking.sport > 0);
assert(
  winnerCard.ranking.events.every(
    (e) => e.source === 'demo' && e.relevance === 1,
  ),
);
assert(Number.isFinite(Date.parse(winnerCard.fspConnection.syncedAt)));
const repeat = await request(a, login.callback, undefined, 303);
assert.equal(
  new URL(repeat.headers.get('location')).searchParams.get('fspDemo'),
  'failed',
);
assert.equal((await call(a, '/api/identity/fsp-demo')).events.length, 2);
await connect(a, 'demo-winner');
assert.equal((await call(a, '/api/identity/fsp-demo')).events.length, 2);
const cancelled = await request(
  a,
  await grant(await start(a), 'demo-participant', 'cancel'),
  undefined,
  303,
);
assert.equal(
  new URL(cancelled.headers.get('location')).searchParams.get('fspDemo'),
  'cancelled',
);
assert.equal(
  (await call(a, '/api/identity/fsp-demo')).participantId,
  'FSP-DEMO-WINNER',
);
const protectedFlow = await start(a),
  protectedCallback = await grant(protectedFlow, 'demo-participant');
await request(b, protectedCallback, undefined, 303);
assert(!(await call(b, '/api/identity/fsp-demo')).linked);
const legitimate = await request(a, protectedCallback, undefined, 303);
assert.equal(
  new URL(legitimate.headers.get('location')).searchParams.get('fspDemo'),
  'linked',
);
const participant = await call(a, '/api/identity/fsp-demo');
assert.equal(participant.events.length, 1);
const participantCard = (
  await catalog(a, {
    ids: [participant.catalogCandidateId],
    spec: 'Backend',
    sort: 'По достижениям ФСП',
  })
).items[0];
assert(participantCard.ranking.sport < winnerCard.ranking.sport);
const empty = (await connect(a, 'demo-no-history')).status;
assert.equal(empty.connection.status, 'empty');
assert.equal(empty.events.length, 0);
const emptyCard = (
  await catalog(a, {
    ids: [empty.catalogCandidateId],
    sort: 'По достижениям ФСП',
  })
).items[0];
assert.equal(emptyCard.ranking.sport, 0);
assert.equal(emptyCard.achievements.length, 0);
const after = (await state(a)).profile;
for (const key of [
  'grade',
  'score',
  'verified',
  'skills',
  'name',
  'experience',
  'salaryMin',
  'salaryMax',
])
  assert.deepEqual(after[key], before[key], `${key} was changed by FSP`);
await connect(a, 'demo-winner');
const authorization =
  'Basic ' + Buffer.from('offerly-demo:local-demo-only').toString('base64');
async function outage(value) {
  const r = await fetch(provider + '/test/registry-mode', {
    method: 'POST',
    headers: {
      Authorization: authorization,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ unavailable: String(value) }),
  });
  assert.equal(r.status, 200);
  checks++;
}
try {
  await outage(true);
  const stale = await call(a, '/api/identity/fsp-demo/sync', {});
  assert.equal(stale.connection.status, 'unavailable');
  assert.equal(stale.events.length, 2);
} finally {
  await outage(false);
}
const refreshed = await call(a, '/api/identity/fsp-demo/sync', {});
assert.equal(refreshed.connection.status, 'synced');
assert.equal(refreshed.events.length, 2);
await call(b, '/api/auth', { type: 'demo-login', role: 'candidate' });
const bStatus = (await connect(b, 'demo-winner')).status;
assert.notEqual(bStatus.catalogCandidateId, refreshed.catalogCandidateId);
assert.equal(
  (await catalog(b, { ids: [refreshed.catalogCandidateId] })).total,
  0,
);
await call(ordinary, '/api/identity/fsp-demo/start', { intent: 'link' }, 403);
await call(ordinary, '/api/identity/fsp-demo/start', { intent: 'login' }, 403);
await call(ordinary, '/api/identity/fsp-demo/sync', {}, 403);
assert.equal((await state(ordinary)).profile.fsp, null);
assert(!(await call(ordinary, '/api/identity/fsp-demo')).linked);
const ordinaryCatalog = await catalog(ordinary);
assert.equal(ordinaryCatalog.total, ordinaryTotal);
assert(
  ordinaryCatalog.items.every(
    (profile) => profile.fspConnection?.provider !== 'demo',
  ),
);
const failedOrigin = await request(
  a,
  '/api/identity/fsp-demo/start',
  { intent: 'link' },
  400,
  { Origin: 'http://invalid.test' },
);
assert((await failedOrigin.json()).error);
const invalidAuth =
  provider +
  '/realms/fsp-demo/protocol/openid-connect/auth?client_id=another&redirect_uri=https://example.test';
await request(user(), invalidAuth, undefined, 400);
await request(
  user(),
  provider + '/registry/results?subject=demo-winner',
  undefined,
  401,
);
const forged = await start(a),
  forgedCallback = new URL(await grant(forged, 'demo-no-history'));
forgedCallback.searchParams.set('code', 'forged-code');
const rejected = await request(a, forgedCallback.href, undefined, 303);
assert.equal(
  new URL(rejected.headers.get('location')).searchParams.get('fspDemo'),
  'failed',
);
assert.equal(
  (await call(a, '/api/identity/fsp-demo')).participantId,
  'FSP-DEMO-WINNER',
);
const publicStatus = JSON.stringify(await call(a, '/api/identity/fsp-demo'));
for (const key of [
  'clientSecret',
  'verifier',
  'nonce',
  'access_token',
  'id_token',
  'session_hash',
])
  assert(!publicStatus.includes(key));
// Explicit unlink preserves professional results and removes only owned demo data.
await call(ordinary, '/api/identity/fsp-demo/unlink', {}, 403);
const linkedBeforeUnlink = await call(a, '/api/identity/fsp-demo');
const profileBeforeUnlink = (await state(a)).profile;
const unlinked = await call(a, '/api/identity/fsp-demo/unlink', {});
assert.equal(unlinked.linked, false);
const profileAfterUnlink = (await state(a)).profile;
assert.equal(profileAfterUnlink.grade, profileBeforeUnlink.grade);
assert.deepEqual(profileAfterUnlink.verified, profileBeforeUnlink.verified);
assert.equal(profileAfterUnlink.fsp, null);
assert.deepEqual(profileAfterUnlink.competitionResults, []);
const mirrorAfterUnlink = (await catalog(a, { ids: [linkedBeforeUnlink.catalogCandidateId] })).items[0];
assert.equal(mirrorAfterUnlink.fsp, null);
assert.deepEqual(mirrorAfterUnlink.competitionResults, []);
assert((await call(b, '/api/identity/fsp-demo')).linked);
const report = {
  checks,
  oidcFlow: true,
  threeAccounts: true,
  gradesPreserved: true,
  unlinkPreservesGradeAndOtherUsers: true,
  replayDenied: true,
  browserBinding: true,
  cancelPreserved: true,
  outagePreserved: true,
  scopeIsolation: true,
  ordinaryMarketUntouched: true,
};
await writeFile('qa/results/latest/fsp-demo-results.json', JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report) + '\n');

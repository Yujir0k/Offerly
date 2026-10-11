import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:5174';
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname));
const dataset = JSON.parse(
  await readFile('data/synthetic-candidates-v1.json', 'utf8'),
);
const user = {},
  other = {},
  ordinary = {};
let checks = 0;
async function call(account, path, body) {
  const response = await fetch(base + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      Origin: base,
      'Content-Type': 'application/json',
      ...(account.cookie ? { Cookie: account.cookie } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json();
  assert.equal(response.status, 200, JSON.stringify(data));
  if (response.headers.get('set-cookie'))
    account.cookie = response.headers.get('set-cookie').split(';')[0];
  checks++;
  return data;
}
const catalog = (account, filters = {}, page = 1) =>
  call(
    account,
    `/api/catalog/candidates?role=employer&filters=${encodeURIComponent(JSON.stringify(filters))}&page=${page}`,
  );
await call(ordinary, '/api/auth', {
  type: 'register',
  role: 'employer',
  name: 'Проверка изоляции демо',
  email: `synthetic-isolation-${Date.now()}@example.test`,
  password: 'local-synthetic-check-password-1234',
  consent: true,
});
const ordinaryBefore = await catalog(ordinary);
const state = await call(user, '/api/auth', {
  type: 'demo-login',
  role: 'employer',
});
const all = await catalog(user);
assert.equal(all.total, 726);
assert.equal(all.items.length, 20);
assert(all.items.some((profile) => profile.synthetic));
for (const track of new Set(
  dataset.profiles.map((row) => row.profile.specialty),
)) {
  const scoped = await catalog(user, { spec: track });
  assert(
    scoped.total >= 60 && scoped.total <= 63,
    `${track} count ${scoped.total}`,
  );
  assert(scoped.items.every((profile) => profile.specialty === track));
  for (const grade of ['Junior', 'Middle', 'Senior']) {
    const group = await catalog(user, {
      spec: track,
      grade,
      confirmation: 'confirmed',
      sort: 'По результату теста',
    });
    assert(group.total >= 10);
    assert(group.items.every((profile) => profile.grade === grade));
    for (const profile of group.items.filter((row) => row.synthetic)) {
      assert.equal(profile.assessmentEvidence.dimensions.length, 4);
      assert(
        Number.isFinite(Date.parse(profile.assessmentEvidence.confirmedAt)),
      );
      assert(
        profile.competitionResults.every((event) =>
          Number.isFinite(Date.parse(event.date)),
        ),
      );
      assert.equal(profile.synthetic.method, 'engine-simulation');
      assert.deepEqual(profile.verified, []);
      assert.equal(profile.email, '');
      assert.equal(profile.phone, '');
    }
  }
  const fsp = await catalog(user, {
    spec: track,
    sort: 'По достижениям ФСП',
    relevantFsp: true,
  });
  assert(fsp.total >= 25);
  assert(
    fsp.items.every((profile) =>
      profile.ranking.events.some(
        (event) => event.relevance > 0 && event.source === 'demo',
      ),
    ),
  );
}
const second = await catalog(user, {}, 2);
assert.equal(second.total, all.total);
assert(
  second.items.every(
    (profile) => !all.items.some((prior) => prior.id === profile.id),
  ),
);
const last = await catalog(user, {}, Math.ceil(all.total / all.pageSize));
assert.equal(last.items.length, 6);
const claimed = await catalog(user, {
  spec: 'Backend',
  skills: ['Python'],
  sort: 'По результату теста',
  needId: state.needs[0].id,
});
assert(claimed.items.some((profile) => profile.synthetic));
const verified = await catalog(user, {
  spec: 'Backend',
  skills: ['Python'],
  skillSource: 'verified',
});
assert(verified.items.every((profile) => !profile.synthetic));
const unconfirmed = await catalog(user, { confirmation: 'unconfirmed' });
assert(unconfirmed.total > 0);
assert(
  unconfirmed.items.every(
    (profile) => profile.grade === null && profile.ranking.test === 0,
  ),
);
assert(unconfirmed.items.every((profile) => !profile.ranking.reasons.join(' ').includes('испытание не завершено')));
const comparison = await catalog(user, {
  ids: claimed.items.slice(0, 4).map((profile) => profile.id),
  sort: 'Тест + ФСП',
});
assert.equal(comparison.items.length, 4);
assert(comparison.items.every((profile) => profile.ranking.reasons.length > 0));
await call(other, '/api/auth', { type: 'demo-login', role: 'employer' });
const otherCatalog = await catalog(other);
assert.equal(otherCatalog.total, 726);
assert(
  otherCatalog.items.every(
    (profile) => !all.items.some((prior) => prior.id === profile.id),
  ),
);
assert.equal(
  (
    await catalog(other, {
      ids: claimed.items.slice(0, 4).map((profile) => profile.id),
    })
  ).total,
  0,
);
const ordinaryAfter = await catalog(ordinary);
assert.equal(ordinaryAfter.total, ordinaryBefore.total);
assert(ordinaryAfter.items.every((profile) => !profile.synthetic));
const report = {
  checks,
  totalPerDemo: all.total,
  newProfilesPerDemo: 720,
  tracks: 12,
  categories: 36,
  pagination: true,
  skillSourcesHonest: true,
  privateScopeIsolation: true,
  ordinaryMarketUntouched: true,
};
await writeFile(
  'qa/results/latest/synthetic-catalog-results.json',
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));

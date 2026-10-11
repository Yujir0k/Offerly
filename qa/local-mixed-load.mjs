import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';

// An isolated Docker demo only. Never reuse production accounts or credentials.
const base = process.env.MIXED_BASE || 'http://localhost:3000';
const url = new URL(base);
assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'Local demo required');
const duration = Number(process.env.MIXED_SECONDS || 180);
assert(duration >= 10 && duration <= 600);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const users = [];
for (let i = 0; i < 8; i++) {
  const role = i % 2 ? 'employer' : 'candidate';
  const r = await fetch(base + '/api/auth', {
    method: 'POST', headers: { Origin: base, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'demo-login', role }),
  });
  assert(r.ok, 'Own isolated demo account creation');
  const cookie = r.headers.getSetCookie().map(v => v.split(';')[0]).join('; ');
  assert(cookie);
  users.push({ role, cookie, index: i });
}
const samples = {}, failures = [];
let requests = 0;
const started = performance.now(), until = started + duration * 1000;
async function call(u, label, path, method = 'GET', body) {
  const at = performance.now();
  const r = await fetch(base + path, {
    method, headers: { Origin: base, Cookie: u.cookie, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const data = await r.json();
  requests++;
  (samples[label] ||= []).push(performance.now() - at);
  assert(r.ok, label + ': HTTP ' + r.status);
  return data;
}
await Promise.all(users.map(async u => {
  let sequence = 0;
  while (performance.now() < until && failures.length === 0) {
    try {
      const action = sequence++ % 5;
      if (action === 0) await call(u, 'state', '/api/state?role=' + u.role);
      if (action === 1 || action === 2) {
        const filters = action === 1 ? {} : { query: 'Python' };
        await call(u, action === 1 ? 'catalogue' : 'search', '/api/catalog/' +
          (u.role === 'candidate' ? 'jobs' : 'candidates') + '?role=' + u.role +
          '&page=1&filters=' + encodeURIComponent(JSON.stringify(filters)));
      }
      if (action === 3) await call(u, 'chat-list', '/api/conversations?role=' + u.role);
      if (action === 4) {
        const value = { synthetic: true, account: u.index, sequence };
        await call(u, 'draft-write', '/api/drafts?key=settings:qa_load', 'PUT', { value });
        const saved = await call(u, 'draft-read', '/api/drafts?key=settings:qa_load');
        assert.deepEqual(saved.value, value, 'Draft isolation and read-after-write');
      }
    } catch (e) { failures.push({ actor: u.index, error: e.message }); }
    await sleep(700);
  }
}));
const report = {
  at: new Date().toISOString(), passed: failures.length === 0, accounts: users.length,
  durationSeconds: Math.round((performance.now() - started) / 1000), thinkTimeMs: 700,
  requests, failures,
  routes: Object.fromEntries(Object.entries(samples).map(([name, values]) => {
    values.sort((a,b) => a-b);
    return [name, { requests: values.length, p50ms: Math.round(values[Math.floor(values.length * .5)]),
      p95ms: Math.round(values[Math.min(values.length - 1, Math.floor(values.length * .95))]),
      maxMs: Math.round(values.at(-1)) }];
  })),
  scope: 'Local production Docker, 8 separate synthetic demo accounts, catalogue/search/state/chat-list and draft writes. No external mail. No PDF/assessment stress, VPS capacity or maximum-user claim.',
};
const output = process.env.MIXED_OUTPUT || '/tmp/offerly-local-mixed-load.json';
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: report.passed, requests, durationSeconds: report.durationSeconds, failures: failures.length }));
process.exitCode = report.passed ? 0 : 1;

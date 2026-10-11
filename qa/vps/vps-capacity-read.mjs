import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Explicitly authorized, paced, read-only production check; no registration or actions.
const base = 'https://opherly.ru';
assert.equal(process.env.CAPACITY_ALLOW_PRODUCTION, 'opherly.ru');
const dir = process.env.CAPACITY_PRIVATE_DIR;
assert(dir && path.isAbsolute(dir));
const users = JSON.parse(await readFile(path.join(dir, 'targets.json'), 'utf8'));
assert(users.some(u => u.role === 'employer') && users.some(u => u.role === 'candidate'));
const employer = users.find(u => u.role === 'employer');
const candidate = users.find(u => u.role === 'candidate');
const routes = [
  ...[{}, { sort: 'По результату теста' }, { query: 'Python' }].map(filters => ({
    path: '/api/catalog/candidates?role=employer&page=1&filters=' + encodeURIComponent(JSON.stringify(filters)), user: employer,
  })),
  { path: '/api/catalog/jobs?role=candidate&page=1&filters=%7B%7D', user: candidate },
  { path: '/api/state?role=employer', user: employer },
  { path: '/api/state?role=candidate', user: candidate },
  { path: '/', user: null },
];
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const quantile = (a, q) => a[Math.max(0, Math.ceil(a.length * q) - 1)] ?? null;
const allowedLevels = [5, 15, 30, 50, 100, 150, 200];
const levels = process.env.CAPACITY_LEVELS ? process.env.CAPACITY_LEVELS.split(',').map(Number) : allowedLevels;
assert(levels.length > 0 && levels.length <= allowedLevels.length && levels.every(n => allowedLevels.includes(n)));
const stages = [];
let abortAll = false;
for (const clients of levels) {
  const started = performance.now(), until = started + 20_000, samples = [], statuses = {}, byRoute = {};
  let errors = 0, bytes = 0, inflight = 0, peakInflight = 0;
  console.log('CAPACITY_STAGE_START clients=' + clients);
  await Promise.all(Array.from({ length: clients }, async (_, client) => {
    await sleep(client * 20);
    let n = client;
    while (performance.now() < until && !abortAll) {
      const route = routes[n++ % routes.length], t = performance.now();
      let status;
      inflight++; peakInflight = Math.max(peakInflight, inflight);
      try {
        const r = await fetch(base + route.path, {
          headers: { Origin: base, 'User-Agent': 'Offerly-Authorized-Capacity-QA', ...(route.user ? { Cookie: route.user.cookie } : {}) },
          signal: AbortSignal.timeout(5000),
        });
        bytes += (await r.arrayBuffer()).byteLength;
        status = r.status;
        if (r.status !== 200) errors++;
      } catch { status = 'network-or-timeout'; errors++; }
      finally { inflight--; }
      const ms = performance.now() - t;
      samples.push(ms); statuses[status] = (statuses[status] || 0) + 1;
      const label = route.path.split('?')[0] + (route.user ? ':' + route.user.role : '');
      (byRoute[label] ||= []).push(ms);
      if (errors >= 3) abortAll = true;
      await sleep(1000);
    }
  }));
  samples.sort((a, b) => a - b);
  const elapsed = (performance.now() - started) / 1000;
  const result = {
    virtualUsers: clients, thinkTimeMs: 1000, targetDurationSeconds: 20,
    requests: samples.length, peakInflight, elapsedSeconds: +elapsed.toFixed(2), requestsPerSecond: +(samples.length / elapsed).toFixed(2),
    medianMs: Math.round(quantile(samples, .5)), p95Ms: Math.round(quantile(samples, .95)), maxMs: Math.round(samples.at(-1)),
    interrupted: elapsed > 60,
    errors, statuses, receivedMiB: +(bytes / 1024 / 1024).toFixed(2),
    byRoute: Object.fromEntries(Object.entries(byRoute).map(([key, a]) => { a.sort((x, y) => x - y); return [key, { requests: a.length, p95Ms: Math.round(quantile(a, .95)) }]; })),
  };
  stages.push(result); console.log(JSON.stringify(result));
  if (abortAll || result.interrupted || result.p95Ms > 2500) break;
  await sleep(3000);
}
const summary = {
  at: new Date().toISOString(), base, stages, stoppedEarly: stages.length < levels.length,
  scope: 'Paced read-only HTTPS catalogue, candidate/employer state and landing requests using two own QA sessions. Not a write, PDF, email or assessment stress test; not a maximum-capacity or long soak benchmark.',
};
await writeFile(path.join(dir, 'summary.json'), JSON.stringify(summary, null, 2), { mode: 0o600 });
console.log('CAPACITY_READ_COMPLETE');

import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { packs } from '../../generative/packs.js';
import { verifyProductionBaseline } from '../report.js';
import { baselineIntegrity } from '../decomposition-runner.js';
import { verifyV21 } from '../competency/freeze-v21.js';
import {
  runTargetedAfterTrack,
  type CompetencyOptions,
  type CompetencyTrackResult,
} from './after-runner.js';
const output = 'data/synthetic-validation/middle-targeted-after';
const lockPath = 'data/synthetic-validation/middle-targeted-review/AFTER_PRE_RUN_LOCK.json';
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
if (!isMainThread) {
  const { track, options } = workerData as { track: string; options: CompetencyOptions };
  await runTargetedAfterTrack(track, options, (s) => parentPort!.postMessage(s));
} else if (process.argv.includes('--freeze')) {
  if (existsSync(lockPath)) throw new Error('Targeted study already frozen');
  const files = [
    'src/synthetic-validation/targeted/scope-metadata.ts',
    'src/synthetic-validation/targeted/scoped-runtime.ts',
    'docs/MIDDLE_TARGETED_FIX_RATIONALE.md',
    'data/competency-rubrics/PRE_RUN_LOCK_V21.json',
  ];
  mkdirSync('data/synthetic-validation/middle-targeted-review', { recursive: true });
  writeFileSync(
    lockPath,
    JSON.stringify(
      {
        version: 'targeted-scope-1.0',
        frozenAt: new Date().toISOString(),
        seeds: 500,
        benchmarkSeed: 48121,
        masteryChanged: false,
        numericPolicyChanged: false,
        productionChanged: false,
        sha256: Object.fromEntries(files.map((p) => [p, sha(p)])),
      },
      null,
      2,
    ) + '\n',
  );
} else {
  if (existsSync(`${output}/CONFIG.json`))
    throw new Error('Existing study output; never overwrite');
  const verify = () => {
    const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { sha256: Record<string, string> };
    const changed = Object.entries(lock.sha256)
      .filter(([p, h]) => sha(p) !== h)
      .map(([p]) => p);
    return {
      production: verifyProductionBaseline(),
      v1baseline: baselineIntegrity(),
      v21specification: verifyV21(),
      targeted: { unchanged: !changed.length, changed },
    };
  };
  const integrity = verify();
  if (Object.values(integrity).some((i) => !i.unchanged))
    throw new Error(JSON.stringify(integrity));
  const options: CompetencyOptions = {
    version: '2.1.0',
    seeds: 500,
    benchmarkSeed: 48121,
    workers: 4,
    tracks: packs.filter((p) => p.enabled).map((p) => p.id),
    output,
  };
  mkdirSync(output, { recursive: true });
  writeFileSync(
    `${output}/CONFIG.json`,
    JSON.stringify({ ...options, scopeVersion: 'targeted-scope-1.0', integrity }, null, 2) + '\n',
  );
  const pending = [...options.tracks],
    start = Date.now();
  const work = async () => {
    while (pending.length) {
      const track = pending.shift()!;
      await new Promise<void>((resolve, reject) => {
        const w = new Worker(new URL('./after-cli.js', import.meta.url), {
          workerData: { track, options },
        });
        w.on('message', (s) => console.log(s));
        w.on('error', reject);
        w.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${track} exit ${c}`))));
      });
    }
  };
  await Promise.all(Array.from({ length: 4 }, () => work()));
  const results = options.tracks.map(
    (t) =>
      JSON.parse(
        readFileSync(`${output}/tracks/${t}/RESULTS.json`, 'utf8'),
      ) as CompetencyTrackResult,
  );
  const summary = {
    scopeVersion: 'targeted-scope-1.0',
    sessions: results.reduce((s, r) => s + r.sessions, 0),
    diagnosticSessions: results.reduce((s, r) => s + r.decompositionSessions, 0),
    failures: results.flatMap((r) => r.failures),
    replayChecks: results.reduce((s, r) => s + r.replayChecks, 0),
    replayFailures: results.reduce((s, r) => s + r.replayFailures, 0),
    semanticOptionMismatches: results.reduce((s, r) => s + r.audit.semanticOptionMismatches, 0),
    semanticPlanMismatches: results.reduce((s, r) => s + r.audit.semanticPlanMismatches, 0),
    wallTimeMs: Date.now() - start,
    integrity: verify(),
  };
  writeFileSync(`${output}/SUMMARY.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (
    summary.failures.length ||
    summary.replayFailures ||
    summary.semanticOptionMismatches ||
    summary.semanticPlanMismatches
  )
    process.exitCode = 1;
}

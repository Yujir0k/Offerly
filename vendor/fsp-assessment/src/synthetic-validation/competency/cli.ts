import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packs } from '../../generative/packs.js';
import { baselineIntegrity } from '../decomposition-runner.js';
import { verifyProductionBaseline } from '../report.js';
import { freezeCompetencyModel, verifyCompetencyFreeze } from './freeze.js';
import { freezeV21, verifyV21 } from './freeze-v21.js';
import { runTargetedAfterTrack } from '../targeted/after-runner.js';
import { verifyScopedFreeze } from '../targeted/integrity.js';
import {
  runCompetencyTrack,
  type CompetencyOptions,
  type CompetencyTrackResult,
} from './runner.js';
if (!isMainThread) {
  const { track, options, scopeCorrected } = workerData as {
    track: string;
    options: CompetencyOptions;
    scopeCorrected?: boolean;
  };
  await (scopeCorrected ? runTargetedAfterTrack : runCompetencyTrack)(track, options, (s) =>
    parentPort!.postMessage(s),
  );
} else if (process.argv.includes('--freeze-v21')) {
  console.log(JSON.stringify(freezeV21(), null, 2));
} else if (process.argv.includes('--freeze')) {
  console.log(JSON.stringify(freezeCompetencyModel(), null, 2));
} else {
  const flag = (key: string, fallback: string) => {
    const i = process.argv.indexOf('--' + key);
    return i < 0 ? fallback : process.argv[i + 1] || fallback;
  };
  const enabled = packs.filter((p) => p.enabled).map((p) => p.id);
  const version = flag('version', '2.2.0');
  if (!['2.0.0', '2.1.0', '2.2.0'].includes(version)) throw new Error('Unknown policy version');
  const verify =
    version === '2.2.0'
      ? verifyScopedFreeze
      : version === '2.1.0'
        ? verifyV21
        : verifyCompetencyFreeze;
  const options: CompetencyOptions = {
    version: (version === '2.2.0' ? '2.1.0' : version) as CompetencyOptions['version'],
    seeds: Number(flag('seeds', '500')),
    benchmarkSeed: Number(flag('seed', '48121')),
    workers: Number(flag('workers', '4')),
    tracks: flag('tracks', enabled.join(',')).split(','),
    output: resolve(
      flag(
        'output',
        version === '2.2.0'
          ? 'data/synthetic-validation/competency-scoped-replay'
          : 'data/synthetic-validation/competency-based',
      ),
    ),
  };
  if (
    [options.seeds, options.benchmarkSeed, options.workers].some(
      (n) => !Number.isSafeInteger(n) || n < 1,
    ) ||
    options.tracks.some((t) => !enabled.includes(t))
  )
    throw new Error('Invalid benchmark options');
  if (
    options.output === resolve('data/synthetic-validation/baseline') ||
    options.output.startsWith(resolve('data/synthetic-validation/baseline') + '/')
  )
    throw new Error('Old baseline is immutable');
  if (existsSync(`${options.output}/CONFIG.json`))
    throw new Error('Output exists. Choose a new study directory; never overwrite a result.');
  const integrity = {
    baseline: baselineIntegrity(),
    production: verifyProductionBaseline(),
    competency: verify(),
  };
  if (Object.values(integrity).some((i) => !i.unchanged))
    throw new Error('Frozen source integrity violation: ' + JSON.stringify(integrity));
  mkdirSync(options.output, { recursive: true });
  writeFileSync(
    `${options.output}/CONFIG.json`,
    JSON.stringify(
      {
        ...options,
        cliVersion: version,
        scopeVersion: version === '2.2.0' ? 'targeted-scope-1.0' : null,
        integrity,
        preRunLock: JSON.parse(
          readFileSync(
            version === '2.2.0'
              ? 'data/synthetic-validation/middle-targeted-review/AFTER_PRE_RUN_LOCK.json'
              : version === '2.1.0'
                ? 'data/competency-rubrics/PRE_RUN_LOCK_V21.json'
                : 'data/competency-rubrics/PRE_RUN_LOCK.json',
            'utf8',
          ),
        ),
      },
      null,
      2,
    ) + '\n',
  );
  const pending = [...options.tracks],
    start = Date.now();
  const work = async () => {
    while (pending.length) {
      const track = pending.shift()!;
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./cli.js', import.meta.url), {
          workerData: { track, options, scopeCorrected: version === '2.2.0' },
        });
        worker.on('message', (s) => console.log(s));
        worker.on('error', reject);
        worker.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`${track}: exit ${code}`)),
        );
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.workers, options.tracks.length) }, () => work()),
  );
  const results = options.tracks.map(
    (t) =>
      JSON.parse(
        readFileSync(`${options.output}/tracks/${t}/RESULTS.json`, 'utf8'),
      ) as CompetencyTrackResult,
  );
  const summary = {
    sessions: results.reduce((s, r) => s + r.sessions, 0),
    decompositionSessions: results.reduce((s, r) => s + r.decompositionSessions, 0),
    failures: results.flatMap((r) => r.failures),
    replayChecks: results.reduce((s, r) => s + r.replayChecks, 0),
    replayFailures: results.reduce((s, r) => s + r.replayFailures, 0),
    semanticSteps: results.reduce((s, r) => s + r.audit.stepsChecked, 0),
    semanticOptionMismatches: results.reduce((s, r) => s + r.audit.semanticOptionMismatches, 0),
    semanticPlanMismatches: results.reduce((s, r) => s + r.audit.semanticPlanMismatches, 0),
    wallTimeMs: Date.now() - start,
    integrity: {
      baseline: baselineIntegrity(),
      production: verifyProductionBaseline(),
      competency: verify(),
    },
  };
  writeFileSync(`${options.output}/SUMMARY.json`, JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary, null, 2));
  if (
    summary.failures.length ||
    summary.replayFailures ||
    summary.semanticOptionMismatches ||
    summary.semanticPlanMismatches
  )
    process.exitCode = 1;
}

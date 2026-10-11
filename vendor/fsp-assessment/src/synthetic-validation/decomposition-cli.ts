import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';
import {
  baselineIntegrity,
  runDiagnosticTrack,
  writeDiagnosticReport,
  type DiagnosticOptions,
  type DiagnosticTrackResult,
} from './decomposition-runner.js';
import { verifyProductionBaseline } from './report.js';

if (!isMainThread) {
  const { track, options } = workerData as { track: string; options: DiagnosticOptions };
  await runDiagnosticTrack(track, options, (text) => parentPort!.postMessage(text));
} else {
  const args = process.argv.slice(2),
    flag = (name: string, fallback: string) => {
      const index = args.indexOf(`--${name}`);
      return index < 0 ? fallback : args[index + 1] || fallback;
    };
  const baseline = resolve(flag('baseline', 'data/synthetic-validation/baseline'));
  const config = JSON.parse(readFileSync(`${baseline}/CONFIG.json`, 'utf8')) as {
    benchmarkSeed: number;
    seeds: number;
    tracks: string[];
  };
  const seeds = Number(flag('seeds', String(config.seeds))),
    workers = Number(flag('workers', '4'));
  const tracks = flag('tracks', config.tracks.join(',')).split(',');
  if (
    !Number.isSafeInteger(seeds) ||
    seeds < 1 ||
    seeds > config.seeds ||
    !Number.isSafeInteger(workers) ||
    workers < 1 ||
    tracks.some((track) => !config.tracks.includes(track))
  )
    throw new Error('Decomposition must use valid existing baseline cohorts and seeds');
  const options: DiagnosticOptions = {
    baseline,
    output: resolve(flag('output', 'data/synthetic-validation/decomposition')),
    seeds,
    workers,
    tracks,
    benchmarkSeed: config.benchmarkSeed,
  };
  const lockedBaseline = resolve(
    (
      JSON.parse(readFileSync('data/synthetic-validation/BASELINE_LOCK.json', 'utf8')) as {
        baselineDirectory: string;
      }
    ).baselineDirectory,
  );
  if (options.output === lockedBaseline || options.output.startsWith(`${lockedBaseline}/`))
    throw new Error('Diagnostic output cannot overwrite the original locked baseline');
  if (options.output === baseline || options.output.startsWith(`${baseline}/`))
    throw new Error('Diagnostic output cannot overwrite locked baseline');
  if (!baselineIntegrity().unchanged || !verifyProductionBaseline().unchanged)
    throw new Error('Baseline or production has changed');
  mkdirSync(options.output, { recursive: true });
  writeFileSync(`${options.output}/CONFIG.json`, JSON.stringify(options, null, 2) + '\n');
  const pending = [...tracks],
    started = Date.now();
  await Promise.all(
    Array.from({ length: Math.min(workers, tracks.length) }, async () => {
      while (pending.length) {
        const track = pending.shift()!;
        await new Promise<void>((resolve, reject) => {
          const worker = new Worker(new URL('./decomposition-cli.js', import.meta.url), {
            workerData: { track, options },
          });
          worker.on('message', (message) => console.log(message));
          worker.on('error', reject);
          worker.on('exit', (code) =>
            code === 0
              ? resolve()
              : reject(new Error(`${track}: diagnostic worker exited ${code}`)),
          );
        });
      }
    }),
  );
  const results = tracks.map((track) => {
    const directory = `${options.output}/tracks/${track}`;
    return {
      ...JSON.parse(readFileSync(`${directory}/AUDIT.json`, 'utf8')),
      observations: gunzipSync(readFileSync(`${directory}/SESSION_RESULTS.jsonl.gz`))
        .toString('utf8')
        .trim()
        .split('\n')
        .map((row) => JSON.parse(row)),
    } as DiagnosticTrackResult;
  });
  const summary = writeDiagnosticReport(
    results,
    options,
    args.includes('--no-doc') ? undefined : 'docs/SYNTHETIC_DECOMPOSITION_REPORT.md',
  );
  writeFileSync(
    `${options.output}/PERFORMANCE.json`,
    JSON.stringify(
      {
        wallTimeMs: Date.now() - started,
        workers,
        sessionsPerSecond: summary.totalSessions / ((Date.now() - started) / 1000),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        sessions: summary.totalSessions,
        oracleFailures: summary.oracleFailures.length,
        perfectAnswerEvidenceFailures: summary.perfectAnswerEvidenceFailures.length,
        baselineReplayFailures: summary.baselineReplayFailures.length,
        semanticOptionMismatches: summary.semanticOptionMismatches,
        semanticPlanMismatches: summary.semanticPlanMismatches,
        output: options.output,
      },
      null,
      2,
    ),
  );
  if (
    summary.generationFailures.length ||
    summary.oracleFailures.length ||
    summary.perfectAnswerEvidenceFailures.length ||
    summary.baselineReplayFailures.length ||
    summary.semanticOptionMismatches ||
    summary.semanticPlanMismatches ||
    !summary.baselineIntegrity.unchanged ||
    !summary.productionIntegrity.unchanged
  )
    process.exitCode = 1;
}

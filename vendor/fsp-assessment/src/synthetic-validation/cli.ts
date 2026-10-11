import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { packs } from '../generative/packs.js';
import {
  runTrack,
  heuristicThresholds,
  type BenchmarkOptions,
  type TrackResult,
} from './runner.js';
import { runMetamorphic } from './metamorphic.js';
import { verifyProductionBaseline, writeBenchmarkReport } from './report.js';

function optionsFromArgs(args: string[]): BenchmarkOptions {
  const flag = (key: string, fallback: string) => {
    const index = args.indexOf(`--${key}`);
    return index < 0 ? fallback : args[index + 1] || fallback;
  };
  const integer = (key: string, fallback: string) => {
    const value = Number(flag(key, fallback));
    if (!Number.isSafeInteger(value) || value <= 0)
      throw new Error(`--${key} must be a positive integer`);
    return value;
  };
  const enabled = packs.filter((p) => p.enabled).map((p) => p.id);
  const tracks = flag('tracks', enabled.join(',')).split(',');
  if (tracks.some((track) => !enabled.includes(track)))
    throw new Error('Unknown or disabled track');
  const thresholdsPath = flag('thresholds', '');
  const thresholds = thresholdsPath
    ? {
        ...heuristicThresholds,
        ...(JSON.parse(readFileSync(thresholdsPath, 'utf8')) as Partial<
          typeof heuristicThresholds
        >),
      }
    : heuristicThresholds;
  if (Object.values(thresholds).some((value) => !Number.isFinite(value) || value < 0 || value > 1))
    throw new Error('Heuristic thresholds must be in [0,1]');
  return {
    seeds: integer('seeds', '500'),
    benchmarkSeed: integer('seed', '48121'),
    itemSeeds: integer('item-seeds', '64'),
    output: resolve(
      flag(
        'output',
        existsSync('data/synthetic-validation/BASELINE_LOCK.json')
          ? 'data/synthetic-validation/new-run'
          : 'data/synthetic-validation/baseline',
      ),
    ),
    tracks,
    workers: integer('workers', '4'),
    heuristicThresholds: thresholds,
  };
}
if (!isMainThread) {
  const { track, options } = workerData as { track: string; options: BenchmarkOptions };
  await runTrack(track, options, (message) => parentPort!.postMessage({ progress: message }));
  parentPort!.postMessage({ completed: track });
} else {
  const args = process.argv.slice(2),
    options = optionsFromArgs(args),
    integrity = verifyProductionBaseline();
  if (existsSync('data/synthetic-validation/BASELINE_LOCK.json')) {
    const lock = JSON.parse(
      readFileSync('data/synthetic-validation/BASELINE_LOCK.json', 'utf8'),
    ) as { baselineDirectory: string };
    const locked = resolve(lock.baselineDirectory);
    if (options.output === locked || options.output.startsWith(`${locked}/`))
      throw new Error('Baseline is locked; choose a separate --output directory.');
  }
  const mutationSamples = args.includes('--mutation-seeds')
    ? Number(args[args.indexOf('--mutation-seeds') + 1])
    : 3;
  if (!Number.isSafeInteger(mutationSamples) || mutationSamples < 1)
    throw new Error('--mutation-seeds must be a positive integer');
  if (!integrity.unchanged)
    throw new Error(`Production differs from Phase A baseline: ${integrity.changed.join(', ')}`);
  mkdirSync(options.output, { recursive: true });
  writeFileSync(`${options.output}/CONFIG.json`, JSON.stringify(options, null, 2) + '\n');
  const started = Date.now(),
    pending = [...options.tracks];
  const work = async () => {
    while (pending.length) {
      const track = pending.shift()!;
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL('./cli.js', import.meta.url), {
          workerData: { track, options },
        });
        worker.on('message', (message) => {
          if (message.progress) console.log(message.progress);
        });
        worker.on('error', reject);
        worker.on('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`${track} worker exited ${code}`)),
        );
      });
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(options.workers, options.tracks.length) }, () => work()),
  );
  const results = options.tracks.map(
    (track) =>
      JSON.parse(
        readFileSync(`${options.output}/tracks/${track}/RESULTS.json`, 'utf8'),
      ) as TrackResult,
  );
  const metamorphic = args.includes('--skip-metamorphic')
    ? null
    : runMetamorphic(options.benchmarkSeed, mutationSamples);
  const reportPath = args.includes('--no-doc') ? undefined : 'docs/SYNTHETIC_VALIDATION_REPORT.md';
  const summary = writeBenchmarkReport(results, options, metamorphic, reportPath);
  writeFileSync(
    `${options.output}/PERFORMANCE.json`,
    JSON.stringify(
      {
        wallTimeMs: Date.now() - started,
        workers: options.workers,
        sessionsPerSecond: summary.sessionsSimulated / ((Date.now() - started) / 1000),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    JSON.stringify(
      {
        sessions: summary.sessionsSimulated,
        generationFailures: summary.generationFailures.length,
        simulationFailures: summary.simulationFailures.length,
        metamorphicFailures: summary.metamorphicFailures,
        monotonicityViolations: summary.monotonicityViolations.length,
        gradeOrderingViolations: summary.gradeOrderingViolations.length,
        output: options.output,
      },
      null,
      2,
    ),
  );
  if (
    summary.generationFailures.length ||
    summary.simulationFailures.length ||
    summary.seedInstability.failures ||
    summary.metamorphicFailures ||
    !summary.productionIntegrity.unchanged
  )
    process.exitCode = 1;
}

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { baselineIntegrity } from '../decomposition-runner.js';
import { verifyProductionBaseline } from '../report.js';
const lockPath = 'data/competency-rubrics/PRE_RUN_LOCK.json';
const frozenFiles = () => [
  ...readdirSync('data/competency-rubrics')
    .filter((f) => f.endsWith('.json') && f !== 'PRE_RUN_LOCK.json')
    .map((f) => `data/competency-rubrics/${f}`),
  'docs/PROFESSIONAL_GRADE_RUBRICS.md',
  ...['rubrics', 'personas', 'policy', 'runtime'].map(
    (f) => `src/synthetic-validation/competency/${f}.ts`,
  ),
  ...['policy', 'profiles', 'metadata', 'math', 'model', 'runtime'].map(
    (f) => `src/synthetic-validation/${f}.ts`,
  ),
  'scripts/competency-validation/build-rubrics.py',
  'scripts/competency-validation/refine-mapping.py',
];
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
export function freezeCompetencyModel() {
  if (existsSync(lockPath))
    throw new Error(
      'Pre-run model is already frozen. Changes require a separately versioned study, never in-place tuning.',
    );
  if (!baselineIntegrity().unchanged || !verifyProductionBaseline().unchanged)
    throw new Error('Original baseline or production changed');
  const lock = {
    version: 'competency-policy-2.0.0',
    frozenAt: new Date().toISOString(),
    benchmarkSeed: 48121,
    seedsPerProfileTrackTarget: 500,
    tracks: 12,
    personasPerTrack: 22,
    behaviorProbabilityStatus: 'Authored, uncalibrated priors. No outcome-dependent tuning.',
    sha256: Object.fromEntries(frozenFiles().map((f) => [f, hash(f)])),
  };
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}
export function verifyCompetencyFreeze() {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as { sha256: Record<string, string> };
  const changed = Object.entries(lock.sha256)
    .filter(([f, h]) => hash(f) !== h)
    .map(([f]) => f);
  return {
    filesChecked: Object.keys(lock.sha256).length,
    changed,
    unchanged: changed.length === 0,
  };
}

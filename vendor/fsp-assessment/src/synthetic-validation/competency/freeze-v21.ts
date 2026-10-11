import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { verifyCompetencyFreeze } from './freeze.js';
const path = 'data/competency-rubrics/PRE_RUN_LOCK_V21.json';
const hash = (f: string) => createHash('sha256').update(readFileSync(f)).digest('hex');
export function freezeV21() {
  if (existsSync(path)) throw new Error('V2.1 specification is already frozen');
  if (!verifyCompetencyFreeze().unchanged) throw new Error('Original v2.0 specification changed');
  const original = JSON.parse(
    readFileSync('data/competency-rubrics/PRE_RUN_LOCK.json', 'utf8'),
  ) as { sha256: Record<string, string> };
  const files = [
    'data/competency-rubrics/PRE_RUN_LOCK.json',
    ...['personas', 'policy', 'runtime'].map(
      (f) => `src/synthetic-validation/competency/${f}-v21.ts`,
    ),
  ];
  const lock = {
    version: 'competency-policy-2.1.0',
    frozenAt: new Date().toISOString(),
    benchmarkSeed: 48121,
    seedsPerProfileTrackTarget: 500,
    correction:
      'JM-borderline diagnostic uncertainty applies to integrated/strategic evidence, preserving its mastered bounded Junior capabilities. No changes to mastery, comprehension/slip priors, other personas or production scoring.',
    sha256: { ...original.sha256, ...Object.fromEntries(files.map((f) => [f, hash(f)])) },
  };
  writeFileSync(path, JSON.stringify(lock, null, 2) + '\n');
  return lock;
}
export function verifyV21() {
  const lock = JSON.parse(readFileSync(path, 'utf8')) as { sha256: Record<string, string> };
  const changed = Object.entries(lock.sha256)
    .filter(([f, h]) => hash(f) !== h)
    .map(([f]) => f);
  return { filesChecked: Object.keys(lock.sha256).length, changed, unchanged: !changed.length };
}

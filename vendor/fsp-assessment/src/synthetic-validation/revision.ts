import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const revisionManifestPath = 'data/assessment-revisions/formal-generator-7.3.3/LOCK.json';
export const revisedProductionFiles = [
  'src/generative/generator.ts',
  'src/generative/legacy-world.ts',
  'src/generative/qualitative-runtime.ts',
  'src/generative/validators.ts',
  'src/generative/model.ts',
  'src/generative/professional/authoring.ts',
  'src/generative/harness.ts',
  'src/adaptive/service.ts',
  'src/adaptive/engine.ts',
  'src/adaptive/model.ts',
  'src/server.ts',
] as const;

/** Verify the explicitly registered successor without rewriting historical hashes. */
export function verifyAssessmentRevision() {
  const lock = JSON.parse(readFileSync(revisionManifestPath, 'utf8')) as {
    revision: string;
    sources: Record<string, string>;
    historicalSources: Record<string, string>;
  };
  const mismatch = (hashes: Record<string, string>) =>
    Object.entries(hashes)
      .filter(
        ([path, hash]) => createHash('sha256').update(readFileSync(path)).digest('hex') !== hash,
      )
      .map(([path]) => path);
  const changed = mismatch(lock.sources);
  const historicalChanged = mismatch(lock.historicalSources);
  return {
    revision: lock.revision,
    filesChecked: Object.keys(lock.sources).length,
    changed,
    historicalChanged,
    unchanged: !changed.length && !historicalChanged.length,
  };
}

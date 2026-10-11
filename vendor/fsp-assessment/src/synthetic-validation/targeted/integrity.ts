import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyV21 } from '../competency/freeze-v21.js';
export function verifyScopedFreeze() {
  const original = verifyV21();
  const lock = JSON.parse(
    readFileSync(
      'data/synthetic-validation/middle-targeted-review/AFTER_PRE_RUN_LOCK.json',
      'utf8',
    ),
  ) as { sha256: Record<string, string> };
  const changed = [
    ...original.changed,
    ...Object.entries(lock.sha256)
      .filter(([p, h]) => createHash('sha256').update(readFileSync(p)).digest('hex') !== h)
      .map(([p]) => p),
  ];
  return {
    filesChecked: original.filesChecked + Object.keys(lock.sha256).length,
    changed,
    unchanged: !changed.length,
  };
}

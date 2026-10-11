import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { massGenerate, writePreview } from './harness.js';
import type { TargetGrade } from '../adaptive/model.js';

const value = (name: string, fallback: string) =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) || fallback;
const grade = value('grade', 'Middle');
if (!['Junior', 'Middle', 'Senior'].includes(grade)) throw new Error('grade: Junior/Middle/Senior');
const output = resolve(value('output', 'data/generative'));
const result = massGenerate(
  value('pack', 'backend'),
  grade as TargetGrade,
  Number(value('sessions', '100')),
  Number(value('items', '0')),
  Number(value('seed', '1')),
);
mkdirSync(dirname(`${output}-report.json`), { recursive: true });
writeFileSync(
  `${output}-report.json`,
  JSON.stringify({ ...result.report, sessions: result.sessions }, null, 2),
);
writeFileSync(`${output}-pool.json`, JSON.stringify({ items: result.items }, null, 2));
writePreview(`${output}-preview.html`, result.items, 50);
process.stdout.write(JSON.stringify(result.report, null, 2) + '\n');
if (
  result.report.validationFailed ||
  result.report.generatedSessions !== result.report.requestedSessions ||
  result.report.duplicateRate > 0
)
  process.exitCode = 1;

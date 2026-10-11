import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { validateTechnical } from './validation-engine.js';
const report = validateTechnical();
const directory = resolve(process.env.DATA_DIR ?? 'data');
mkdirSync(directory, { recursive: true });
writeFileSync(join(directory, 'technical-validation.json'), JSON.stringify(report, null, 2));
process.stdout.write(
  JSON.stringify(
    {
      passed: report.passed,
      variants: report.variants,
      transitions: report.transitions,
      rejected: report.faultyStrategiesRejected,
      humanCalibration: report.humanCalibration,
    },
    null,
    2,
  ) + '\n',
);
if (!report.passed) process.exitCode = 1;

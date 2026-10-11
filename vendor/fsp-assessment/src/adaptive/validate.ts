import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { simulateAssessment, validationReport, type ValidationObservation } from './validation.js';

const input = process.argv.find((arg) => arg.startsWith('--input='))?.slice(8);
const output = resolve(
  process.argv.find((arg) => arg.startsWith('--output='))?.slice(9) ||
    'data/adaptive-validation.json',
);
const observations: ValidationObservation[] = input
  ? (JSON.parse(readFileSync(resolve(input), 'utf8')) as ValidationObservation[])
  : simulateAssessment();
const report = validationReport(observations, input ? 'observed' : 'simulation');
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2));
process.stdout.write(
  `${report.label}\nSessions: ${report.sessions}; completion: ${report.completionRate}; boundary: ${report.boundaryUsageRate}\nDuration (scripted for simulation): ${JSON.stringify(report.durationMinutes)}\nReport: ${output}\n`,
);

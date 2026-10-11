import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLegacyVariant as generateVariant, publicVariant } from '../src/generator.js';
import { runExperiment } from '../src/simulator.js';
import { evaluate, matchNeed } from '../src/scoring.js';
import { oracleInput, validateTechnical } from '../src/validation-engine.js';
import { calibrationReport } from '../src/calibration.js';
import type { Assessment, Need } from '../src/domain.js';

test('same seed reproduces substantive materials; oracle stays private', () => {
  const first = generateVariant('data-science', 'Middle', 42);
  const second = generateVariant('data-science', 'Middle', 42);
  assert.deepEqual(first.rows, second.rows);
  assert.deepEqual(first.oracle, second.oracle);
  assert.notDeepEqual(first.rows, generateVariant('data-science', 'Middle', 43).rows);
  const visible = publicVariant(first);
  assert.equal('oracle' in visible, false);
  assert.equal('seed' in visible, false);
  assert.ok(visible.queries.every((query) => !('expectedId' in query)));
});
test('a high leaked metric does not certify a valid experiment', () => {
  const variant = generateVariant('data-science', 'Middle', 42);
  const leaked = runExperiment(
    variant,
    { features: [variant.oracle.leakedFeature], split: 'random' },
    1,
  );
  assert.ok(leaked.metrics.accuracy! > 0.9);
  assert.equal(leaked.checks.availableFeatures, false);
  const correct = runExperiment(variant, oracleInput(variant), 1);
  assert.ok(Object.values(correct.checks).every(Boolean));
  const changed = runExperiment(variant, oracleInput(variant), 2);
  assert.notEqual(changed.metrics.accuracy, correct.metrics.accuracy);
});
test('retrieval checks both known answers and abstentions', () => {
  const variant = generateVariant('llm', 'Middle', 7);
  assert.equal(runExperiment(variant, oracleInput(variant), 1).metrics.accuracy, 1);
  assert.equal(runExperiment(variant, { policy: 'current', topK: 2 }, 1).metrics.abstention, 0);
});
test('event processing remains correct under replay and reordered delivery', () => {
  const variant = generateVariant('backend', 'Senior', 7);
  for (const stage of [1, 2])
    assert.equal(runExperiment(variant, { strategy: 'versioned' }, stage).metrics.accuracy, 1);
  assert.equal(runExperiment(variant, { strategy: 'dedupe' }, 1).checks.orderIndependent, false);
});
test('grade stays provisional and requires evidence in both stages', () => {
  const variant = generateVariant('backend', 'Middle', 17);
  const assessment: Assessment = {
    id: 'a',
    candidateId: 'c',
    needId: null,
    variant,
    stage: 2,
    state: 'submitted',
    experiments: [runExperiment(variant, oracleInput(variant), 1)],
    answers: variant.oracle.answers,
    recommendation: 'Принять изменение после проверки инвариантов и описать план отката.',
    createdAt: '',
    submittedAt: '',
    result: null,
  };
  assert.equal(evaluate(assessment).proposedGrade, null);
  assessment.experiments.push(runExperiment(variant, oracleInput(variant), 2));
  const result = evaluate(assessment);
  assert.equal(result.status, 'provisional');
  assert.equal(result.proposedGrade, 'Middle');
  assert.equal(result.score, 90);
  const need: Need = {
    id: 'n',
    employerId: 'e',
    title: 'Role',
    trackId: 'backend',
    grade: 'Middle',
    stack: [],
    required: ['retrieval'],
    weights: { retrieval: 5 },
    toolMode: 'local',
    salaryMin: 1,
    salaryMax: 2,
    description: 'Need',
  };
  assert.deepEqual(matchNeed(need, [result]).missing, ['retrieval']);
});
test('empty pilot does not invent calibration measures', () => {
  const report = calibrationReport([]);
  assert.equal(report.humanObservations, 0);
  assert.equal(report.expertAgreement, null);
  assert.equal(report.repeatAgreement, null);
});
test('technical validation spans all role contexts, levels and changed conditions', () => {
  const report = validateTechnical(2);
  assert.equal(report.passed, true);
  assert.equal(report.variants, 156);
  assert.equal(report.humanCalibration, 'not_performed');
});

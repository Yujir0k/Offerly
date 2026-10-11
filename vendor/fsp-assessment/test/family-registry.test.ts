import test from 'node:test';
import assert from 'node:assert/strict';
import { families, chooseFamily } from '../src/families/registry.js';
import {
  generateVariant,
  generateUniqueVariant,
  variantFingerprint,
  publicVariant,
} from '../src/generator.js';
import { tracks } from '../src/catalog.js';
import { grades } from '../src/domain.js';
import { oracleInput, preflight, validateTechnical } from '../src/validation-engine.js';
import { runExperiment } from '../src/simulator.js';
import { evaluate } from '../src/scoring.js';
import type { Assessment } from '../src/domain.js';

test('every specialization has two distinct professional families and valid skill metadata', () => {
  assert.equal(families.length, 26);
  assert.equal(new Set(families.map((family) => family.id)).size, 26);
  for (const track of tracks) {
    const own = families.filter((family) => family.trackId === track.id);
    assert.equal(own.length, 2);
    assert.notEqual(own[0]!.run, own[1]!.run);
    assert.ok(own.every((family) => family.skills.every((skill) => track.skills.includes(skill))));
  }
});
test('employer priorities choose different families without changing grade rules', () => {
  assert.equal(chooseFamily('ml-engineering', ['cost'], { cost: 10 }), 'mle-batching-precision');
  assert.equal(
    chooseFamily('ml-engineering', ['validation'], { validation: 10 }),
    'mle-serving-contract',
  );
  assert.throws(() => chooseFamily('llm', [], {}, ['backend-cache-isolation']));
});
test('every family issues ten reproducible questions with distinct applied tasks and a fixed theory weight', () => {
  for (const family of families) {
    const first = generateVariant(family.trackId, 'Middle', 15, 'docs', family.id);
    const replay = generateVariant(family.trackId, 'Middle', 15, 'docs', family.id);
    const second = generateVariant(family.trackId, 'Middle', 16, 'docs', family.id);
    assert.equal(first.questions.length, 10, family.id);
    assert.equal(new Set(first.questions.map((item) => item.prompt)).size, 10, family.id);
    assert.deepEqual(first.questions, replay.questions);
    assert.equal(
      first.questions.reduce((total, question) => total + question.points, 0),
      20,
    );
    assert.notDeepEqual(first.lab?.data, second.lab?.data, family.id);
    assert.notDeepEqual(
      first.questions
        .map((item) => ({
          prompt: item.prompt,
          options: item.options.map((option) => option.text).sort(),
        }))
        .sort((a, b) => a.prompt.localeCompare(b.prompt)),
      second.questions
        .map((item) => ({
          prompt: item.prompt,
          options: item.options.map((option) => option.text).sort(),
        }))
        .sort((a, b) => a.prompt.localeCompare(b.prompt)),
      family.id,
    );
    for (const question of first.questions) {
      assert.equal(
        new Set(question.options.map((option) => option.text)).size,
        question.options.length,
        family.id,
      );
      assert.ok(question.options.some((option) => option.id === first.oracle.answers[question.id]));
    }
    preflight(first);
  }
});
test('specialized variants are reproducible and never publish reference or fault plans', () => {
  const first = generateVariant('sre', 'Senior', 12, 'local', 'sre-rolling-capacity');
  const second = generateVariant('sre', 'Senior', 12, 'local', 'sre-rolling-capacity');
  assert.deepEqual(first.lab, second.lab);
  assert.deepEqual(first.oracle, second.oracle);
  assert.notDeepEqual(
    first.lab?.data,
    generateVariant('sre', 'Senior', 13, 'local', 'sre-rolling-capacity').lab?.data,
  );
  const initial = publicVariant(first, 1);
  const changed = publicVariant(first, 2);
  assert.notDeepEqual(initial.lab?.data, changed.lab?.data);
  assert.equal('oracle' in initial, false);
  assert.equal(JSON.stringify(initial).includes('referencePlans'), false);
  assert.equal(JSON.stringify(initial).includes('mutants'), false);
});
test('issued task collisions are regenerated instead of disguising the same task with new IDs or option positions', () => {
  const previous = generateVariant('backend', 'Middle', 15, 'docs', 'backend-cache-isolation');
  const shuffled = structuredClone(previous);
  shuffled.id = 'different-id';
  shuffled.questions.reverse();
  shuffled.questions.forEach((question) => question.options.reverse());
  assert.equal(variantFingerprint(previous), variantFingerprint(shuffled));
  const seeds = [15, 15, 16];
  const fresh = generateUniqueVariant(
    'backend',
    'Middle',
    'docs',
    [previous],
    'backend-cache-isolation',
    () => seeds.shift()!,
  );
  assert.equal(fresh.seed, 16);
  assert.notEqual(variantFingerprint(previous), variantFingerprint(fresh));
  assert.throws(
    () =>
      generateUniqueVariant(
        'backend',
        'Middle',
        'docs',
        [previous],
        'backend-cache-isolation',
        () => 15,
      ),
    /повторное задание не выдано/,
  );
});
test('all issued families have live condition changes, feasible plans and sensitive validators', () => {
  for (const family of families)
    for (const grade of grades) {
      const variant = generateVariant(family.trackId, grade, 23, 'local', family.id);
      preflight(variant);
      assert.notDeepEqual(variant.lab!.data, variant.oracle.specialized!.changedData, family.id);
      for (const stage of [1, 2])
        assert.ok(
          Object.values(runExperiment(variant, oracleInput(variant, stage), stage).checks).every(
            Boolean,
          ),
        );
      assert.throws(() => runExperiment(variant, { plan: { injected: 'x' } }, 1));
      const bad = { ...variant.oracle.specialized!.referencePlans[0] };
      const control = variant.lab!.controls[0]!;
      bad[control.id] = control.type === 'number' ? Infinity : '__not_an_option__';
      assert.throws(() => runExperiment(variant, { plan: bad }, 1));
    }
});
test('seed/grade stress matrix validates all 26 families, not only one favorable seed', () => {
  const report = validateTechnical(32);
  assert.deepEqual(report.failures, []);
  assert.equal(report.variants, 2496);
  assert.equal(report.transitions, 4992);
  assert.equal(report.humanCalibration, 'not_performed');
  assert.ok(report.faultyStrategiesRejected > 10000);
});
test('a successful discarded experiment does not override the final incorrect plan', () => {
  const variant = generateVariant('backend', 'Middle', 17, 'closed', 'backend-payment-idempotency');
  const assessment: Assessment = {
    id: 'a',
    candidateId: 'c',
    needId: null,
    variant,
    stage: 2,
    state: 'submitted',
    experiments: [
      runExperiment(variant, oracleInput(variant, 1), 1),
      runExperiment(variant, oracleInput(variant, 2), 2),
    ],
    answers: variant.oracle.answers,
    recommendation: 'Проверено; перед запуском нужны мониторинг и план восстановления.',
    createdAt: '',
    submittedAt: '',
    result: null,
  };
  assert.equal(evaluate(assessment).score, 90);
  assessment.experiments.push(
    runExperiment(variant, { plan: variant.oracle.specialized!.mutants[1][0]! }, 2),
  );
  assert.equal(evaluate(assessment).proposedGrade, null);
});

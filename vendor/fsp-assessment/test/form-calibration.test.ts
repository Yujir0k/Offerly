import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBlueprint } from '../src/generative/generator.js';
import { calibratedFormDistance } from '../src/adaptive/item-calibration.js';
import { packs } from '../src/generative/packs.js';
import { questionFingerprint } from '../src/generative/validators.js';
import { createSession, publicSession } from '../src/adaptive/engine.js';
import { gradeConfigs } from '../src/adaptive/config.js';

test('balanced form chooses the closest reference without changing core bands or repeating questions', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
      const options = { specialization: pack.id, calibratedForms: true };
      const first = generateBlueprint(grade, 81527, { ...options, calibratedForms: false });
      const balanced = generateBlueprint(grade, 81527, options);
      assert.ok(calibratedFormDistance(balanced) <= calibratedFormDistance(first) + 1e-12);
      assert.deepEqual(
        balanced.items.map((i) => [
          i.stage,
          i.steps[0]!.rubric.dimension,
          i.generated.difficulty!.band,
        ]),
        first.items.map((i) => [
          i.stage,
          i.steps[0]!.rubric.dimension,
          i.generated.difficulty!.band,
        ]),
      );
      const questions = [...balanced.items, ...balanced.boundaryPool].flatMap((item) =>
        item.steps.map((step) => questionFingerprint(item, step, pack)),
      );
      assert.equal(new Set(questions).size, questions.length);
      assert.deepEqual(
        generateBlueprint(grade, 81527, options).items.map((i) => i.id),
        balanced.items.map((i) => i.id),
      );
    }
  }
});

test('boundary calibration is saved with the session and excluded from candidate inputs', () => {
  const session = createSession('calibration', 'candidate', 'Middle', 8179);
  const calibration = session.config.boundaryCalibration!;
  assert.ok(calibration.source.includes('not human calibration'));
  assert.equal(Object.keys(calibration.byItem).length, session.boundaryPool.length);
  assert.ok(
    Object.values(calibration.byItem).some((row) =>
      Object.values(row).some((cell) => cell.n === 16 && cell.discrimination > 0),
    ),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(session)).config.boundaryCalibration, calibration);
  const visible = JSON.stringify(publicSession(session));
  for (const key of ['boundaryCalibration', 'ownScore', 'lowerScore', 'discrimination'])
    assert.ok(!visible.includes('"' + key + '"'));
  assert.equal(session.config.cutScore, gradeConfigs.Middle.cutScore);
  assert.deepEqual(session.config.weights, gradeConfigs.Middle.weights);
});

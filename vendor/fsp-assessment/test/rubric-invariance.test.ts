import test from 'node:test';
import assert from 'node:assert/strict';
import { getPack, packs } from '../src/generative/packs.js';
import {
  buildWorld,
  buildIntents,
  deriveGroundTruth,
  evaluateIntent,
} from '../src/generative/world.js';
import {
  buildIntents as legacyIntents,
  evaluateIntent as legacyScore,
} from '../src/generative/legacy-world.js';
import { generateItem } from '../src/generative/generator.js';
import {
  verifyAssessmentRevision,
  revisedProductionFiles,
} from '../src/synthetic-validation/revision.js';
import { verifyProductionBaseline } from '../src/synthetic-validation/report.js';

test('fixed semantic responses retain scores across distractor seeds in every published model', () => {
  let checked = 0;
  for (const pack of packs.filter((entry) => entry.enabled)) {
    for (const model of pack.itemModels) {
      const grade = model.supportedGrades!.includes('Middle')
        ? 'Middle'
        : model.supportedGrades![0]!;
      const world = buildWorld(pack, model, grade, 99173);
      const truth = deriveGroundTruth(model, world);
      for (const kind of [
        'diagnosis',
        'interpretation',
        'remediation',
        'adaptation',
        'falsification',
      ] as const) {
        const scores = new Map<string, number>();
        for (let seed = 1; seed <= 8; seed++) {
          const intents = buildIntents(model, world, kind, seed);
          assert.equal(
            intents.filter((intent) => evaluateIntent(intent, world, truth) === 1).length,
            1,
          );
          for (const intent of intents) {
            const value = evaluateIntent(intent, world, truth);
            if (scores.has(intent.id))
              assert.equal(
                value,
                scores.get(intent.id),
                `${pack.id}/${model.id}/${kind}/${intent.id}`,
              );
            scores.set(intent.id, value);
          }
        }
        checked++;
      }
    }
  }
  assert.equal(checked, 184 * 5);
});

test('incompatible Backend causal worlds receive no invented partial evidence', () => {
  const pack = getPack('backend');
  const model = pack.itemModels.find((entry) => entry.id === 'transaction_event_gap')!;
  const item = generateItem(pack, model, 'Middle', 'review', 'correctness', 99173);
  const world = item.generated.worldState;
  const truth = deriveGroundTruth(model, world);
  for (let seed = 1; seed <= 8; seed++) {
    for (const intent of buildIntents(model, world, 'diagnosis', seed)) {
      assert.equal(
        evaluateIntent(intent, world, truth),
        intent.predictsHazard === truth.hazard ? 1 : 0,
      );
    }
    for (const intent of legacyIntents(model, world, 'diagnosis', seed)) {
      assert.equal(
        legacyScore(intent, world, truth),
        intent.predictsHazard === truth.hazard ? 1 : 0,
      );
    }
  }
});

test('historical source hashes remain historical and successor changes are explicit', () => {
  assert.deepEqual(
    [...verifyProductionBaseline().changed].sort(),
    [...revisedProductionFiles].sort(),
  );
  assert.ok(verifyAssessmentRevision().unchanged);
});

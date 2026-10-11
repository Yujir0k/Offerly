import test from 'node:test';
import assert from 'node:assert/strict';
import { executeTransition, transitionPrediction } from '../src/generative/transition.js';
import { packs } from '../src/generative/packs.js';
import { generateItem } from '../src/generative/generator.js';
import { strategyDecision } from '../src/generative/qualitative-runtime.js';
import { planAccepted, semanticOracleAnswer } from '../src/synthetic-validation/decomposition.js';
import { scopedMetadata } from '../src/synthetic-validation/targeted/scope-metadata.js';
import { validationMetadata } from '../src/synthetic-validation/metadata.js';

test('late scope guards and post-activation snapshots cannot repair earlier exposure or restore origin', () => {
  assert.deepEqual(
    executeTransition(
      ['capture-origin', 'apply-local-fix', 'activate-target', 'prepare-scope'],
      31,
    ),
    {
      functionalContract: true,
      compatibleConsumers: false,
      rollbackSafe: true,
      interruption: 31,
      prediction: 'scope',
    },
  );
  assert.equal(
    executeTransition(['prepare-scope', 'apply-local-fix', 'activate-target', 'capture-origin'], 31)
      .prediction,
    'rollback',
  );
  assert.equal(
    executeTransition(['apply-local-fix', 'activate-target', 'prepare-scope', 'capture-origin'], 31)
      .prediction,
    'scope-rollback',
  );
  assert.equal(
    executeTransition(['prepare-scope', 'capture-origin', 'apply-local-fix', 'activate-target'], 31)
      .prediction,
    'safe',
  );
  assert.equal(
    executeTransition(
      ['prepare-scope', 'capture-origin', 'apply-local-fix', 'activate-target', 'discard-origin'],
      31,
    ).prediction,
    'rollback',
  );
});

test('all professions require independently predicted transition consequences and reject a copied but wrong forecast', () => {
  const predictions = new Set<string>();
  for (const pack of packs.filter((p) => p.enabled)) {
    const model = pack.itemModels.find((m) => m.gradeRange?.includes('Senior'))!;
    for (let seed = 0; seed < 12; seed++) {
      const item = generateItem(pack, model, 'Senior', 'boundary', 'engineering_judgment', seed);
      const step = item.steps[0]!;
      const world = item.generated.stepWorlds[step.id]!;
      const work = world.work!;
      const prediction = transitionPrediction(work);
      predictions.add(prediction.prediction);
      const decision = strategyDecision(work);
      assert.equal(decision.feasible.length, 2, pack.id);
      assert.ok(decision.outcomes.some((o) => !o.compatibleConsumers || !o.rollbackSafe));
      const cheapest = [...decision.outcomes].sort((a, b) => a.cost - b.cost)[0]!;
      assert.ok(!decision.feasible.includes(cheapest), pack.id);
      const accepted = item.generated.responseChecks![step.id]!.accepted;
      for (const plan of accepted) {
        assert.equal(plan.transitionPrediction, prediction.prediction);
        assert.equal(plan.transitionExposure, String(prediction.interruption));
        assert.ok(planAccepted(item, step, plan));
        assert.ok(
          !planAccepted(item, step, {
            ...plan,
            transitionPrediction: prediction.prediction === 'safe' ? 'rollback' : 'safe',
          }),
        );
      }
      assert.ok(
        scopedMetadata(item, step).demandBasis.includes(
          'counterfactual-ordered-transition-consequences',
        ),
      );
      const metadata = validationMetadata(item, step);
      const oracle = semanticOracleAnswer(step, metadata);
      assert.ok(planAccepted(item, step, oracle.execution));
      const strategy = JSON.parse(
        item.generated.stepArtifacts[step.id]!.find((a) => a.id === 'strategy')!.content,
      );
      assert.equal(
        strategy.proposedTransition,
        work.decisionArchetypes[work.transition!.probe]!.action,
      );
      assert.ok(
        strategy.records.every(
          (row: Record<string, unknown>) =>
            Array.isArray(row.operations) &&
            !('compatibleConsumers' in row) &&
            !('retainedRollback' in row),
        ),
      );
    }
  }
  assert.deepEqual([...predictions].sort(), ['rollback', 'safe', 'scope', 'scope-rollback']);
});

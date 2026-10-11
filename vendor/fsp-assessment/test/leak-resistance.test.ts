import test from 'node:test';
import assert from 'node:assert/strict';
import { packs, getPack } from '../src/generative/packs.js';
import { generateItem, generateBlueprint } from '../src/generative/generator.js';
import { observeGeneratedItems } from '../src/generative/harness.js';
import type { ExposureRecord } from '../src/generative/model.js';
import { buildWorld } from '../src/generative/world.js';
import { canonical, validateGeneratedItem } from '../src/generative/validators.js';
import { validatePlan } from '../src/families/core.js';
import { families } from '../src/families/registry.js';
import { nativeSimulations } from '../src/generative/professional/native-simulations.js';
import { answer, createSession, publicSession } from '../src/adaptive/engine.js';
import { backendDefinition } from '../src/adaptive/bank.js';
import type { Plan } from '../src/domain.js';

test('all 181 generators bind the required plan to material conditions across candidates', () => {
  let count = 0;
  for (const pack of packs.filter((entry) => entry.enabled)) {
    for (const model of pack.itemModels) {
      assert.ok(model.runtime?.responseTask, model.id);
      const tasks = Array.from({ length: 24 }, (_entry, seed) =>
        model.runtime!.responseTask!(
          model,
          buildWorld(
            pack,
            model,
            model.gradeRange!.includes('Middle') ? 'Middle' : 'Junior',
            seed * 104729 + 71,
          ),
          'remediation',
        ),
      );
      const copied = tasks[0]!.accepted[0]!;
      assert.ok(
        tasks.some((task) => !task.accepted.some((plan) => canonical(plan) === canonical(copied))),
        `${model.id}: fixed answer always succeeds`,
      );
      for (const task of tasks)
        for (const plan of task.accepted) validatePlan(task.task.controls, plan);
      count++;
    }
  }
  assert.equal(count, 184);
});

test('all 33 executable generators accept only minimal patches that pass real simulator checks', () => {
  let count = 0;
  for (const pack of packs.filter((entry) => entry.enabled)) {
    for (const model of pack.itemModels.filter((entry) =>
      entry.capabilities?.includes('executable-work-sample'),
    )) {
      const family = [...families, ...nativeSimulations].find(
        (entry) => `work-${entry.id}` === model.id,
      )!;
      for (const seed of [31, 113, 409]) {
        const world = buildWorld(pack, model, 'Middle', seed);
        const state = JSON.parse(String(world.radicals.failure.simulation)) as ReturnType<
          typeof family.build
        > & { proposed: Plan };
        const response = model.runtime!.responseTask!(model, world, 'remediation');
        assert.ok(!Object.values(family.run(state.data, state.proposed).checks).every(Boolean));
        for (const patch of response.accepted) {
          const plan: Plan = Object.fromEntries(
            Object.entries(patch)
              .filter(([key]) => !['context', 'sourceRevision', 'strategy'].includes(key))
              .map(([key, value]) => [
                key,
                value === 'keep' ? state.proposed[key] : JSON.parse(String(value).slice(4)),
              ]),
          );
          assert.ok(Object.values(family.run(state.data, plan).checks).every(Boolean), model.id);
          for (const [key, value] of Object.entries(patch)) {
            if (['context', 'sourceRevision', 'strategy'].includes(key)) continue;
            if (value === 'keep') continue;
            const omitted = { ...plan, [key]: state.proposed[key]! };
            assert.ok(
              !Object.values(family.run(state.data, omitted).checks).every(Boolean),
              `${model.id}: unnecessary change accepted`,
            );
          }
        }
      }
      count++;
    }
  }
  assert.equal(count, 33);
});

test('required plans reject omission and unknown keys, and wrong plans score zero without leaking an oracle', () => {
  const pack = getPack('backend');
  const model = pack.itemModels[0]!;
  const item = generateItem(pack, model, 'Middle', 'anchors', 'correctness', 73);
  const session = createSession('plan', 'candidate', 'Middle', 7, 1000, backendDefinition);
  session.items[0]!.variant = structuredClone(item);
  const step = item.steps[0]!;
  const best = step.options.find((option) => step.rubric.scores[option.id] === 1)!;
  const expected = item.generated.responseChecks![step.id]!.accepted[0]!;
  assert.throws(() => answer(session, item.id, step.id, best.id, 2000), /Заполните план/);
  assert.throws(
    () => answer(session, item.id, step.id, best.id, 2000, { ...expected, fake: 'anything' }),
    /неизвестные/,
  );
  assert.equal(session.responses.length, 0);
  const incorrect = { ...expected };
  const field = step.responseTask!.controls[0]!;
  incorrect[field.id] = field.options.find((option) => option.value !== expected[field.id])!.value;
  answer(session, item.id, step.id, best.id, 2000, incorrect);
  assert.equal(session.responses[0]!.contributions[0]!.value, 0);
  assert.deepEqual(session.responses[0]!.execution, incorrect);
  assert.doesNotMatch(
    JSON.stringify(publicSession(session, 2000)),
    /responseChecks|"accepted"|groundTruth|"scores"|optionIntents/,
  );
});

test('frozen plan evaluation survives JSON reload and changes to the current generator', () => {
  const pack = getPack('android');
  const model = pack.itemModels[0]!;
  const item = generateItem(pack, model, 'Middle', 'anchors', 'correctness', 73);
  const original = model.runtime!.responseTask!;
  const session = createSession('frozen-plan', 'candidate', 'Middle', 7, 1000, backendDefinition);
  session.items[0]!.variant = JSON.parse(JSON.stringify(item));
  const step = item.steps[0]!;
  try {
    model.runtime!.responseTask = () => {
      throw new Error('new generator unavailable');
    };
    answer(
      session,
      item.id,
      step.id,
      step.options.find((option) => step.rubric.scores[option.id] === 1)!.id,
      2000,
      item.generated.responseChecks![step.id]!.accepted[0],
    );
    assert.equal(session.responses[0]!.contributions[0]!.value, 1);
  } finally {
    model.runtime!.responseTask = original;
  }
});

test('the quality gate rejects a forged frozen accepted plan', () => {
  const pack = getPack('frontend');
  const model = pack.itemModels[0]!;
  const item = structuredClone(generateItem(pack, model, 'Middle', 'anchors', 'correctness', 13));
  item.generated.responseChecks![item.steps[0]!.id]!.accepted = [{ invalid: 'plan' }];
  assert.ok(
    validateGeneratedItem(item, model, pack).some((entry) => entry.gate === 'response_plan'),
  );
});

test('native scenarios preserve existing guards and reject blindly enabling everything', () => {
  for (const family of nativeSimulations) {
    const fixture = family.build('Middle', 17);
    const plan = Object.fromEntries(fixture.controls.map((control) => [control.id, 'yes']));
    assert.equal(family.run(fixture.data, plan).checks.changeBudget, false, family.id);
  }
});

test('fixed Backend domain quotas survive repeated attempts and boundary exposure by one candidate', () => {
  const pack = getPack('backend');
  for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
    const exposure: ExposureRecord[] = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      const blueprint = generateBlueprint(grade, 571 + attempt, {
        specialization: pack.id,
        userId: 'repeat-owner',
        exposure,
      });
      const counts = Object.fromEntries(
        Object.keys(pack.coreDomainCounts![grade]).map((domain) => [
          domain,
          blueprint.items.filter((item) => item.generated.competencyDomain === domain).length,
        ]),
      );
      assert.deepEqual(counts, pack.coreDomainCounts![grade]);
      observeGeneratedItems(
        [...blueprint.items, ...blueprint.boundaryPool.slice(0, 3)],
        exposure,
        `repeat-${attempt}`,
        'repeat-owner',
      );
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getPack, getItemModel } from '../src/generative/packs.js';
import { generateBlueprint, generateItem } from '../src/generative/generator.js';
import { validateDomainCoverage } from '../src/generative/content-policy.js';
import { validateGeneratedItem } from '../src/generative/validators.js';
import { evaluateIntent } from '../src/generative/world.js';
import { humanReasoning } from '../src/generative/narrative.js';
import { seniorRollout } from '../src/generative/senior-rollout.js';
import {
  createSession,
  assessmentProgress,
  answer,
  openEvidence,
  publicSession,
} from '../src/adaptive/engine.js';
import type { TargetGrade } from '../src/adaptive/model.js';
const start = Date.parse('2026-10-06T08:00:00Z');

test('supporting snapshots never invent a successful commit or delivery', () => {
  const pack = getPack('backend');
  const model = getItemModel('backend', 'transaction_event_gap');
  for (let seed = 1; seed <= 20; seed++) {
    const item = generateItem(pack, model, 'Middle', 'incident', 'diagnosis', seed);
    const queue = item.artifacts.find((artifact) => artifact.type === 'queue')!;
    assert.doesNotMatch(queue.content, /"status": "delivered"/);
    const code = item.artifacts.find((artifact) => artifact.type === 'code')!;
    assert.match(code.content, /const intent =/);
    const trace = item.artifacts.find((artifact) => artifact.type === 'trace')!;
    assert.match(
      trace.content,
      item.generated.groundTruth.bestDiagnosticArtifact === 'trace'
        ? /Наблюдаемое выполнение/
        : /завершение шагов не подтверждено/,
    );
  }
});

test('competing repairs preserve unrelated properties and Senior tradeoffs match the model', () => {
  const cache = getItemModel('backend', 'cache_inconsistency');
  const tenantRepair = cache.cases.find((causalCase) => causalCase.id === 'missing-tenant')!.repair;
  assert.match(tenantRepair, /порядок проверки прав и версий оставить прежним/);
  const api = getItemModel('backend', 'api_backward_compatibility');
  assert.doesNotMatch(api.cases.find((c) => c.id === 'sync-to-async')!.repair, /identity|retry/);
  const operational = seniorRollout(getItemModel('backend', 'connection_pool_starvation'));
  assert.match(operational.old_writer.constraint, /нагрузка на зависимость/);
  assert.match(operational.rollback.plan, /Цена:/);
  assert.match(
    humanReasoning('на retry; при commit; готовности consumer'),
    /при повторе; при фиксации; готовности получателя/i,
  );
});

test('all grades enforce domain coverage and Junior includes at least three local models', () => {
  for (const grade of ['Junior', 'Middle', 'Senior'] as TargetGrade[])
    for (let seed = 1; seed <= 12; seed++) {
      const blueprint = generateBlueprint(grade, seed);
      const models = blueprint.items.map((item) =>
        getItemModel('backend', item.generated.itemModelId),
      );
      assert.ok(validateDomainCoverage(models, grade));
      assert.ok(models.every((model) => model.gradeRange!.includes(grade)));
      assert.ok(
        blueprint.boundaryPool.every((item) =>
          getItemModel('backend', item.generated.itemModelId).gradeRange!.includes(grade),
        ),
      );
    }
});
test('structured narrative avoids debug prose and assessment-wide boilerplate', () => {
  const blueprint = generateBlueprint('Middle', 41);
  for (const item of blueprint.items)
    for (const step of item.steps) {
      assert.ok(step.scenario?.observations.length);
      assert.ok(step.scenario?.context.length);
      assert.doesNotMatch(
        step.context,
        /Все указанные наблюдения|Источник, помеченный|Неупомянутые свойства|atlas|nova|iris|orbit|New and delayed|Provider effect|Errors only/,
      );
      assert.ok(step.context.length < 1800);
    }
});
test('evidence varies by model and every diagnostic source is available', () => {
  const pack = getPack('backend');
  const evidenceSets = new Set<string>();
  for (const model of pack.itemModels) {
    const item = generateItem(pack, model, 'Middle', 'incident', 'diagnosis', 81);
    assert.ok(item.artifacts.length <= 8);
    assert.ok(
      item.artifacts.some((a) => a.id === item.generated.groundTruth.bestDiagnosticArtifact),
    );
    assert.ok(item.artifacts.every((a) => model.availableArtifacts!.includes(a.type!)));
    evidenceSets.add(
      item.artifacts
        .map((a) => a.id)
        .sort()
        .join(','),
    );
  }
  assert.ok(evidenceSets.size >= 5);
});
test('competing semantic applicability and structured evidence mismatch fail quality gate', () => {
  const pack = getPack('backend');
  const model = getItemModel('backend', 'transaction_constraints');
  const item = structuredClone(generateItem(pack, model, 'Middle', 'boundary', 'correctness', 1));
  item.steps[0]!.scenario!.observations = ['Другие данные, не соответствующие миру'];
  assert.ok(
    validateGeneratedItem(item, model, pack).some((issue) => issue.gate === 'semantic_consistency'),
  );
  const original = generateItem(pack, model, 'Middle', 'boundary', 'correctness', 1);
  const step = original.steps[0]!;
  const world = original.generated.stepWorlds[step.id]!;
  const truth = original.generated.stepTruths[step.id]!;
  const best = structuredClone(
    original.generated.intents[step.id]!.find(
      (intent) => evaluateIntent(intent, world, truth) === 1,
    )!,
  );
  best.applicability = {
    ...best.applicability,
    writesAtomic: !world.radicals.failure.writesAtomic,
  };
  assert.notEqual(evaluateIntent(best, world, truth), 1);
});
test('incident always tests falsification; boundary measures a separate guarantee or changed condition', () => {
  const blueprint = generateBlueprint('Middle', 77);
  const incident = blueprint.items.find((item) => item.stage === 'incident')!;
  assert.ok(incident.generated.intents.cause!.every((intent) => intent.kind === 'falsification'));
  for (const item of blueprint.boundaryPool) {
    const step = item.steps[0]!;
    assert.ok(step.rubric.informationWeight >= 2);
    const expected = {
      diagnosis: 'falsification',
      correctness: 'negative_guarantee',
      engineering_judgment: 'critical_assumption',
      adaptation: 'adaptation',
    };
    assert.ok(
      item.generated.intents[step.id]!.every(
        (intent) => intent.kind === expected[step.rubric.dimension],
      ),
    );
  }
});
test('progress distinguishes scored answers, mandatory exploration and optional remainder', () => {
  const session = createSession('progress', 'owner', 'Middle', 42, start);
  const initial = assessmentProgress(session);
  const total = session.items.reduce((sum, item) => sum + item.variant.steps.length, 0);
  assert.equal(initial.coreTotalSteps, total);
  assert.equal(initial.remainingMin, total);
  assert.equal(initial.remainingMax, total + session.config.maxBoundaryItems);
  assert.equal(initial.stages[3]!.status, 'optional');
  for (let index = 0; index < total; index++) {
    const item = session.items[session.cursor.item]!.variant;
    const step = item.steps[session.cursor.step]!;
    const now = start + (index + 1) * 20000;
    if (step.exploration) {
      for (const artifact of [...item.artifacts]
        .filter((a) => a.type !== 'architecture')
        .sort((a, b) => b.usefulness - a.usefulness)
        .slice(0, 2))
        openEvidence(session, item.id, step.id, artifact.id, now);
    }
    answer(
      session,
      item.id,
      step.id,
      step.exploration
        ? 'continue'
        : step.options.find((option) => step.rubric.scores[option.id] === 1)!.id,
      now,
      item.generated?.responseChecks?.[step.id]?.accepted[0],
    );
    assert.equal(assessmentProgress(session).coreCompletedSteps, index + 1);
  }
  const completed = assessmentProgress(session);
  assert.equal(
    completed.answered,
    session.responses.filter((response) => response.optionId !== 'continue').length,
  );
  assert.equal(completed.remainingMin, 0);
  assert.equal(completed.remainingMax, 0);
  assert.equal(publicSession(session).targetGrade, 'Middle');
});
test('generation remains usable with all runtime HTTP calls blocked', () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw new Error('Network forbidden during generation');
    };
    assert.equal(generateBlueprint('Middle', 51).items.length, 6);
  } finally {
    globalThis.fetch = original;
  }
});

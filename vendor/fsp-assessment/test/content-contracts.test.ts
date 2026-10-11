import test from 'node:test';
import assert from 'node:assert/strict';
import { packs } from '../src/generative/packs.js';
import { buildWorld, deriveGroundTruth, mutateWorld } from '../src/generative/world.js';
import { generateArtifacts } from '../src/generative/render.js';

test('each evidence revision retains its own public simulation contract and parameters', () => {
  let checked = 0;
  for (const pack of packs.filter((p) => p.enabled))
    for (const model of pack.itemModels.filter((m) => m.id.startsWith('work-')))
      for (const grade of ['Middle', 'Senior'] as const) {
        if (!model.gradeRange?.includes(grade)) continue;
        const world = buildWorld(pack, model, grade, 91377);
        const artifacts = generateArtifacts(model, world, deriveGroundTruth(model, world));
        const schema = JSON.parse(artifacts.find((a) => a.id === 'schema')!.content);
        for (const [physical, revision] of [
          [world, world.work!.activeRevision],
          [world.work!.historicalWorld!, 1 - world.work!.activeRevision],
        ] as const) {
          const simulation = JSON.parse(String(physical.radicals.failure.simulation));
          const report = schema.reports.find(
            (r: { sourceRevision: string }) =>
              r.sourceRevision === (revision === 0 ? 'revision-A' : 'revision-B'),
          );
          assert.ok(report, model.id);
          assert.deepEqual(report.parameters, simulation.data.parameters, model.id);
          assert.equal(report.contract, simulation.contract, model.id);
          assert.equal(typeof report.proposed, 'string');
          assert.match(report.contextContract, /контекст/);
          // Keep hidden oracle plans/rubrics out of public evidence.
          assert.ok(!('accepted' in report));
          assert.ok(!('controls' in report));
          assert.ok(!('rubric' in report));
          checked++;
        }
      }
  assert.ok(checked >= 100);
});

test('scenarios never state the hidden causal answer independently of evidence', () => {
  for (const pack of packs.filter((p) => p.enabled))
    for (const model of pack.itemModels)
      for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
        if (!model.gradeRange?.includes(grade)) continue;
        const world = buildWorld(pack, model, grade, 9931);
        const rendered = model.runtime!.renderScenario(
          model,
          world,
          deriveGroundTruth(model, world),
        );
        assert.doesNotMatch(
          rendered.text,
          /Независимая проверка установила причину|Причина известна/,
        );
      }
});

test('Senior adaptation states the actual changed priority without inventing a domain mutation', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const model = pack.itemModels.find((m) => m.gradeRange?.includes('Senior'))!;
    const world = buildWorld(pack, model, 'Senior', 7611);
    const next = mutateWorld(model, world, 7622);
    assert.deepEqual(next.radicals, world.radicals);
    assert.notEqual(next.work!.policy!.priority, world.work!.policy!.priority);
    assert.match(next.mutation!, /изменён приоритет/);
  }
});

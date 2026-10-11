import test from 'node:test';
import assert from 'node:assert/strict';
import { packs, getPack } from '../src/generative/packs.js';
import {
  generateItem,
  generateBlueprint,
  reproduceGeneratedItem,
} from '../src/generative/generator.js';
import {
  buildWorld,
  deriveGroundTruth,
  mutateWorld,
  evaluateIntent,
} from '../src/generative/world.js';
import { difficultyMetadata, strategyDecision } from '../src/generative/qualitative-runtime.js';
import { canonical, validateGeneratedItem } from '../src/generative/validators.js';
import { createSession, publicSession } from '../src/adaptive/engine.js';
import { gradeProfile } from '../src/generative/difficulty.js';

const active = packs.filter((pack) => pack.enabled);
const grades = ['Junior', 'Middle', 'Senior'] as const;
test('all 12 tracks and all 181 existing models publish truthful qualitative grade support', () => {
  assert.equal(active.length, 12);
  assert.equal(
    active.reduce((sum, pack) => sum + pack.itemModels.length, 0),
    184,
  );
  for (const pack of active)
    for (const model of pack.itemModels) {
      for (const grade of grades)
        assert.equal(!!model.gradeConfigurations?.[grade], model.gradeRange!.includes(grade));
      assert.equal(model.supportsJunior, model.gradeRange!.includes('Junior'));
      assert.equal(model.supportsMiddle, model.gradeRange!.includes('Middle'));
      assert.equal(model.supportsSenior, model.gradeRange!.includes('Senior'));
      assert.ok(model.gradeSupportRationale);
      assert.ok(!('interactingFailures' in pack.worldBounds.Junior));
    }
});

test('the same defect can require local, correlated-system and strategic reasoning in every profession', () => {
  for (const pack of active) {
    const model = pack.itemModels.find((entry) =>
      grades.every((grade) => entry.gradeRange!.includes(grade)),
    )!;
    const worlds = grades.map((grade) => buildWorld(pack, model, grade, 0));
    assert.equal(
      deriveGroundTruth(model, worlds[0]!).hazard,
      deriveGroundTruth(model, worlds[1]!).hazard,
      model.id,
    );
    assert.equal(
      deriveGroundTruth(model, worlds[1]!).hazard,
      deriveGroundTruth(model, worlds[2]!).hazard,
      model.id,
    );
    assert.equal(difficultyMetadata(worlds[0]!)!.structuralEvidence.localContext, true);
    assert.equal(difficultyMetadata(worlds[1]!)!.structuralEvidence.correlatedSources, true);
    const senior = difficultyMetadata(worlds[2]!)!;
    assert.ok(senior.structuralEvidence.feasibleStrategies >= 2);
    assert.ok(senior.structuralEvidence.strategyChangesUnderConstraints);
    assert.equal(worlds[0]!.work!.policy, null);
    assert.ok(worlds[1]!.work!.handoff);
    assert.ok(worlds[2]!.work!.consequences.length >= 2);
  }
});

test('defect counts vary and overlap across all three grades within the same professional model', () => {
  for (const pack of active.filter((entry) => entry.presentation)) {
    const model = pack.itemModels.find(
      (entry) =>
        entry.capabilities?.includes('focused-contract') &&
        grades.every((grade) => entry.gradeRange!.includes(grade)),
    )!;
    const counts = grades.map(
      (grade) =>
        new Set(
          Array.from(
            { length: 64 },
            (_entry, seed) => buildWorld(pack, model, grade, seed).radicals.interactingFailures,
          ),
        ),
    );
    for (const values of counts) {
      assert.ok(values.size > 1, pack.id);
      assert.ok(values.has(1), pack.id);
    }
    assert.deepEqual([...counts[0]!].sort(), [...counts[1]!].sort());
    assert.deepEqual([...counts[1]!].sort(), [...counts[2]!].sort());
  }
});

test('Senior policy adaptation changes the best strategy without inventing additional defects', () => {
  for (const pack of active) {
    const model = pack.itemModels.find((entry) => entry.gradeRange!.includes('Senior'))!;
    const world = buildWorld(pack, model, 'Senior', 0);
    const changed = mutateWorld(model, world, 19);
    assert.equal(deriveGroundTruth(model, world).hazard, deriveGroundTruth(model, changed).hazard);
    assert.deepEqual(world.radicals.failure, changed.radicals.failure);
    assert.notEqual(
      strategyDecision(world.work!).best.index,
      strategyDecision(changed.work!).best.index,
    );
    for (const input of [world, changed]) {
      const alternatives = model.runtime!.createIntents(model, input, 'remediation', 0);
      assert.equal(
        alternatives.filter(
          (intent) => evaluateIntent(intent, input, deriveGroundTruth(model, input)) === 1,
        ).length,
        1,
      );
      assert.equal(
        strategyDecision(input.work!).outcomes.filter((outcome) => outcome.functionalContract)
          .length,
        4,
      );
    }
  }
});

test('candidate task wording and correction requirements do not advertise a fixed grade defect count', () => {
  for (const pack of active.filter((entry) => entry.presentation)) {
    const model = pack.itemModels.find(
      (entry) =>
        entry.capabilities?.includes('focused-contract') &&
        grades.every((grade) => entry.gradeRange!.includes(grade)),
    )!;
    for (const grade of grades) {
      const observed = new Set<number>();
      for (let seed = 0; seed < 8; seed++) {
        const item = generateItem(pack, model, grade, 'anchors', 'engineering_judgment', seed);
        const step = item.steps[0]!;
        observed.add(item.generated.worldState.radicals.interactingFailures);
        const wording = JSON.stringify({
          scenario: step.scenario,
          prompt: step.prompt,
          task: step.responseTask,
        });
        assert.doesNotMatch(
          wording,
          /найдите\s+(?:ровно\s+)?(?:две|три|[123])\s+(?:ошибки|причины|нарушения)/i,
        );
        assert.doesNotMatch(
          wording,
          /"(?:violationCountRange|interactingFailures|structuralEvidence)"\s*:/,
        );
      }
      assert.ok(observed.size > 1, `${pack.id}/${grade}: hidden count became predictable`);
    }
  }
});

test('Middle evidence combines physically different reports with the confirmed workflow revision', () => {
  for (const pack of active) {
    const model = pack.itemModels.find((entry) => entry.gradeRange!.includes('Middle'))!;
    const world = buildWorld(pack, model, 'Middle', 3);
    const artifacts = model.runtime!.createArtifacts(model, world, deriveGroundTruth(model, world));
    assert.ok(artifacts.find((artifact) => artifact.id === 'workflow'));
    assert.ok(
      artifacts.some(
        (artifact) =>
          artifact.content.includes('revision-A') && artifact.content.includes('revision-B'),
      ),
    );
    assert.notEqual(
      deriveGroundTruth(model, world).hazard,
      deriveGroundTruth(model, world.work!.historicalWorld!).hazard,
    );
    const task = model.runtime!.responseTask!(model, world, 'remediation');
    assert.ok(task.task.controls.some((control) => control.id === 'sourceRevision'));
    assert.ok(
      task.accepted.every(
        (plan) =>
          plan.sourceRevision === (world.work!.activeRevision === 0 ? 'revision-A' : 'revision-B'),
      ),
    );
  }
});

test('floor/core/ceiling bands reproduce while target grade remains immutable and metadata stays private', () => {
  for (const pack of active)
    for (const grade of grades) {
      const blueprint = generateBlueprint(grade, 719, { specialization: pack.id });
      assert.deepEqual(
        blueprint.items.slice(0, 4).map((item) => item.difficultyBand),
        pack.assessmentRecipes![grade].anchorBands,
      );
      for (const item of blueprint.items) {
        assert.equal(item.targetGrade, grade);
        assert.deepEqual(item, reproduceGeneratedItem(item));
      }
      const session = createSession(
        'qualitative',
        'candidate',
        grade,
        719,
        1000,
        undefined,
        undefined,
        { specialization: pack.id },
      );
      assert.equal(publicSession(session, 1000).targetGrade, grade);
      assert.doesNotMatch(
        JSON.stringify(publicSession(session, 1000)),
        /"(?:difficulty|gradeTarget|difficultyRationale|structuralEvidence|violationCountRange|reasoningGrade|responseChecks|rubric)"\s*:/,
      );
      assert.ok(session.config.hardCapMs === 1200000);
      assert.ok(
        blueprint.boundaryPool.every((item) =>
          pack.assessmentRecipes![grade].boundaryBands.includes(item.generated.difficulty!.band),
        ),
      );
    }
});

test('structural validators reject a strategic label without feasible choices and consequences', () => {
  const pack = getPack('frontend');
  const model = pack.itemModels.find((entry) => entry.gradeRange!.includes('Senior'))!;
  const item = structuredClone(
    generateItem(pack, model, 'Senior', 'anchors', 'engineering_judgment', 7),
  );
  item.generated.worldState.work!.consequences = [];
  item.generated.stepWorlds.anchor!.work!.consequences = [];
  assert.ok(
    validateGeneratedItem(item, model, pack).some((issue) => issue.gate === 'difficulty_structure'),
  );
});

test('work recipes differ across professions and preserve all shared competency dimensions', () => {
  const recipes = new Set(active.map((pack) => canonical(pack.assessmentRecipes!.Senior.stages)));
  assert.ok(recipes.size >= 4);
  for (const pack of active)
    for (const grade of grades) {
      const blueprint = generateBlueprint(grade, 715, { specialization: pack.id });
      const measured = new Set(
        blueprint.items.flatMap((item) =>
          item.steps.filter((step) => !step.exploration).map((step) => step.rubric.dimension),
        ),
      );
      assert.equal(measured.size, 4);
    }
  assert.notEqual(
    gradeProfile('junior_core').decisionResponsibility,
    gradeProfile('middle_core').decisionResponsibility,
  );
  assert.notEqual(
    gradeProfile('middle_core').decisionResponsibility,
    gradeProfile('senior_core').decisionResponsibility,
  );
});

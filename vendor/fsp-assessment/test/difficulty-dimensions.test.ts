import test from 'node:test';
import assert from 'node:assert/strict';
import { packs, getPack } from '../src/generative/packs.js';
import { generateBlueprint, generateItem } from '../src/generative/generator.js';
import { buildWorld, deriveGroundTruth } from '../src/generative/world.js';
import {
  allowedProfiles,
  profileAllowed,
  type GradeProfile,
} from '../src/generative/difficulty.js';
import { difficultyMetadata, strategyDecision } from '../src/generative/qualitative-runtime.js';
import { publicSession, createSession, openEvidence } from '../src/adaptive/engine.js';
import { validateGeneratedItem } from '../src/generative/validators.js';
import { actionToken } from '../src/generative/decision-archetypes.js';

const active = packs.filter((pack) => pack.enabled);
const grades = ['Junior', 'Middle', 'Senior'] as const;

test('Middle and Senior can involve the same participants; responsibility changes without adding actors', () => {
  for (const pack of active) {
    const model = pack.itemModels.find(
      (model) =>
        model.supportedGrades!.includes('Middle') && model.supportedGrades!.includes('Senior'),
    )!;
    for (let seed = 0; seed < 12; seed++) {
      const middle = buildWorld(pack, model, 'Middle', seed);
      const senior = buildWorld(pack, model, 'Senior', seed);
      assert.deepEqual(middle.work!.actors, senior.work!.actors, pack.id);
      assert.equal(middle.work!.policy, null);
      assert.ok(senior.work!.policy);
      assert.ok(strategyDecision(senior.work!).feasible.length >= 2);
    }
  }
});

test('each dimension overlaps; none is an exact grade classifier', () => {
  const profiles = grades.map((grade) =>
    allowedProfiles(
      grade === 'Junior' ? 'junior_core' : grade === 'Middle' ? 'middle_core' : 'senior_core',
    ),
  );
  for (const dimension of Object.keys(profiles[0]![0]!) as (keyof GradeProfile)[]) {
    const byValue = new Map<string, Set<string>>();
    profiles.forEach((values, index) =>
      values.forEach((profile) => {
        const value = String(profile[dimension]);
        const labels = byValue.get(value) || new Set<string>();
        labels.add(grades[index]!);
        byValue.set(value, labels);
      }),
    );
    assert.ok(
      [...byValue.values()].some((labels) => labels.size >= 2),
      dimension,
    );
    assert.ok(
      grades.every((grade) =>
        [...byValue.values()].some((labels) => labels.has(grade) && labels.size >= 2),
      ),
      dimension,
    );
  }
  assert.ok(profiles[2]!.some((profile) => profile.ambiguity === 1));
  assert.ok(profiles[1]!.some((profile) => profile.ambiguity === 3));
  assert.ok(
    profiles[1]!.some((middle) =>
      profiles[0]!.some(
        (junior) =>
          middle.constraintComplexity < junior.constraintComplexity &&
          middle.causalDepth > junior.causalDepth,
      ),
    ),
  );
});

test('low ambiguity Senior and high ambiguity Middle are rendered work contracts in every track', () => {
  for (const pack of active) {
    const model = pack.itemModels.find((model) =>
      grades.every((grade) => model.supportedGrades!.includes(grade)),
    )!;
    const observed = new Map<string, Set<number>>(
      grades.map((grade) => [grade, new Set<number>()]),
    );
    for (let seed = 0; seed < 24; seed++)
      for (const grade of grades) {
        const world = buildWorld(pack, model, grade, seed);
        const metadata = difficultyMetadata(world)!;
        observed.get(grade)!.add(metadata.profile.ambiguity);
        assert.ok(profileAllowed(world.work!.band, metadata.profile));
        if (grade === 'Senior' && metadata.profile.ambiguity === 1) {
          const scenario = model.runtime!.renderScenario(
            model,
            world,
            deriveGroundTruth(model, world),
          ).scenario;
          assert.ok(scenario.observations.some((text) => text.includes('Обоснуйте диагноз')));
          assert.ok(!scenario.observations.some((text) => text.includes('Причина известна')));
          assert.ok(strategyDecision(world.work!).feasible.length >= 2);
        }
      }
    assert.deepEqual([...observed.get('Junior')!].sort(), [1, 2], pack.id);
    assert.deepEqual([...observed.get('Middle')!].sort(), [1, 2, 3], pack.id);
    assert.deepEqual([...observed.get('Senior')!].sort(), [1, 2, 3], pack.id);
  }
});

test('specializations own meaningful progression and domain-native decision bundles', () => {
  assert.match(getPack('data-scientist').gradeProgressionVocabulary!.Senior, /uncertainty/);
  assert.doesNotMatch(
    JSON.stringify(getPack('data-scientist').gradeProgressionVocabulary),
    /workflow|cross-system/,
  );
  assert.match(getPack('security-appsec').gradeProgressionVocabulary!.Middle, /trust/);
  assert.match(getPack('devops-sre').gradeProgressionVocabulary!.Senior, /reliability/);
  assert.match(getPack('qa-automation').gradeProgressionVocabulary!.Senior, /quality|release-risk/);
  const vocabularies = new Set(
    active.map((pack) => JSON.stringify(pack.gradeProgressionVocabulary)),
  );
  assert.equal(vocabularies.size, 12);
  for (const pack of active) {
    const bundles = new Set(
      Object.values(pack.decisionArchetypeCatalog!.bundles).map((ids) => JSON.stringify(ids)),
    );
    assert.ok(bundles.size >= 4, pack.id);
    for (const model of pack.itemModels) assert.ok(model.decisionArchetypes!.length >= 4, model.id);
  }
});

test('native strategy identity and world constraints determine the best action, not its position', () => {
  for (const pack of active) {
    const positions = new Set<number>();
    const actions = new Set<string>();
    let constrained = 0;
    for (const model of pack.itemModels.filter((model) =>
      model.supportedGrades!.includes('Senior'),
    )) {
      for (let seed = 0; seed < 16; seed++) {
        const world = buildWorld(pack, model, 'Senior', seed);
        const before = strategyDecision(world.work!);
        positions.add(before.best.index);
        world.work!.decisionArchetypes.forEach((action) => {
          actions.add(action.id);
          assert.ok(model.decisionArchetypes!.includes(action.id));
        });
        if (before.feasible.length < 4) constrained++;
        const reversed = structuredClone(world.work!);
        reversed.decisionArchetypes.reverse();
        reversed.strategyPrograms.reverse();
        if (reversed.transition) {
          reversed.transition.programs.reverse();
          reversed.transition.probe =
            reversed.transition.programs.length - 1 - reversed.transition.probe;
        }
        assert.equal(strategyDecision(reversed).best.archetypeId, before.best.archetypeId);
        const plans = model.runtime!.responseTask!(model, world, 'remediation');
        assert.equal(
          plans.accepted[0]!.strategy,
          actionToken(world.work!.decisionArchetypes[before.best.index]!),
        );
      }
    }
    assert.ok(positions.size >= 3, pack.id);
    assert.ok(actions.size >= 8, pack.id);
    assert.ok(constrained > 0, pack.id);
    if (!['backend', 'devops-sre'].includes(pack.id))
      assert.ok(
        ![...actions].some((action) => /canary|dual-version|big-bang/.test(action)),
        pack.id,
      );
  }
});

test('support audit fails unsupported target grades and bands before generating any item', () => {
  for (const pack of active)
    for (const model of pack.itemModels)
      for (const grade of grades) {
        const configuration = model.gradeConfigurations?.[grade];
        if (model.supportedGrades!.includes(grade)) {
          assert.ok(configuration?.professionalResponsibility, model.id);
          assert.ok(
            configuration.requiredReasoning && configuration.uniqueRadicals?.length,
            model.id,
          );
        } else {
          assert.ok(model.gradeExclusions?.[grade], model.id);
          assert.throws(() => buildWorld(pack, model, grade, 71), /не поддерживает/);
          assert.throws(
            () => generateItem(pack, model, grade, 'anchors', 'diagnosis', 71),
            /не опубликован/,
          );
        }
      }
  const juniorOnly = getPack('data-scientist').itemModels.find(
    (model) => model.id === 'ds_claim_boundary',
  )!;
  assert.throws(
    () => buildWorld(getPack('data-scientist'), juniorOnly, 'Junior', 71, 'senior_core'),
    /reasoning band/,
  );
});

test('validators reject fabricated independent profiles and archetypes', () => {
  const pack = getPack('frontend');
  const model = pack.itemModels.find((model) => model.supportedGrades!.includes('Senior'))!;
  const item = structuredClone(
    generateItem(pack, model, 'Senior', 'anchors', 'engineering_judgment', 71),
  );
  item.generated.worldState.work!.profile.ambiguity = 1;
  item.generated.worldState.work!.profile.constraintComplexity = 1;
  item.generated.worldState.work!.decisionArchetypes[0]!.id = 'universal-canary';
  const gates = validateGeneratedItem(item, model, pack).map((issue) => issue.gate);
  assert.ok(gates.includes('difficulty_structure'));
  assert.ok(gates.includes('decision_archetype'));
});

test('candidate payload redacts grade rationale and catalog metadata even after opening strategy evidence', () => {
  const pack = getPack('genai');
  const model = pack.itemModels.find((model) => model.supportedGrades!.includes('Senior'))!;
  const item = generateItem(pack, model, 'Senior', 'incident', 'diagnosis', 71);
  const session = createSession(
    'native-security',
    'candidate',
    'Senior',
    1,
    1000,
    undefined,
    undefined,
    { specialization: pack.id },
  );
  session.items[0]!.variant = structuredClone(item);
  session.items[0]!.stage = 'incident';
  openEvidence(session, item.id, item.steps[0]!.id, 'strategy', 2000);
  const serialized = JSON.stringify(publicSession(session, 2000));
  assert.doesNotMatch(
    serialized,
    /"(?:groundTruth|difficulty|rationale|decisionArchetypes|archetypeId|uniqueRadicals|gradeExclusions|professionalResponsibility|responseChecks|rubric)"\s*:/,
  );
  assert.ok(!serialized.includes('strategy:'), serialized.slice(0, 150));
});

test('all target-grade sessions preserve six-domain coverage after the support audit', () => {
  for (const pack of active)
    for (const grade of grades) {
      const blueprint = generateBlueprint(grade, 8171, { specialization: pack.id });
      assert.equal(blueprint.items.length, 6);
      assert.equal(new Set(blueprint.items.flatMap((item) => item.measuredConstruct)).size, 6);
      for (const item of [...blueprint.items, ...blueprint.boundaryPool]) {
        const model = pack.itemModels.find((model) => model.id === item.generated.itemModelId)!;
        assert.ok(model.supportedGrades!.includes(item.targetGrade));
        assert.ok(model.supportedGrades!.includes(item.generated.worldState.work!.reasoningGrade));
      }
    }
});

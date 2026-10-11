import test from 'node:test';
import assert from 'node:assert/strict';
import { packs, getPack } from '../src/generative/packs.js';
import {
  generateBlueprint,
  generateItem,
  reproduceGeneratedItem,
} from '../src/generative/generator.js';
import {
  buildWorld,
  deriveGroundTruth,
  evaluateIntent,
  mutateWorld,
} from '../src/generative/world.js';
import { generateArtifacts } from '../src/generative/render.js';
import { createSession, publicSession, assessmentProgress } from '../src/adaptive/engine.js';
import { dimensions, type TargetGrade } from '../src/adaptive/model.js';
import { readFileSync, readdirSync } from 'node:fs';
import { nativeSimulations } from '../src/generative/professional/native-simulations.js';

const professional = packs.filter((pack) => pack.enabled && pack.presentation);
const grades: TargetGrade[] = ['Junior', 'Middle', 'Senior'];
test('native security and tool gates jointly block actions while requiring each declared guard', () => {
  const cases = [
    {
      id: 'native-ga-tools',
      row: { schemaValid: false, authorized: false, sensitive: true, confirmed: false },
      plan: { schema: 'no', auth: 'yes', confirmation: 'yes' },
      metric: 'invalidExecuted',
      check: 'schema',
    },
    {
      id: 'native-se-authz',
      row: {
        subjectTenant: 1,
        objectTenant: 2,
        subjectId: 1,
        ownerId: 2,
        action: 'export',
        canExport: false,
      },
      plan: { tenant: 'no', owner: 'yes', function: 'yes' },
      metric: 'crossTenant',
      check: 'tenant',
    },
    {
      id: 'native-se-provenance',
      row: { digestMatches: false, trustedBuilder: false, approved: false },
      plan: { digest: 'no', builder: 'yes', approval: 'yes' },
      metric: 'wrongDigest',
      check: 'digest',
    },
    {
      id: 'native-se-session',
      row: { requestAt: 140, expiresAt: 120, revoked: true, preauthIdentity: true },
      plan: { expiry: 'no', revocation: 'yes', rotation: 'yes' },
      metric: 'expiredAccepted',
      check: 'expiry',
    },
  ];
  for (const entry of cases) {
    const simulation = nativeSimulations.find((candidate) => candidate.id === entry.id)!;
    const blocked = simulation.run({ rows: [entry.row], parameters: {} }, entry.plan);
    assert.equal(blocked.metrics[entry.metric], 0, entry.id);
    assert.equal(blocked.checks[entry.check], false, entry.id);
  }
});
test('eleven professional tracks have independent role blueprints, twelve models and native sources', () => {
  assert.equal(professional.length, 11);
  assert.deepEqual(
    professional
      .filter((pack) => pack.presentation!.groupId === 'ml-ai')
      .map((pack) => pack.id)
      .sort(),
    ['data-scientist', 'genai', 'ml-engineer', 'mlops'],
  );
  assert.deepEqual(
    professional
      .filter((pack) => pack.presentation!.groupId === 'mobile')
      .map((pack) => pack.id)
      .sort(),
    ['android', 'ios'],
  );
  const ids = professional.flatMap((pack) => pack.itemModels.map((model) => model.id));
  assert.equal(ids.length, new Set(ids).size);
  for (const pack of professional) {
    assert.ok(pack.itemModels.length >= 12);
    assert.ok(pack.presentation!.domains.length >= 4);
    assert.ok(pack.presentation!.workSamples.length >= 3);
    assert.deepEqual(pack.competencyBlueprint, [...dimensions]);
    assert.equal(pack.presentation!.trackId, pack.id);
    for (const model of pack.itemModels) {
      assert.ok(model.gradeRange!.every((grade) => grades.includes(grade)));
      assert.equal(model.specialization, pack.id);
      assert.ok(pack.presentation!.domains.some((domain) => domain.id === model.competencyDomain));
      assert.ok(model.runtime);
      assert.equal(
        model.cases.length,
        model.capabilities?.includes('executable-work-sample') ? 4 : 14,
      );
      assert.ok(model.availableArtifacts!.length >= 2);
    }
  }
});

for (const pack of professional) {
  test(`${pack.id}: all causal configurations and grades have one best answer and grounded evidence`, () => {
    for (const grade of grades)
      for (const model of pack.itemModels) {
        if (!model.gradeRange!.includes(grade)) continue;
        const seen = new Set<string>();
        const expectedCount = model.cases.filter(
          (entry) =>
            grades.indexOf(entry.minimumGrade || 'Junior') <= grades.indexOf(grade) &&
            grades.indexOf(entry.maximumGrade || 'Senior') >= grades.indexOf(grade),
        ).length;
        for (let seed = 0; seed < 300 && seen.size < expectedCount; seed++) {
          const world = buildWorld(pack, model, grade, seed);
          const truth = deriveGroundTruth(model, world);
          if (seen.has(truth.hazard)) continue;
          seen.add(truth.hazard);
          for (const stage of ['anchors', 'incident', 'review', 'boundary'] as const) {
            const item = generateItem(
              pack,
              model,
              grade,
              stage,
              stage === 'review' ? 'correctness' : 'diagnosis',
              seed,
            );
            assert.deepEqual(item, reproduceGeneratedItem(item));
            assert.ok(Object.isFrozen(item.generated.worldState));
            for (const step of item.steps) {
              const currentWorld = item.generated.stepWorlds[step.id]!;
              const currentTruth = item.generated.stepTruths[step.id]!;
              assert.deepEqual(
                item.generated.stepArtifacts[step.id],
                generateArtifacts(model, currentWorld, currentTruth),
              );
              if (!step.exploration)
                assert.equal(
                  item.generated.intents[step.id]!.filter(
                    (intent) => evaluateIntent(intent, currentWorld, currentTruth) === 1,
                  ).length,
                  1,
                );
            }
          }
          const changed = mutateWorld(model, world, seed + 1000);
          if (grade === 'Senior') {
            assert.equal(deriveGroundTruth(model, changed).hazard, truth.hazard);
            assert.notDeepEqual(changed.work?.policy, world.work?.policy);
          } else assert.notEqual(deriveGroundTruth(model, changed).hazard, truth.hazard);
        }
        assert.equal(
          seen.size,
          expectedCount,
          `${pack.id}/${model.id}/${grade}: missing causal configuration`,
        );
      }
  });
  test(`${pack.id}: balanced program, native stage presentation, candidate redaction and complete evidence`, () => {
    for (const grade of grades) {
      const blueprint = generateBlueprint(grade, 411, { specialization: pack.id });
      const models = blueprint.items.map((item) =>
        pack.itemModels.find((model) => model.id === item.generated.itemModelId)!,
      );
      assert.ok(
        models
          .slice(4)
          .every((model, index) =>
            pack.stageRequirements![index === 0 ? 'incident' : 'review']!.every((capability) =>
              model.capabilities?.includes(capability),
            ),
          ),
      );
      assert.ok(new Set(models.map((model) => model.competencyDomain)).size >= 4);
      assert.equal(new Set(models.map((model) => model.siblingGroup)).size, 6);
      assert.deepEqual(
        [...new Set(blueprint.boundaryPool.map((item) => item.steps[0]!.rubric.dimension))].sort(),
        [...dimensions].sort(),
      );
      const session = createSession('test', 'candidate', grade, 411, 100000, undefined, undefined, {
        specialization: pack.id,
      });
      const view = publicSession(session, 100000);
      assert.equal(view.packPresentation?.trackId, pack.id);
      assert.equal(
        assessmentProgress(session).coreTotalSteps,
        session.items.reduce((sum, item) => sum + item.variant.steps.length, 0),
      );
      assert.equal(view.deadlineAt, new Date(100000 + 1200000).toISOString());
      assert.ok(view.current!.artifacts.some((artifact) => artifact.type !== 'code'));
      assert.doesNotMatch(
        JSON.stringify(view),
        /groundTruth|predictsHazard|optionIntents|misconception|rubric|semanticFingerprint|surfaceFingerprint/,
      );
      for (const model of pack.itemModels) {
        if (!model.gradeRange!.includes(grade)) continue;
        const world = buildWorld(pack, model, grade, 12);
        const evidence = generateArtifacts(model, world, deriveGroundTruth(model, world));
        const code = evidence.map((artifact) => artifact.content).join('\n');
        if (pack.id === 'android') assert.doesNotMatch(code, /SwiftUI|MainActor|SceneStorage/);
        if (pack.id === 'ios')
          assert.doesNotMatch(code, /WorkManager|SavedStateHandle|Dispatchers|Room\./);
      }
    }
  });
}
test('Senior changes the allowed professional decision rather than worker count', () => {
  for (const pack of professional) {
    const model = pack.itemModels.find((entry) => entry.gradeRange!.includes('Senior'))!;
    const world = buildWorld(pack, model, 'Senior', 42);
    const alternatives = [];
    for (const priority of ['cost', 'delay', 'residualRisk'] as const) {
      const changed = structuredClone(world);
      changed.work!.policy!.priority = priority;
      const intents = model.runtime!.createIntents(model, changed, 'remediation', 0);
      alternatives.push(
        intents.find(
          (intent) => evaluateIntent(intent, changed, deriveGroundTruth(model, changed)) === 1,
        )!.text,
      );
    }
    assert.ok(new Set(alternatives).size >= 2);
    assert.equal(world.radicals.workers, 1);
  }
});
test('professional generation contains no network client or runtime model call', () => {
  const path = 'src/generative/professional';
  for (const file of readdirSync(path).filter((name) => name.endsWith('.ts'))) {
    const source = readFileSync(`${path}/${file}`, 'utf8');
    assert.doesNotMatch(source, /import .*from ['"](?:openai|@anthropic|axios)|\bfetch\s*\(/);
  }
  assert.equal(getPack('backend').itemModels.length, 16);
});

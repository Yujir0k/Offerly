import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSession, publicSession } from '../src/adaptive/engine.js';
import { getPack, packs } from '../src/generative/packs.js';
import { buildWorld, deriveGroundTruth } from '../src/generative/world.js';
import { strategyDecision } from '../src/generative/qualitative-runtime.js';
import {
  candidatePolicy,
  localSuccessProbability,
  misconceptionWeight,
} from '../src/synthetic-validation/policy.js';
import { profilesForPack, domainDefinitions } from '../src/synthetic-validation/profiles.js';
import { validationMetadata } from '../src/synthetic-validation/metadata.js';
import { canonical, seededNoise, seedOf } from '../src/synthetic-validation/math.js';
import {
  emptyReplay,
  prepareMetadata,
  simulateSession,
} from '../src/synthetic-validation/runtime.js';
import { simulateSession as simulateCurrentSession } from '../src/synthetic-validation/improvements/scalar-runtime.js';
import {
  applyMutation,
  causalMutation,
  incidentalMutation,
  priorityMutation,
  semanticGroundTruth,
} from '../src/synthetic-validation/metamorphic.js';
import { runTrack, heuristicThresholds } from '../src/synthetic-validation/runner.js';
import {
  writeBenchmarkReport,
  verifyProductionBaseline,
} from '../src/synthetic-validation/report.js';
import type { CandidateMemory } from '../src/synthetic-validation/model.js';
import {
  revisedProductionFiles,
  verifyAssessmentRevision,
} from '../src/synthetic-validation/revision.js';
const start = Date.parse('2026-10-08T08:00:00Z');
const pack = getPack('backend'),
  profiles = profilesForPack(pack);
const template = createSession('test-synthetic', 'synthetic', 'Middle', 17, start);
const memory = (): CandidateMemory => ({
  hypothesis: null,
  hypothesisRevisions: 0,
  opened: [],
  previousPlan: null,
  previousArchetype: null,
});
const current = template.items[0]!.variant,
  step = current.steps[0]!,
  metadata = validationMetadata(current, step),
  visible = publicSession(template, start).current!.step;

test('each pack uses all real domains and nine ordered competency personas plus native-domain specialists', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const profiles = profilesForPack(pack);
    assert.equal(profiles.filter((p) => p.order !== null).length, 9);
    assert.deepEqual(
      profiles
        .filter((p) => p.specialistDomain)
        .map((p) => p.specialistDomain)
        .sort(),
      domainDefinitions(pack),
    );
    for (const p of profiles)
      assert.deepEqual(Object.keys(p.domainSkills).sort(), domainDefinitions(pack));
    assert.ok(
      profiles.some((p) => p.dimensions.diagnosis > 0.8 && p.dimensions.engineering_judgment < 0.4),
    );
  }
});
test('candidate actions, evidence order, times and misconceptions reproduce under seed', () => {
  for (const p of profiles)
    assert.deepEqual(
      candidatePolicy(p, visible, metadata, memory(), 19),
      candidatePolicy(p, visible, metadata, memory(), 19),
    );
});
test('stronger local ability cannot decrease reliability on the same item/noise draw', () => {
  const ordered = profiles.filter((p) => p.order !== null);
  for (let seed = 0; seed < 100; seed++)
    for (let i = 1; i < ordered.length; i++)
      assert.ok(
        localSuccessProbability(ordered[i]!, metadata, seed) >=
          localSuccessProbability(ordered[i - 1]!, metadata, seed),
      );
});
test('seeded noise is bounded and reproducible', () => {
  for (let seed = 0; seed < 1000; seed++) {
    const n = seededNoise(seed, 0.08);
    assert.ok(n >= -0.08 && n <= 0.08);
    assert.equal(n, seededNoise(seed, 0.08));
  }
});
test('random guesser samples options with no semantic preference and reproducible actions', () => {
  const random = profiles.find((p) => p.mode === 'random')!;
  const counts = new Map<string, number>();
  for (let seed = 0; seed < 2000; seed++) {
    const action = candidatePolicy(random, visible, metadata, memory(), seed);
    counts.set(action.optionId, (counts.get(action.optionId) || 0) + 1);
  }
  assert.equal(counts.size, step.options.length);
  assert.ok([...counts.values()].every((count) => count > 300 && count < 700));
});
test('policy ignores latent class and production-only properties, including forbidden getters', () => {
  const p = profiles.find((p) => p.id === 'clear_middle')!;
  const poisoned = new Proxy(
    { ...p },
    {
      get(target, key, receiver) {
        if (
          [
            'finalScore',
            'cutScore',
            'finalDecision',
            'weights',
            'decisionBand',
            'latentClass',
            'order',
          ].includes(String(key))
        )
          throw new Error(`Forbidden policy read ${String(key)}`);
        return Reflect.get(target, key, receiver);
      },
    },
  );
  const renamed = { ...p, latentClass: 'Senior' as const };
  assert.deepEqual(
    candidatePolicy(poisoned, visible, metadata, memory(), 9),
    candidatePolicy(renamed, visible, metadata, memory(), 9),
  );
});
test('policy runtime dependency graph has no scorer, config, truth evaluator, accepted plan or LLM imports', () => {
  for (const name of ['policy', 'math', 'model']) {
    const source = readFileSync(`src/synthetic-validation/${name}.ts`, 'utf8');
    assert.doesNotMatch(
      source,
      /\.rubric|responseChecks|\.accepted|evaluateIntent|gradeConfigs|\.cutScore|\.finalScore|\.finalDecision|\.weights|\.result/,
    );
    const imports = source
      .split('\n')
      .filter((line) => line.startsWith('import ') && !line.startsWith('import type'));
    assert.ok(imports.every((line) => /\.\/math\.js|node:crypto|\.\.\/random\.js/.test(line)));
    assert.doesNotMatch(source, /openai|anthropic|gemini|fetch\(|https:\/\//i);
  }
});
test('semantic projection excludes scoring and frozen accepted plans; rubric edits do not alter metadata', () => {
  const changed = structuredClone(current),
    changedStep = changed.steps[0]!;
  changedStep.rubric.scores = Object.fromEntries(step.options.map((o) => [o.id, 0]));
  changedStep.rubric.informationWeight = 100;
  changed.generated!.responseChecks = {};
  assert.deepEqual(validationMetadata(changed, changedStep), metadata);
  assert.doesNotMatch(
    JSON.stringify(metadata),
    /"(?:scores|weights|accepted|cutScore|finalDecision|finalScore|decisionBand)"\s*:/,
  );
});
test('misconception susceptibility affects failure preference', () => {
  const profile = profiles[0]!;
  const low = { ...profile, misconceptionSusceptibility: { wrong_causal_layer: 0 } },
    high = { ...profile, misconceptionSusceptibility: { wrong_causal_layer: 1 } };
  assert.ok(
    misconceptionWeight(high, 'wrong_causal_layer') >
      misconceptionWeight(low, 'wrong_causal_layer'),
  );
});
test('policy evidence selection responds to diagnosis behaviour rather than evidence array order', () => {
  const profile = profiles.at(8)!,
    item = template.items.find((i) => i.stage === 'incident')!.variant,
    explore = item.steps.find((s) => s.exploration)!;
  const meta = validationMetadata(item, explore),
    candidate = {
      id: explore.id,
      type: explore.type,
      prompt: explore.prompt,
      context: explore.context,
      options: explore.options,
      exploration: true,
      requiredEvidenceSources: explore.requiredEvidenceSources!,
    };
  const action = candidatePolicy(profile, candidate, meta, memory(), 11),
    permuted = candidatePolicy(
      profile,
      candidate,
      { ...meta, evidence: [...meta.evidence].reverse() },
      memory(),
      11,
    );
  assert.deepEqual(action, permuted);
  assert.ok(action.evidenceOrder.length >= explore.requiredEvidenceSources!);
});
test('full engine replay preserves frozen template and reproduces scores, boundary and action digest', () => {
  const before = canonical(template),
    profile = profiles.find((p) => p.id === 'clear_senior')!;
  const cache = prepareMetadata(template),
    a = simulateSession(template, profile, 91, cache),
    b = simulateSession(template, profile, 91, cache);
  assert.deepEqual(a, b);
  assert.equal(canonical(template), before);
  assert.equal(a.boundaryTargetingFailures.length, 0);
  assert.ok(a.answeredSteps > 4);
  const replay = emptyReplay(template);
  assert.notEqual(replay.responses, template.responses);
  assert.equal(replay.items[0]!.variant, template.items[0]!.variant);
});
test('real engine hard cap rejects late synthetic action and prevents post-deadline contributions', () => {
  const result = simulateSession(template, { ...profiles[8]!, speed: 100 }, 91);
  assert.equal(result.timeout, 1);
  assert.equal(result.durationMs, 20 * 60000);
  assert.equal(result.answeredSteps, 0);
});
test('incidental mutation preserves semantic GroundTruth and all scored intents in every track', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const model = pack.itemModels.find((m) => m.supportedGrades!.includes('Senior'))!,
      world = buildWorld(pack, model, 'Senior', 17);
    const next = applyMutation(model, world, incidentalMutation());
    assert.deepEqual(semanticGroundTruth(model, next), semanticGroundTruth(model, world));
  }
});
test('causal radical replacement produces expected semantic change in every track', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const model = pack.itemModels.find((m) => m.supportedGrades!.includes('Middle'))!,
      world = buildWorld(pack, model, 'Middle', 17);
    const next = applyMutation(model, world, causalMutation(pack, model, world, 17));
    assert.notEqual(deriveGroundTruth(model, next).hazard, deriveGroundTruth(model, world).hazard);
  }
});
test('constraint priority mutation changes best strategy without changing physical cause', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const model = pack.itemModels.find((m) => m.supportedGrades!.includes('Senior'))!,
      world = buildWorld(pack, model, 'Senior', 17);
    const next = applyMutation(model, world, priorityMutation(world));
    assert.equal(deriveGroundTruth(model, next).hazard, deriveGroundTruth(model, world).hazard);
    assert.notEqual(
      strategyDecision(next.work!).best.archetypeId,
      strategyDecision(world.work!).best.archetypeId,
    );
  }
});
test('invalid negative-budget and identity mutations are rejected', () => {
  const model = pack.itemModels.find((m) => m.supportedGrades!.includes('Senior'))!,
    world = buildWorld(pack, model, 'Senior', 17);
  assert.throws(() =>
    applyMutation(model, world, {
      id: 'invalid',
      category: 'constraint',
      expectedGroundTruthEffect: 'mayChange',
      apply: (w) => {
        w.work!.policy!.maxCost = -1;
        return w;
      },
    }),
  );
  assert.throws(() =>
    applyMutation(model, world, {
      id: 'identity',
      category: 'incidental',
      expectedGroundTruthEffect: 'preserve',
      apply: (w) => ({ ...w, modelId: 'other' }),
    }),
  );
});
test('option/control and artifact permutations preserve semantic actions, score and final decision', () => {
  const profile = profiles[8]!,
    baseline = simulateSession(template, profile, 19);
  const changed = structuredClone(template);
  for (const item of [...changed.items.map((i) => i.variant), ...changed.boundaryPool]) {
    item.artifacts.reverse();
    Object.values(item.generated!.stepArtifacts).forEach((a) => a.reverse());
    item.steps.forEach((step) => {
      step.options.reverse();
      step.responseTask?.controls.reverse();
      step.responseTask?.controls.forEach((c) => c.options.reverse());
    });
  }
  assert.deepEqual(simulateSession(changed, profile, 19), baseline);
});
test('all tracks execute complete native plans and evidence through unchanged engine', () => {
  for (const pack of packs.filter((p) => p.enabled)) {
    const session = createSession(
      'native',
      'synthetic',
      'Senior',
      41,
      start,
      undefined,
      undefined,
      { specialization: pack.id },
    );
    const profile = profilesForPack(pack).find((p) => p.id === 'clear_senior')!,
      result = simulateCurrentSession(session, profile, 48);
    assert.equal(result.track, pack.id);
    assert.equal(result.boundaryTargetingFailures.length, 0);
    assert.equal(result.timeout, 0);
    assert.ok(result.answeredItems >= 6);
  }
});
test('small benchmark emits all requested artifacts and every supported model/grade diagnostic', async () => {
  const output = mkdtempSync(join(tmpdir(), 'synthetic-validation-'));
  try {
    const options = {
      seeds: 2,
      benchmarkSeed: seedOf('test'),
      itemSeeds: 2,
      output,
      tracks: ['backend'],
      workers: 1,
      heuristicThresholds,
    };
    const result = await runTrack('backend', options),
      summary = writeBenchmarkReport([result], options, null);
    assert.equal(result.sessionsSimulated, profiles.length * 2 * 3);
    assert.equal(result.generationFailures.length, 0);
    assert.equal(result.simulationFailures.length, 0);
    assert.equal(result.seedInstability.failures, 0);
    for (const row of result.familyConditional) {
      const cohort = result.cohorts.find(
        (c) => c.grade === row.grade && c.profile === row.profile,
      )!;
      assert.equal(row.exposedSessions + row.unexposedSessions, cohort.sessions);
      assert.ok(row.exposedSessions <= cohort.sessions);
    }
    assert.equal(
      result.diagnostics.length,
      pack.itemModels.reduce((s, m) => s + m.supportedGrades!.length, 0),
    );
    for (const file of [
      'SUMMARY.json',
      'GRADE_CONFIRMATION_MATRIX.csv',
      'GRADE_RECOVERY.csv',
      'PROFILE_RESULTS.csv',
      'ITEM_DIAGNOSTICS.csv',
      'BOUNDARY_BEHAVIOR.csv',
      'VARIANT_STABILITY.csv',
      'DOMAIN_SPECIALIST_RESULTS.csv',
      'ADVERSARIAL_PROFILES.csv',
      'MONOTONICITY_VIOLATIONS.csv',
      'GRADE_ORDERING_VIOLATIONS.csv',
      'MODEL_OUTLIERS.csv',
    ])
      assert.ok(readFileSync(join(output, file)).length);
    assert.equal(summary.metamorphicFailures, null);
    assert.equal(summary.productionIntegrity.unchanged, false);
    assert.ok(verifyAssessmentRevision().unchanged);
  } finally {
    rmSync(output, { recursive: true, force: true });
  }
});
test('registered production revision reports historical differences without rewriting the baseline', () => {
  assert.deepEqual(
    [...verifyProductionBaseline().changed].sort(),
    [...revisedProductionFiles].sort(),
  );
  assert.ok(verifyAssessmentRevision().unchanged);
});

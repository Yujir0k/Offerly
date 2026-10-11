import test from 'node:test';
import assert from 'node:assert/strict';
import { getPack, getItemModel, packs } from '../src/generative/packs.js';
import {
  generateItem,
  generateBlueprint,
  modelExposurePenalty,
  reproduceGeneratedItem,
} from '../src/generative/generator.js';
import { deriveGroundTruth, buildWorld, evaluateIntent } from '../src/generative/world.js';
import { generateArtifacts, templateBlocks, templateCompatible } from '../src/generative/render.js';
import { validateGeneratedItem } from '../src/generative/validators.js';
import { validatedFallbackPool } from '../src/generative/pool.js';
import { massGenerate, observeGeneratedItems } from '../src/generative/harness.js';
import {
  answer,
  coreCompleted,
  createSession,
  evaluateEvidence,
  expireSession,
  openEvidence,
  publicSession,
} from '../src/adaptive/engine.js';
import { AdaptiveService } from '../src/adaptive/service.js';
import { Store } from '../src/store.js';
import type { GeneratedItem, ExposureRecord } from '../src/generative/model.js';
import type { AssessmentSession } from '../src/adaptive/model.js';
import { createApplication } from '../src/server.js';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';

const pack = getPack('backend');
const model = getItemModel('backend', 'queue_duplicate_delivery');
const start = Date.parse('2026-10-06T08:00:00Z');
test('failed assessments can be repeated without a cooldown or attempt limit, preserving history', () => {
  const store = new Store(':memory:');
  try {
    const service = new AdaptiveService(store);
    const history: AssessmentSession[] = [];
    let now = start;
    for (let attempt = 0; attempt < 6; attempt++) {
      const session = service.create('retake-owner', 'Middle', 'backend', now);
      assert.equal(session.state, 'active');
      assert.throws(
        () => service.create('retake-owner', 'Middle', 'backend', now),
        /текущую проверку/,
      );
      now += 1200001;
      const finished = service.get(session.id, 'retake-owner', now)!;
      assert.equal(finished.result!.decision, 'NOT_CONFIRMED');
      history.push(structuredClone(finished));
      for (const previous of history)
        assert.deepEqual(service.get(previous.id, 'retake-owner', now), previous);
    }
    assert.equal(service.list('retake-owner', now).length, 6);
  } finally {
    store.close();
  }
});
test('a confirmed assessment allows an immediate attempt at another grade', () => {
  const store = new Store(':memory:');
  try {
    const service = new AdaptiveService(store);
    const created = service.create('confirmed-owner', 'Middle', 'backend', start);
    const session = service.get(created.id, 'confirmed-owner', start)!;
    let now = start;
    while (session.state === 'active') {
      const variant = session.items[session.cursor.item]!.variant;
      const step = variant.steps[session.cursor.step]!;
      now += 20000;
      if (step.exploration)
        for (const artifact of [...variant.artifacts]
          .filter((a) => a.type !== 'architecture')
          .sort((a, b) => b.usefulness - a.usefulness)
          .slice(0, 2))
          openEvidence(session, variant.id, step.id, artifact.id, now);
      answer(
        session,
        variant.id,
        step.id,
        step.exploration
          ? 'continue'
          : step.options.find((o) => step.rubric.scores[o.id] === 1)!.id,
        now,
        variant.generated?.responseChecks?.[step.id]?.accepted[0],
      );
    }
    assert.equal(session.result!.decision, 'CONFIRMED');
    service.save(session);
    const saved = structuredClone(session);
    const next = service.create('confirmed-owner', 'Senior', 'backend', now);
    assert.equal(next.state, 'active');
    assert.equal(next.targetGrade, 'Senior');
    assert.deepEqual(service.get(session.id, 'confirmed-owner', now), saved);
  } finally {
    store.close();
  }
});
function item(seed = 2) {
  return generateItem(pack, model, 'Middle', 'boundary', 'correctness', seed);
}
function inspect(i: GeneratedItem) {
  return validateGeneratedItem(
    i,
    getItemModel(i.specialization, i.generated.itemModelId),
    getPack(i.specialization),
  );
}
function respond(s: AssessmentSession, quality = 1) {
  const variant = s.items[s.cursor.item]!.variant;
  const step = variant.steps[s.cursor.step]!;
  const now = start + (s.responses.length + 1) * 30000;
  if (step.exploration) {
    for (const a of [...variant.artifacts].sort((a, b) => b.usefulness - a.usefulness).slice(0, 2))
      openEvidence(s, variant.id, step.id, a.id, now);
    answer(s, variant.id, step.id, 'continue', now);
  } else {
    const prior = s.contributions.filter((entry) => entry.dimension === step.rubric.dimension);
    const weight = prior.reduce((sum, entry) => sum + entry.weight, 0);
    const earned = prior.reduce((sum, entry) => sum + entry.value * entry.weight, 0);
    const distance = (id: string) =>
      Math.abs(
        (earned + step.rubric.scores[id]! * step.rubric.informationWeight) /
          (weight + step.rubric.informationWeight) -
          quality,
      );
    const selected = [...step.options].sort(
      (left, right) => distance(left.id) - distance(right.id),
    )[0]!;
    answer(
      s,
      variant.id,
      step.id,
      selected.id,
      now,
      variant.generated?.responseChecks?.[step.id]?.accepted[0],
    );
  }
}

test('same seed and generator/pack version reproduce the entire immutable item', () => {
  assert.deepEqual(item(42), item(42));
  assert.ok(Object.isFrozen(item(42)));
  assert.ok(Object.isFrozen(item(42).generated.worldState));
});
test('saved items reproduce with version guards, including pool provenance', () => {
  const saved = structuredClone(item(42));
  saved.generated.source = 'pool';
  assert.deepEqual(reproduceGeneratedItem(saved), saved);
  saved.generated.itemModelVersion = 'unknown';
  assert.throws(() => reproduceGeneratedItem(saved), /original.*versions/);
});
test('SRE selection preserves independent core and all boundary constructs under exposure', () => {
  const run = massGenerate('devops-sre', 'Middle', 30, 0, 71);
  assert.equal(run.report.generatedSessions, 30);
  assert.equal(run.report.validationFailed, 0);
  assert.equal(run.report.duplicateRate, 0);
});
test('different seeds change causal radicals and ground truth, not only presentation', () => {
  const variants = Array.from({ length: 32 }, (_, seed) => item(seed));
  assert.ok(new Set(variants.map((i) => i.generated.groundTruth.hazard)).size >= 3);
  assert.ok(new Set(variants.map((i) => i.generated.semanticFingerprint)).size >= 8);
  assert.notDeepEqual(item(1), item(2));
});
test('cache event evidence has a queue actor and renderer timings preserve measured latency', () => {
  const cache = getItemModel('backend', 'cache_inconsistency');
  const candidate = Array.from({ length: 32 }, (_, seed) =>
    generateItem(pack, cache, 'Middle', 'incident', 'diagnosis', seed),
  ).find((i) => i.generated.groundTruth.bestDiagnosticArtifact === 'queue')!;
  assert.ok(candidate.topology.nodes.some((n) => n.label === 'Queue'));
  assert.ok(candidate.artifacts.some((a) => a.id === 'queue'));
  const frontendPack = getPack('frontend');
  const performance = getItemModel('frontend', 'frontend_performance_regression');
  const slow = Array.from({ length: 32 }, (_, seed) =>
    generateItem(frontendPack, performance, 'Middle', 'incident', 'diagnosis', seed),
  ).find((i) => i.generated.groundTruth.hazard === 'main-thread-work')!;
  const trace = slow.artifacts.find((a) => a.id === 'trace')!.data as {
    spans: { node: string; durationMs: number }[];
  };
  assert.equal(trace.spans.find((s) => s.node === 'Renderer')!.durationMs, 700);
});
test('ground truth follows inequality and concurrency rules of WorldState', () => {
  const w = buildWorld(pack, model, 'Middle', 1);
  w.radicals.failure = {
    delivery: 'at_least_once',
    processingSeconds: 38,
    visibilitySeconds: 20,
    atomicDedup: false,
    crash: false,
    splitIdentity: false,
  };
  assert.equal(deriveGroundTruth(model, w).hazard, 'overlap');
  w.radicals.failure.processingSeconds = 12;
  w.radicals.failure.crash = true;
  assert.equal(deriveGroundTruth(model, w).hazard, 'crash-after-effect');
  assert.deepEqual(deriveGroundTruth(model, w), deriveGroundTruth(model, structuredClone(w)));
});
test('options are semantic intents and exactly one is valid for the current model', () => {
  for (let seed = 0; seed < 24; seed++) {
    const i = item(seed);
    const step = i.steps[0]!;
    const truth = i.generated.stepTruths[step.id]!;
    const w = i.generated.stepWorlds[step.id]!;
    assert.equal(
      i.generated.intents[step.id]!.filter((intent) => evaluateIntent(intent, w, truth) === 1)
        .length,
      1,
    );
    const shuffled = structuredClone(i);
    shuffled.steps[0]!.options.reverse();
    assert.deepEqual(inspect(shuffled), []);
    assert.deepEqual(shuffled.generated.groundTruth, i.generated.groundTruth);
  }
});
test('all packs and grades generate valid formal states and consistent artifacts', () => {
  for (const p of packs.filter((p) => p.enabled))
    for (const grade of ['Junior', 'Middle', 'Senior'] as const)
      for (let seed = 0; seed < 8; seed++) {
        const b = generateBlueprint(grade, seed, { specialization: p.id });
        for (const i of [...b.items, ...b.boundaryPool]) {
          assert.equal(i.targetGrade, grade);
          assert.deepEqual(inspect(i), []);
          assert.deepEqual(
            i.artifacts,
            generateArtifacts(
              getItemModel(p.id, i.generated.itemModelId),
              i.generated.worldState,
              i.generated.groundTruth,
            ),
          );
          assert.deepEqual(
            i.architecture,
            i.topology.nodes.map((n) => n.label),
          );
          if (grade === 'Junior') {
            assert.equal(i.generated.worldState.radicals.legacyClients, false);
            assert.equal(i.generated.worldState.radicals.rollbackRequired, false);
            assert.equal(i.generated.worldState.radicals.workers, 1);
          }
        }
      }
});
test('Senior rollout truth changes with writer/reader/rollback/replay radicals', () => {
  const m = getItemModel('backend', 'zero_downtime_migration');
  const variants = Array.from({ length: 32 }, (_, seed) =>
    generateItem(pack, m, 'Senior', 'anchors', 'engineering_judgment', seed),
  );
  const winners = variants.map((i) => {
    const s = i.steps[0]!;
    return s.options.find((o) => s.rubric.scores[o.id] === 1)!.text;
  });
  assert.ok(new Set(winners).size >= 4);
});
test('trace seconds are converted to milliseconds and refer to world topology nodes', () => {
  for (let seed = 0; seed < 16; seed++) {
    const i = item(seed);
    const trace = i.artifacts.find((a) => a.type === 'trace')!.data as {
      spans: { nodeId: string; node: string; durationMs: number }[];
    };
    const worker = trace.spans.find((s) => s.node.includes('Worker'))!;
    assert.equal(
      worker.durationMs,
      Number(i.generated.worldState.radicals.failure.processingSeconds) * 1000,
    );
    assert.ok(trace.spans.every((s) => i.topology.nodes.some((n) => n.id === s.nodeId)));
  }
});
test('constraint mutation has separately generated artifacts and known baseline', () => {
  const i = generateItem(
    pack,
    getItemModel('backend', 'db_lost_update'),
    'Middle',
    'review',
    'correctness',
    7,
  );
  assert.notDeepEqual(
    i.generated.stepWorlds.risk!.radicals.failure,
    i.generated.stepWorlds.adapt!.radicals.failure,
  );
  assert.notDeepEqual(i.generated.stepArtifacts.risk, i.generated.stepArtifacts.adapt);
  assert.ok(
    i.steps
      .find((s) => s.id === 'adapt')!
      .resetContext?.includes(i.generated.stepWorlds.adapt!.mutation!),
  );
});
test('semantic consistency rejects mismatching artifact content', () => {
  const i = structuredClone(item());
  i.artifacts[0]!.content = 'different topology';
  assert.ok(inspect(i).some((v) => v.gate === 'semantic_consistency'));
});
test('semantic consistency rejects text that does not render the world', () => {
  const i = structuredClone(item());
  i.steps[0]!.context += ' Другие workers и другие числа.';
  assert.ok(inspect(i).some((v) => v.gate === 'semantic_consistency'));
});
test('answer validity rejects two best answers even if both claim formal guarantees', () => {
  const i = structuredClone(item());
  const s = i.steps[0]!;
  const best = s.options.find((o) => s.rubric.scores[o.id] === 1)!;
  const other = s.options.find((o) => o.id !== best.id)!;
  i.generated.optionIntents[other.id] = i.generated.optionIntents[best.id]!;
  s.rubric.scores[other.id] = 1;
  other.text = best.text;
  assert.ok(inspect(i).some((v) => v.gate === 'answer_validity'));
  assert.ok(inspect(i).some((v) => v.gate === 'distractor_validity'));
});
test('missing assumptions, incompatible templates and grade mismatch are rejected', () => {
  const missing = structuredClone(item());
  missing.generated.worldState.assumptions = [];
  assert.ok(inspect(missing).some((v) => v.gate === 'content_validation'));
  const template = structuredClone(item());
  template.generated.templateIds.push('legacy-constraint');
  assert.ok(inspect(template).some((v) => v.gate === 'template_compatibility'));
  const grade = structuredClone(item());
  grade.generated.worldState.radicals.workers = 24;
  assert.ok(inspect(grade).some((v) => v.gate === 'difficulty_validation'));
  const junior = buildWorld(
    pack,
    getItemModel('backend', 'api_backward_compatibility'),
    'Junior',
    1,
  );
  assert.equal(
    templateCompatible(
      templateBlocks.find((t) => t.id === 'legacy-constraint')!,
      junior,
    ),
    false,
  );
});
test('option balance rejects a conspicuously long correct option', () => {
  const i = structuredClone(item());
  const s = i.steps[0]!;
  const best = s.options.find((o) => s.rubric.scores[o.id] === 1)!;
  best.text += ' Проверить атомарность и надёжность. '.repeat(30);
  assert.ok(inspect(i).some((v) => v.gate === 'option_balance'));
});
test('exposure penalty is higher for an overused model and recent candidate usage', () => {
  const b = generateBlueprint('Middle', 1);
  const exposure: ExposureRecord[] = [];
  observeGeneratedItems(b.items, exposure, 'first', 'user');
  const used = getItemModel('backend', b.items[0]!.generated.itemModelId);
  assert.ok(
    modelExposurePenalty(used, exposure, 'user') > modelExposurePenalty(used, exposure, 'other'),
  );
  assert.ok(
    modelExposurePenalty(used, exposure, 'other') > modelExposurePenalty(used, [], 'other'),
  );
});
test('models rotate, avoid recent candidate anchors and never repeat siblings in core', () => {
  const first = generateBlueprint('Middle', 4, { userId: 'same' });
  const exposure: ExposureRecord[] = [];
  observeGeneratedItems(first.items, exposure, 'first', 'same');
  const second = generateBlueprint('Middle', 4, { userId: 'same', exposure });
  assert.notDeepEqual(
    first.items.map((i) => i.generated.itemModelId),
    second.items.map((i) => i.generated.itemModelId),
  );
  const recent = new Set(first.items.map((i) => i.generated.itemModelId));
  assert.ok(second.items.slice(0, 4).every((i) => !recent.has(i.generated.itemModelId)));
  assert.equal(new Set(second.items.map((i) => i.generated.siblingGroup)).size, 6);
  assert.deepEqual(second, generateBlueprint('Middle', 4, { userId: 'same', exposure }));
});
test('validated generated pools serve matching grades and dimensions', () => {
  const pool = validatedFallbackPool('frontend', 'Middle');
  assert.ok(pool.length > 20);
  const b = generateBlueprint('Middle', 16, { specialization: 'frontend', pool });
  assert.ok(b.items.every((i) => i.generated.source === 'pool'));
  assert.ok(
    b.boundaryPool.every(
      (i) => i.steps[0]!.rubric.informationWeight >= 2 && i.targetGrade === 'Middle',
    ),
  );
});
test('runtime generation failure falls back to previously validated snapshots', () => {
  const pool = validatedFallbackPool('backend', 'Middle');
  assert.ok(pool.every((i) => i.generated.validation.passed));
  const original = pack.itemModels.map((m) => m.code);
  try {
    for (const m of pack.itemModels)
      m.code = () => {
        throw new Error('injected renderer failure');
      };
    const program = generateBlueprint('Middle', 21, { fallbackItems: pool });
    assert.ok(
      program.items.every(
        (i) =>
          i.generated.source === 'fallback' &&
          i.targetGrade === 'Middle' &&
          i.generated.validation.passed,
      ),
    );
  } finally {
    pack.itemModels.forEach((m, i) => {
      m.code = original[i]!;
    });
  }
});
test('100 Backend Middle sessions and 1000 generated items pass mass quality and rotation checks', () => {
  const result = massGenerate('backend', 'Middle', 100, 1000);
  assert.equal(result.report.generatedSessions, 100);
  assert.equal(result.report.generated, 1000);
  assert.equal(result.report.validationFailed, 0);
  assert.equal(result.report.duplicateRate, 0);
  for (const [id, count] of Object.entries(result.report.exposureDistribution)) {
    const current = pack.itemModels.find((model) => model.id === id)!;
    const alternatives = pack.itemModels.filter(
      (model) =>
        model.gradeRange?.includes('Middle') && model.competencyDomain === current.competencyDomain,
    );
    assert.ok(count <= 100);
    if (alternatives.length > 1) assert.ok(count < 100, `${id}: no rotation within its domain`);
  }
  assert.equal(Object.keys(result.report.itemModelDistribution).length, pack.itemModels.length);
});
test('new runtime preserves core, immutable target grade, timeout and candidate secrecy', () => {
  for (const specialization of ['backend', 'frontend', 'devops-sre']) {
    const s = createSession(
      'generated',
      'user',
      'Middle',
      'secret-seed-128',
      start,
      undefined,
      undefined,
      { specialization },
    );
    const coreSteps = s.items.reduce((sum, item) => sum + item.variant.steps.length, 0);
    for (let i = 0; i < coreSteps - 1; i++) {
      respond(s);
      assert.equal(s.state, 'active');
      assert.equal(coreCompleted(s), false);
    }
    respond(s);
    assert.equal(coreCompleted(s), true);
    assert.equal(s.result!.decision, 'CONFIRMED');
    assert.equal(s.result!.targetGrade, 'Middle');
    const publicView = JSON.stringify(publicSession(s));
    for (const key of [
      'groundTruth',
      'assessmentVersion',
      'familyVersion',
      'generatorVersion',
      'packVersion',
      'scoringVersion',
      'estimatedScore',
      'lowerBound',
      'variantSeed',
      'misconception',
      'familyId',
      'itemModelId',
      'expertRatings',
    ])
      assert.equal(publicView.includes(key), false, key);
  }
  const timed = createSession('timeout', 'user', 'Senior', 1, start);
  expireSession(timed, start + 1200000);
  assert.equal(timed.result!.decision, 'NOT_CONFIRMED');
  assert.equal(timed.targetGrade, 'Senior');
});
test('candidate current API view hides all ground truth, intent and scoring fields', () => {
  const s = createSession('current', 'user', 'Middle', 8, start);
  const view = JSON.stringify(publicSession(s));
  for (const key of [
    'groundTruth',
    'assessmentVersion',
    'familyVersion',
    'generatorVersion',
    'packVersion',
    'generated',
    'worldState',
    'radicals',
    'seed',
    'misconception',
    'scores',
    'rubric',
    'optionIntents',
  ])
    assert.equal(view.includes(`"${key}"`), false, key);
  assert.equal(publicSession(s).current!.architecture.length, 0);
});
test('correct and incorrect boundary observations reduce relevant uncertainty; unrelated ones do not', () => {
  const s = createSession('boundary', 'user', 'Middle', 3, start);
  while (!coreCompleted(s)) respond(s, 0.65);
  assert.equal(s.items.at(-1)!.stage, 'boundary');
  const target = s.items.at(-1)!.variant.steps[0]!.rubric.dimension;
  const before = evaluateEvidence(s).dimensions.find((d) => d.dimension === target)!;
  const yes = structuredClone(s),
    no = structuredClone(s);
  respond(yes, 1);
  respond(no, 0);
  const strong = evaluateEvidence(yes).dimensions.find((d) => d.dimension === target)!;
  const weak = evaluateEvidence(no).dimensions.find((d) => d.dimension === target)!;
  assert.ok(strong.margin < before.margin);
  assert.ok(weak.margin < before.margin);
  assert.ok(strong.score > weak.score);
  const unrelated = structuredClone(s);
  unrelated.items[unrelated.cursor.item]!.variant = structuredClone(
    s.boundaryPool.find((i) => i.steps[0]!.rubric.dimension !== target)!,
  );
  respond(unrelated, 1);
  assert.equal(
    evaluateEvidence(unrelated).dimensions.find((d) => d.dimension === target)!.margin,
    before.margin,
  );
});
test('exposure is saved for presented items once, and snapshots survive storage reload', () => {
  const store = new Store(':memory:');
  try {
    const service = new AdaptiveService(store);
    const created = service.create('owner', 'Middle', 'frontend', start);
    const session = service.get(created.id, 'owner', start)!;
    assert.equal(typeof session.seed, 'string');
    assert.equal(String(session.seed).length, 32);
    assert.equal(store.list('item-exposures').length, 1);
    service.recordExposure(session, start);
    assert.equal(store.list('item-exposures').length, 1);
    respond(session);
    service.save(session);
    service.recordExposure(session, start + 1000);
    assert.equal(store.list('item-exposures').length, 2);
    assert.deepEqual(service.get(session.id, 'owner', start + 1000)!.items, session.items);
  } finally {
    store.close();
  }
});
test('candidate endpoints redact internals; evaluator and profile bridge enforce authorization', async () => {
  const store = new Store(':memory:');
  const candidate = store.createUser(
    'generator@example.test',
    'Password2026!',
    'Candidate',
    'candidate',
    true,
  );
  const admin = store.createUser(
    'evaluator@example.test',
    'Password2026!',
    'Evaluator',
    'admin',
    true,
  );
  const other = store.createUser(
    'other-generator@example.test',
    'Password2026!',
    'Other',
    'candidate',
    true,
  );
  const secret = 'test-only-bridge-secret';
  const { server } = createApplication(store, {
    development: true,
    dataDir: 'data',
    bridgeSecret: secret,
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const cookie = `sid=${store.session(candidate)}`,
    adminCookie = `sid=${store.session(admin)}`,
    otherCookie = `sid=${store.session(other)}`;
  const api = async (path: string, sessionCookie = cookie, signature?: string) => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api${path}`, {
      headers: {
        cookie: sessionCookie,
        ...(signature ? { 'X-Assessment-Bridge': signature } : {}),
      },
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  };
  try {
    const service = new AdaptiveService(store);
    const view = service.create(candidate.id, 'Middle', 'frontend', start);
    const s = store.get<AssessmentSession>('adaptive-sessions', view.id)!;
    while (s.state === 'active') respond(s);
    service.save(s);
    const candidateView = await api(`/adaptive-sessions/${s.id}`);
    assert.equal(candidateView.status, 200);
    const text = JSON.stringify(candidateView.body);
    for (const field of [
      'groundTruth',
      'seed',
      'band',
      'estimatedScore',
      'scoringConfigVersion',
      'itemModelId',
      'scores',
    ])
      assert.equal(text.includes(`"${field}"`), false);
    assert.equal((await api(`/admin/adaptive-sessions/${s.id}`)).status, 403);
    assert.equal((await api(`/admin/adaptive-sessions/${s.id}/export`)).status, 403);
    assert.equal((await api(`/adaptive-sessions/${s.id}`, otherCookie)).status, 404);
    assert.equal((await api(`/adaptive-sessions/${s.id}/profile-result`)).status, 403);
    const signature = createHmac('sha256', secret).update(s.id).digest('hex');
    assert.equal(
      (await api(`/adaptive-sessions/${s.id}/profile-result`, cookie, signature)).status,
      200,
    );
    const debug = await api(`/admin/adaptive-sessions/${s.id}`, adminCookie);
    assert.equal(debug.status, 200);
    assert.ok(JSON.stringify(debug.body).includes('groundTruth'));
    const pilot = await api(`/admin/adaptive-sessions/${s.id}/export`, adminCookie);
    assert.equal(pilot.status, 200);
    assert.equal(pilot.body.format, 'assessment-expert-pilot-1');
    assert.equal(pilot.body.candidate, candidate.id);
    assert.equal(pilot.body.declaredGrade, 'Middle');
    assert.equal(pilot.body.expertAssessment, null);
    const telemetry = await api(`/adaptive-sessions/${s.id}/telemetry`);
    assert.equal(telemetry.status, 200);
    assert.equal(JSON.stringify(telemetry.body).includes('variantSeed'), false);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

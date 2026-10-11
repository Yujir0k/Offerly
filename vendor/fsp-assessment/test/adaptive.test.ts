import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  answer,
  coreCompleted,
  createSession,
  evaluateEvidence,
  expireSession,
  openEvidence,
  publicSession,
  sessionTelemetry,
} from '../src/adaptive/engine.js';
import { backendDefinition, generateVariant } from '../src/adaptive/bank.js';
import { gradeConfigs } from '../src/adaptive/config.js';
import { dimensions, type AssessmentSession, type TargetGrade } from '../src/adaptive/model.js';
import { AdaptiveService } from '../src/adaptive/service.js';
import { Store } from '../src/store.js';
import { createApplication } from '../src/server.js';
import { confirmationTitle } from '../offerly-web/lib/adaptive-presentation.js';
import { simulateAssessment, validationReport } from '../src/adaptive/validation.js';

const start = Date.parse('2026-10-06T08:00:00Z');
function make(grade: TargetGrade = 'Middle', seed = 17) {
  return createSession('test-session', 'candidate', grade, seed, start, backendDefinition);
}
function respond(s: AssessmentSession, quality = 1, now = start + 1000) {
  const item = s.items[s.cursor.item]!.variant;
  const step = item.steps[s.cursor.step]!;
  if (step.exploration) {
    const artifacts = [...item.artifacts].sort((a, b) => b.usefulness - a.usefulness);
    for (const a of artifacts.slice(0, 2)) openEvidence(s, item.id, step.id, a.id, now);
    answer(s, item.id, step.id, 'continue', now);
  } else {
    const option = step.options.find((o) => step.rubric.scores[o.id] === quality)!;
    answer(
      s,
      item.id,
      step.id,
      option.id,
      now,
      item.generated?.responseChecks?.[step.id]?.accepted[0],
    );
  }
}
function finish(s: AssessmentSession, quality = 1) {
  let i = 0;
  while (s.state === 'active') respond(s, quality, start + ++i * 50000);
  return s;
}

test('bank has 8 anchors, 3 incidents, 3 reviews and 8 boundary families per grade', () => {
  for (const grade of ['Junior', 'Middle', 'Senior']) {
    const families = backendDefinition.families.filter((f) => f.targetGrade === grade);
    for (const [stage, count] of [
      ['anchors', 8],
      ['incident', 3],
      ['review', 3],
      ['boundary', 8],
    ] as const)
      assert.equal(families.filter((f) => f.stage === stage).length, count);
    assert.deepEqual(
      new Set(
        families.filter((f) => f.stage === 'boundary').map((f) => f.steps[0]!.rubric.dimension),
      ),
      new Set(dimensions),
    );
    for (const f of families) {
      assert.ok(f.approved && f.measuredConstruct && f.expertCalibration.status === 'provisional');
      for (const s of f.steps)
        if (!s.exploration) assert.equal(new Set(Object.values(s.rubric.scores)).size, 4);
    }
  }
});
test('grade immutable for successful and failed attempts, without automatic reassignment', () => {
  for (const grade of ['Junior', 'Middle', 'Senior'] as const)
    for (const quality of [0, 1]) {
      const s = finish(make(grade), quality);
      assert.equal(s.targetGrade, grade);
      assert.equal(s.result!.targetGrade, grade);
      assert.equal(
        s.result!.title,
        `${grade.toUpperCase()} ${quality ? 'CONFIRMED' : 'NOT CONFIRMED'}`,
      );
      assert.equal(s.result!.decision, quality ? 'CONFIRMED' : 'NOT_CONFIRMED');
    }
});
test('result presentation never assigns its optional recommendation', () => {
  for (const grade of ['Junior', 'Middle', 'Senior'] as const) {
    assert.equal(confirmationTitle(grade, true), `${grade.toUpperCase()} CONFIRMED`);
    assert.equal(confirmationTitle(grade, false), `${grade.toUpperCase()} ПОКА НЕ ПОДТВЕРЖДЁН`);
  }
});
test('validation labels simulation honestly and cannot fabricate expert agreement', () => {
  const observations = simulateAssessment(2);
  assert.equal(observations.length, 30);
  const report = validationReport(observations, 'simulation');
  assert.match(report.label, /SIMULATION/);
  assert.equal(report.expertAgreement.rate, null);
  assert.equal(report.resultStabilityAndGradeSeparation.length, 15);
  assert.equal(report.dimensionCoverage.length, 4);
  assert.ok(report.durationMinutes.max! <= 20);
  assert.deepEqual(observations, simulateAssessment(2));
  const observed = validationReport(
    [{ ...observations[0]!, expertDecision: observations[0]!.decision! }],
    'observed',
  );
  assert.equal(observed.expertAgreement.rate, 1);
});
test('mutating the source bank cannot change an already-issued rubric snapshot', () => {
  const definition = structuredClone(backendDefinition);
  const session = createSession('snapshot', 'candidate', 'Middle', 42, start, definition);
  for (const family of definition.families)
    for (const step of family.steps) {
      step.rubric.scores = Object.fromEntries(Object.keys(step.rubric.scores).map((id) => [id, 0]));
      step.rubric.rationale = 'Changed after issuance';
    }
  finish(session);
  assert.equal(session.result!.decision, 'CONFIRMED');
  assert.ok(
    session
      .result!.dimensions.flatMap((d) => d.evidence)
      .every((e) => !e.explanation.includes('Changed after issuance')),
  );
});
test('no early stop before all mandatory blocks, balanced anchor dimensions and independent review', () => {
  for (let seed = 0; seed < 32; seed++) {
    const s = make('Middle', seed);
    assert.deepEqual(
      new Set(s.items.slice(0, 4).map((i) => i.variant.steps[0]!.rubric.dimension)),
      new Set(dimensions),
    );
    const incident = s.items[4]!.variant;
    const review = s.items[5]!.variant;
    assert.equal(
      incident.contentTags.some((t) => review.contentTags.includes(t)),
      false,
    );
    for (let i = 0; i < 11; i++) {
      respond(s);
      assert.equal(s.state, 'active');
      assert.equal(s.result, null);
      assert.equal(coreCompleted(s), false);
    }
    respond(s);
    assert.equal(coreCompleted(s), true);
    assert.equal(s.state, 'completed');
  }
});
test('boundary chooses the most uncertain dimension and is used only after core', () => {
  const s = make();
  while (!coreCompleted(s)) respond(s, 0.65);
  assert.equal(s.items.at(-1)!.stage, 'boundary');
  const evidence = evaluateEvidence(s);
  const mostUncertain = [...evidence.dimensions].sort(
    (a, b) =>
      b.margin - a.margin ||
      a.effectiveEvidence - b.effectiveEvidence ||
      dimensions.indexOf(a.dimension) - dimensions.indexOf(b.dimension),
  )[0]!;
  assert.equal(s.items.at(-1)!.variant.steps[0]!.rubric.dimension, mostUncertain.dimension);
  finish(s, 0.65);
  assert.ok(s.items.filter((i) => i.stage === 'boundary').length <= 3);
  assert.equal(s.result!.stopReason, 'boundary_exhausted');
  assert.equal(s.result!.decision, 'NOT_CONFIRMED');
});
test('hard cap rejects late responses and insufficient timeout never confirms', () => {
  const s = make();
  respond(s);
  respond(s);
  const item = s.items[s.cursor.item]!.variant;
  const step = item.steps[0]!;
  assert.throws(
    () => answer(s, item.id, step.id, step.options[0]!.id, start + 1200000),
    /завершена/,
  );
  assert.equal(s.responses.length, 2);
  assert.equal(s.result!.decision, 'NOT_CONFIRMED');
  assert.equal(s.finishedAt, new Date(start + 1200000).toISOString());
  assert.equal(s.result!.stopReason, 'timeout');
  assert.equal(expireSession(s, start + 1200001), false);
});
test('timeout while boundary is unresolved conservatively rejects certification', () => {
  const s = make();
  while (!coreCompleted(s)) respond(s, 0.65);
  expireSession(s, start + 1200000);
  assert.equal(s.result!.decision, 'NOT_CONFIRMED');
  assert.equal(s.result!.stopReason, 'timeout');
});
test('deterministic variants and seeds produce distinct artifacts/parameters/answer ordering', () => {
  const f = backendDefinition.families.find((f) => f.stage === 'incident')!;
  assert.deepEqual(generateVariant(f, 42), generateVariant(f, 42));
  assert.notDeepEqual(generateVariant(f, 42), generateVariant(f, 43));
  assert.deepEqual(make('Middle', 123).items, make('Middle', 123).items);
  assert.notDeepEqual(make('Middle', 123).items, make('Middle', 124).items);
});
test('reproducible scoring is independent of response speed', () => {
  const a = make();
  const b = make();
  while (a.state === 'active') {
    respond(a, 0.65, start + (a.responses.length + 1) * 30000);
    respond(b, 0.65, start + (b.responses.length + 1) * 60000);
  }
  assert.deepEqual(a.result, b.result);
  assert.deepEqual(a.contributions, b.contributions);
  assert.notEqual(sessionTelemetry(a).totalTimeMs, sessionTelemetry(b).totalTimeMs);
});
test('frozen config and bank remain valid across revisions and serialized reload', () => {
  const s = make();
  const saved = JSON.parse(JSON.stringify(s)) as AssessmentSession;
  const oldCut = gradeConfigs.Middle.cutScore;
  const oldVersion = gradeConfigs.Middle.version;
  const oldScoringVersion = gradeConfigs.Middle.scoringVersion;
  try {
    gradeConfigs.Middle.cutScore = 0.99;
    gradeConfigs.Middle.version = 'middle-2';
    gradeConfigs.Middle.scoringVersion = 'evidence-2';
    assert.equal(make().config.version, 'middle-2');
    assert.equal(saved.config.cutScore, oldCut);
    finish(saved);
    assert.equal(saved.result!.decision, 'CONFIRMED');
    assert.equal(saved.result!.gradeConfigVersion, 'middle-1');
    assert.equal(saved.result!.scoringConfigVersion, 'evidence-1');
  } finally {
    gradeConfigs.Middle.cutScore = oldCut;
    gradeConfigs.Middle.version = oldVersion;
    gradeConfigs.Middle.scoringVersion = oldScoringVersion;
  }
  assert.deepEqual(finish(s).result, saved.result);
});
test('wrong cause/risk does not cascade into remediation/adaptation scoring', () => {
  const s = make();
  while (s.state === 'active') {
    const step = s.items[s.cursor.item]!.variant.steps[s.cursor.step]!;
    if (step.id === 'remediate' || step.id === 'fix' || step.id === 'adapt')
      assert.ok(publicSession(s).current!.step.resetContext);
    respond(s, step.id === 'cause' || step.id === 'risk' ? 0 : 1);
  }
  for (const response of s.responses.filter((r) =>
    ['remediate', 'fix', 'adapt'].includes(r.stepId),
  ))
    assert.equal(response.contributions[0]!.value, 1);
});
test('evidence ordering/timestamps are persisted and later good choices cannot repair first two', () => {
  const s = make();
  while (!s.items[s.cursor.item]!.variant.steps[s.cursor.step]!.exploration) respond(s);
  const item = s.items[s.cursor.item]!.variant;
  const step = item.steps[s.cursor.step]!;
  const artifacts = [...item.artifacts].sort((a, b) => a.usefulness - b.usefulness);
  artifacts.forEach((a, i) => openEvidence(s, item.id, step.id, a.id, start + 10000 + i * 1000));
  openEvidence(s, item.id, step.id, artifacts[0]!.id, start + 20000);
  assert.deepEqual(
    s.evidenceSelections.map((e) => e.order),
    [1, 2, 3, 4, 5],
  );
  assert.equal(s.evidenceSelections[1]!.at, new Date(start + 11000).toISOString());
  answer(s, item.id, step.id, 'continue', start + 21000);
  assert.equal(
    s.responses.at(-1)!.contributions[0]!.value,
    artifacts[0]!.usefulness * 0.6 + artifacts[1]!.usefulness * 0.4,
  );
});
test('public view hides rubric, future items, answer rank and unopened evidence', () => {
  const s = make();
  const view = publicSession(s);
  assert.equal('rubric' in view.current!.step, false);
  for (const hidden of ['contributions', 'seed', 'boundaryPool', 'config', 'items'])
    assert.equal(hidden in view, false);
  assert.ok(view.current!.step.options.every((o) => !/-o[0-3]$/.test(o.id)));
  while (!s.items[s.cursor.item]!.variant.steps[s.cursor.step]!.exploration) respond(s);
  assert.ok(publicSession(s).current!.artifacts.every((a) => a.content === null));
});
test('persistence survives DB reopen and server sweep finishes sessions without an open browser', () => {
  const directory = mkdtempSync(join(tmpdir(), 'fsp-adaptive-'));
  let store = new Store(join(directory, 'test.sqlite'));
  try {
    const s = make();
    respond(s);
    new AdaptiveService(store).save(s);
    store.close();
    store = new Store(join(directory, 'test.sqlite'));
    const service = new AdaptiveService(store);
    assert.deepEqual(service.get(s.id, s.candidateId, start + 1000)!.responses, s.responses);
    service.sweep(start + 1200001);
    assert.equal(
      store.get<AssessmentSession>('adaptive-sessions', s.id)!.result!.stopReason,
      'timeout',
    );
  } finally {
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
test('API owns sessions, persists answers/results, and exposes only owner telemetry', async () => {
  const store = new Store(':memory:');
  const user = store.createUser(
    'adaptive@example.org',
    'Password2026!',
    'Candidate',
    'candidate',
    true,
  );
  const other = store.createUser('other@example.org', 'Password2026!', 'Other', 'candidate', true);
  const employer = store.createUser(
    'employer@example.org',
    'Password2026!',
    'Employer',
    'employer',
    true,
  );
  const { server } = createApplication(store, { development: true, dataDir: 'data' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const cookies = [user, other, employer].map((u) => `sid=${store.session(u)}`);
  async function call(path: string, method = 'GET', data?: unknown, cookie = cookies[0]) {
    const response = await fetch(
      `http://127.0.0.1:${(address as { port: number }).port}/api${path}`,
      {
        method,
        headers: { cookie: cookie!, 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
        ...(data ? { body: JSON.stringify(data) } : {}),
      },
    );
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  try {
    assert.equal(
      (
        await call('/adaptive-sessions', 'POST', {
          targetGrade: 'Middle',
          specialization: 'data-ml',
        })
      ).status,
      400,
    );
    const created = await call('/adaptive-sessions', 'POST', {
      targetGrade: 'Middle',
      specialization: 'backend',
    });
    assert.equal(created.status, 201);
    const id = String(created.body.id);
    assert.equal((await call(`/adaptive-sessions/${id}/telemetry`)).status, 409);
    assert.equal(
      (await call(`/adaptive-sessions/${id}`, 'GET', undefined, cookies[1])).status,
      404,
    );
    assert.equal(
      (await call(`/adaptive-sessions/${id}/telemetry`, 'GET', undefined, cookies[1])).status,
      404,
    );
    assert.equal(
      (await call(`/adaptive-sessions/${id}`, 'GET', undefined, cookies[2])).status,
      403,
    );
    assert.equal(
      (
        await call('/adaptive-sessions', 'POST', {
          targetGrade: 'Junior',
          specialization: 'backend',
        })
      ).status,
      400,
    );
    while (store.get<AssessmentSession>('adaptive-sessions', id)!.state === 'active') {
      const s = store.get<AssessmentSession>('adaptive-sessions', id)!;
      const item = s.items[s.cursor.item]!.variant;
      const step = item.steps[s.cursor.step]!;
      if (step.exploration)
        for (const a of [...item.artifacts].sort((a, b) => b.usefulness - a.usefulness).slice(0, 2))
          assert.equal(
            (
              await call(`/adaptive-sessions/${id}/evidence`, 'POST', {
                itemId: item.id,
                stepId: step.id,
                artifactId: a.id,
              })
            ).status,
            200,
          );
      const optionId = step.exploration
        ? 'continue'
        : step.options.find((o) => step.rubric.scores[o.id] === 1)!.id;
      assert.equal(
        (
          await call(`/adaptive-sessions/${id}/answer`, 'POST', {
            itemId: item.id,
            stepId: step.id,
            optionId,
            execution: item.generated?.responseChecks?.[step.id]?.accepted[0],
          })
        ).status,
        200,
      );
    }
    const result = (await call(`/adaptive-sessions/${id}`)).body.result as { title: string };
    assert.equal(result.title, 'MIDDLE CONFIRMED');
    assert.equal(
      ((await call(`/adaptive-sessions/${id}/telemetry`)).body.responses as unknown[]).length,
      store.get<AssessmentSession>('adaptive-sessions', id)!.responses.length,
    );
    const candidates = await call('/candidates', 'GET', undefined, cookies[2]);
    assert.equal(candidates.status, 200);
    const found = (
      candidates.body as unknown as { id: string; categories: { grade: string }[] }[]
    ).find((c) => c.id === user.id)!;
    assert.ok(found);
    assert.equal(found.categories[0]!.grade, 'Middle');
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

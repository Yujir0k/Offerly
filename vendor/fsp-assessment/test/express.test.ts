import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  expressVariant,
  generateExpressVariant,
  expressExperiment,
  evaluateExpress,
  expressRetryAt,
  simulateExpressFailover,
} from '../src/express.js';
import { generateVariant, publicVariant, variantFingerprint } from '../src/generator.js';
import { engineeringDiagnostic, recordAudit } from '../src/engineering.js';
import { families } from '../src/families/registry.js';
import { createApplication } from '../src/server.js';
import { Store } from '../src/store.js';
import { sessionResult } from '../src/session.js';
import { initialState, rank } from '../offerly-web/lib/model.js';
import type { Assessment, Grade, SessionView, Variant } from '../src/domain.js';

function sample(grade: Grade, variant = generateExpressVariant('backend', grade, [])): Assessment {
  return {
    id: 'express',
    candidateId: 'candidate',
    needId: null,
    variant,
    stage: 0,
    state: 'active',
    experiments: [],
    answers: {},
    recommendation: '',
    createdAt: '2026-10-06T12:00:00Z',
    submittedAt: null,
    result: null,
  };
}
function finish(item: Assessment) {
  const spec = item.variant.engineering!.express!;
  recordAudit(item, item.variant.oracle.engineering!.defects);
  item.answers = { ...item.variant.oracle.answers };
  item.experiments.push(
    expressExperiment(item, 2, 'strategy-a', 'adapt-a'),
    expressExperiment(item, 1, 'strategy-a'),
  );
  assert.ok(spec.strategies.some((choice) => choice.id === 'strategy-a'));
  item.result = evaluateExpress(item);
  item.state = 'submitted';
  item.submittedAt = '2026-10-06T12:00:00.000Z';
  return item;
}

test('express variants have two grade-specific questions, exactly four defect categories and bundled decisions', () => {
  for (const grade of ['Junior', 'Middle', 'Senior'] as Grade[]) {
    const item = finish(sample(grade));
    assert.equal(item.variant.questions.length, 2);
    assert.equal(item.variant.engineering!.defectTypes.length, 4);
    assert.ok(item.variant.engineering!.express!.strategies.length >= 2);
    assert.ok(item.variant.engineering!.express!.strategies.length <= 3);
    assert.equal(item.result!.score, 100);
    assert.equal(
      item.result!.proposedGrade,
      grade,
      'a perfect test confirms only the claimed level',
    );
    assert.ok(item.experiments.every((report) => Object.values(report.checks).every(Boolean)));
    assert.equal(JSON.stringify(publicVariant(item.variant)).includes('"oracle"'), false);
    if (grade !== 'Junior') {
      assert.equal(item.variant.lab!.data.parameters.externalEffect, true);
      assert.equal(item.variant.lab!.data.parameters.globalIds, false);
      assert.equal(item.variant.oracle.engineering!.defects.isolation, 'isolation');
    }
    if (grade === 'Senior') assert.ok(item.variant.oracle.engineering!.defects.delivery);
  }
});
test('express generation rejects substantive repeats and replays the same seed deterministically', () => {
  const prior: Variant[] = [];
  for (const grade of ['Junior', 'Middle', 'Senior'] as Grade[])
    for (let index = 0; index < 8; index++) {
      const variant = generateExpressVariant('backend', grade, prior);
      assert.ok(!prior.some((old) => variantFingerprint(old) === variantFingerprint(variant)));
      const reproduced = expressVariant(
        generateVariant('backend', grade, variant.seed, 'docs', variant.familyId),
      );
      assert.deepEqual(variant.questions, reproduced.questions);
      assert.deepEqual(variant.engineering, reproduced.engineering);
      prior.push(variant);
    }
});
test('every specialization retains locally valid express fixtures at each grade', () => {
  for (const family of families)
    for (const grade of ['Junior', 'Middle', 'Senior'] as Grade[]) {
      const item = finish(
        sample(
          grade,
          expressVariant(generateVariant(family.trackId, grade, 14, 'docs', family.id)),
        ),
      );
      assert.equal(item.result!.score, 100, `${family.id}/${grade}`);
    }
});
test('Junior request validation and Senior failover are sensitive to invalid adaptation', () => {
  const junior = sample('Junior');
  const invalid = expressExperiment(junior, 2, 'strategy-a', 'adapt-b');
  assert.equal(invalid.checks.emptyBodyRejected, false);
  assert.equal(invalid.checks.malformedParameterRejected, false);
  assert.equal(invalid.checks.validRequestCommitted, true);
  const senior = sample('Senior');
  const split = expressExperiment(senior, 2, 'strategy-a', 'adapt-b');
  assert.equal(split.checks.singleWriterAfterFailover, false);
  assert.equal(split.checks.zeroLostAcceptedOperations, false);
  assert.ok(split.trace!.some((line) => line.includes('epoch=1')));
  assert.deepEqual(simulateExpressFailover('fenced', 17).checks, {
    singleWriterAfterFailover: true,
    zeroLostAcceptedOperations: true,
  });
  assert.deepEqual(simulateExpressFailover('degraded', 17).checks, {
    singleWriterAfterFailover: true,
    zeroLostAcceptedOperations: true,
  });
});
test('the 70% boundary confirms only the claim and diagnostics never change points', () => {
  const item = finish(sample('Middle'));
  recordAudit(item, {}); // zero audit; perfect remaining stages -> exactly 70
  assert.equal(evaluateExpress(item).score, 70);
  assert.equal(evaluateExpress(item).proposedGrade, 'Middle');
  engineeringDiagnostic(item, 'isolation', 'logs', 'Логи');
  engineeringDiagnostic(item, 'isolation', 'metrics', 'Метрики');
  assert.equal(evaluateExpress(item).score, 70);
  assert.ok(item.engineeringProgress!.diagnostics[0]!.text.includes('[WARN]'));
  item.answers = {};
  assert.equal(evaluateExpress(item).score, 50);
  assert.equal(evaluateExpress(item).proposedGrade, null);
  assert.equal(evaluateExpress(item).status, 'not_confirmed');
});
test('one express case completes a session; a failure schedules only the same track and grade', () => {
  const item = finish(sample('Middle'));
  const session: SessionView = {
    id: 's',
    candidateId: item.candidateId,
    trackId: 'backend',
    grade: 'Middle',
    needId: null,
    assessmentIds: [item.id],
    createdAt: item.createdAt,
    state: 'submitted',
    format: 'express-v1',
    assessments: [item],
  };
  assert.equal(sessionResult(session, [item])!.proposedGrade, 'Middle');
  assert.equal(sessionResult({ ...session, needId: 'company' }, [item])!.proposedGrade, null);
  assert.equal(expressRetryAt([item], 'backend', 'Middle'), null);
  item.answers = {};
  recordAudit(item, {});
  item.result = evaluateExpress(item);
  assert.equal(expressRetryAt([item], 'backend', 'Middle'), '2026-11-05T12:00:00.000Z');
  assert.equal(expressRetryAt([item], 'backend', 'Junior'), null);
  assert.equal(expressRetryAt([item], 'data', 'Middle'), null);
});
test('FSP absence is neutral, modeled achievements boost matching by 20%, failed claims reduce ranking', () => {
  const state = initialState();
  const need = state.needs[0]!;
  const neutral = { ...state.profile, fsp: null, fspVerification: null, score: 0, verified: [] };
  const base = rank(neutral, need).score;
  assert.equal(rank({ ...neutral, fsp: 'unverified-id' }, need).score, base);
  const modeled = {
    ...neutral,
    fsp: 'FSP-DEMO-1042',
    fspVerification: {
      id: 'FSP-DEMO-1042',
      verified: false,
      modeled: true,
      competition: 'Призёр ФСП',
    },
  };
  assert.equal(rank(modeled, need).score, Math.round(base * 1.2));
  const confirmation = {
    status: 'not_confirmed' as const,
    claimed: 'Middle',
    specialty: 'Backend',
    sessionId: 's',
    at: '',
    score: 50,
    retryAt: '',
  };
  assert.ok(rank({ ...neutral, confirmation }, need).score < base);
  assert.ok(
    rank({ ...neutral, confirmation }, need).reasons.some((reason) =>
      reason.includes('не подтверждён'),
    ),
  );
});
test('express API is local even with live LLM enabled, preserves old sessions and enforces 30-day retry', async (context) => {
  const store = new Store(':memory:');
  const user = store.createUser(
    'express@test.local',
    'Password2026!',
    'Candidate',
    'candidate',
    true,
  );
  const app = createApplication(store, { development: true, dataDir: 'data' });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const nativeFetch = globalThis.fetch;
  const calls: string[] = [];
  context.mock.method(
    globalThis,
    'fetch',
    async (url: string | URL | Request, options?: RequestInit) => {
      const target = String(url);
      calls.push(target);
      assert.ok(target.startsWith(base), 'express must never call an external provider');
      return nativeFetch(url, options);
    },
  );
  const priorLive = process.env.LLM_LIVE_ENABLED;
  const priorKey = process.env.OPENAI_API_KEY;
  process.env.LLM_LIVE_ENABLED = 'true';
  process.env.OPENAI_API_KEY = 'not-a-real-key';
  context.after(() => {
    if (priorLive === undefined) delete process.env.LLM_LIVE_ENABLED;
    else process.env.LLM_LIVE_ENABLED = priorLive;
    if (priorKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = priorKey;
  });
  const token = store.session(user);
  const request = (path: string, data?: unknown) =>
    fetch(base + path, {
      method: data ? 'POST' : 'GET',
      headers: {
        cookie: `sid=${token}`,
        'Content-Type': 'application/json',
        'X-Platform-Request': '1',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  try {
    const old = await request('/api/sessions', {
      trackId: 'backend',
      grade: 'Middle',
      toolMode: 'docs',
    });
    assert.equal(old.status, 201);
    const oldSession = (await old.json()) as SessionView;
    const created = await request('/api/sessions', {
      format: 'express-v1',
      trackId: 'backend',
      grade: 'Middle',
      replaceCurrent: true,
      toolMode: 'local',
    });
    assert.equal(created.status, 201);
    assert.equal(store.get<SessionView>('assessment-sessions', oldSession.id)!.state, 'archived');
    const session = (await created.json()) as SessionView;
    assert.equal(session.assessmentIds.length, 1);
    const item = store.get<Assessment>('assessments', session.assessmentIds[0]!)!;
    assert.deepEqual(item.variant.stageModes, ['closed', 'docs', 'docs']);
    const path = `/api/assessments/${item.id}/engineering`;
    assert.equal((await request(path, { operation: 'submit' })).status, 400);
    const diag = await request(path, {
      operation: 'diagnostic',
      nodeId: 'isolation',
      kind: 'logs',
      question: 'Логи',
    });
    assert.equal(diag.status, 200);
    assert.equal(((await diag.json()) as { live: boolean }).live, false);
    const wrong = Object.fromEntries(
      item.variant.questions.map((question) => [
        question.id,
        question.options.find((option) => option.id !== item.variant.oracle.answers[question.id])!
          .id,
      ]),
    );
    for (const data of [
      { operation: 'strategy', stage: 2, strategyId: 'strategy-b', adaptationId: 'adapt-b' },
      { operation: 'audit', audit: {} },
      { operation: 'theory', answers: wrong },
      { operation: 'strategy', stage: 1, strategyId: 'strategy-b' },
      { operation: 'submit' },
    ])
      assert.equal((await request(path, data)).status, 200);
    const complete = (await (
      await request(`/api/sessions/${session.id}`)
    ).json()) as SessionView & { result: { proposedGrade: Grade | null } };
    assert.equal(complete.result.proposedGrade, null);
    const blocked = await request('/api/sessions', {
      format: 'express-v1',
      trackId: 'backend',
      grade: 'Middle',
    });
    assert.equal(blocked.status, 409);
    assert.ok((await blocked.text()).includes('Повтор Middle'));
    assert.equal(
      (
        await request('/api/sessions', {
          format: 'engineering-v1',
          trackId: 'backend',
          grade: 'Middle',
        })
      ).status,
      409,
    );
    assert.equal((await request(`/api/sessions/${oldSession.id}/resume`, {})).status, 409);
    const lower = await request('/api/sessions', {
      format: 'express-v1',
      trackId: 'backend',
      grade: 'Junior',
    });
    assert.equal(lower.status, 201);
    assert.ok(calls.length > 5);
  } finally {
    app.server.close();
    await once(app.server, 'close');
    store.db.close();
  }
});

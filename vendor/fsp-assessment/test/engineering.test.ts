import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { generateVariant, publicVariant, variantFingerprint } from '../src/generator.js';
import { families } from '../src/families/registry.js';
import {
  engineeringVariant,
  engineeringExperiment,
  engineeringDiagnostic,
  recordAudit,
  evaluateEngineering,
} from '../src/engineering.js';
import { enrichEngineeringArtifact } from '../src/engineering-llm.js';
import { createApplication } from '../src/server.js';
import { Store } from '../src/store.js';
import { sessionResult } from '../src/session.js';
import type { Assessment, Grade, SessionView } from '../src/domain.js';

function sample(
  familyId = 'backend-payment-idempotency',
  claimed: Grade = 'Middle',
  seed = 17,
): Assessment {
  const family = families.find((item) => item.id === familyId)!;
  const variant = engineeringVariant({
    ...generateVariant(family.trackId, 'Middle', seed, 'docs', familyId),
    grade: claimed,
  });
  return {
    id: 'a',
    candidateId: 'candidate',
    needId: null,
    variant,
    stage: 0,
    state: 'active',
    experiments: [],
    answers: {},
    recommendation: '',
    createdAt: '2026-10-06',
    submittedAt: null,
    result: null,
  };
}
function finish(assessment: Assessment): Assessment {
  recordAudit(assessment, assessment.variant.oracle.engineering!.defects);
  assessment.answers = { ...assessment.variant.oracle.answers };
  assessment.experiments.push(
    engineeringExperiment(assessment, 1, assessment.variant.oracle.specialized!.referencePlans[0]),
    engineeringExperiment(assessment, 2, {
      ...assessment.variant.oracle.specialized!.referencePlans[1],
      resilience:
        assessment.variant.engineering!.edge.failurePercent >= 50 ? 'breaker-async' : 'async',
    }),
  );
  assessment.result = evaluateEngineering(assessment);
  assessment.state = 'submitted';
  assessment.submittedAt = '2026-10-06T12:00:00.000Z';
  return assessment;
}

test('all 26 engineering families expose a genuinely faulty artifact and pass grounded baseline and edge tests', () => {
  for (const family of families) {
    const item = sample(family.id);
    assert.ok(Object.keys(item.variant.oracle.engineering!.defects).length, family.id);
    const visible = publicVariant(item.variant);
    assert.equal('oracle' in visible, false);
    assert.equal(JSON.stringify(visible).includes('referencePlans'), false);
    assert.notDeepEqual(visible.engineering!.edge.data, item.variant.lab!.data);
    finish(item);
    assert.equal(item.result!.score, 100, family.id);
    assert.equal(item.result!.proposedGrade, 'Middle', family.id);
    assert.ok(
      item.experiments.every((report) => Object.values(report.checks).every(Boolean)),
      family.id,
    );
    const bad = engineeringExperiment(item, 2, {
      ...item.variant.oracle.specialized!.referencePlans[1],
      resilience: 'sync',
    });
    assert.equal(bad.checks.clientResponseBudget, false);
    assert.equal(bad.checks.noLostWork, false);
    assert.throws(() =>
      engineeringExperiment(item, 1, {
        ...item.variant.oracle.specialized!.referencePlans[0],
        injected: 'anything',
      }),
    );
  }
});
test('legacy benchmark confirms only the claim and never promotes or downgrades automatically', () => {
  const junior = finish(sample('backend-payment-idempotency', 'Junior'));
  const senior = finish(sample('backend-payment-idempotency', 'Senior'));
  assert.deepEqual(junior.variant.lab, senior.variant.lab);
  assert.equal(variantFingerprint(junior.variant), variantFingerprint(senior.variant));
  assert.equal(junior.result!.proposedGrade, 'Junior');
  recordAudit(senior, {});
  const lowered = evaluateEngineering(senior);
  assert.equal(lowered.maturity!.rootCauseAccuracy, 0);
  assert.equal(lowered.proposedGrade, null);
});
test('cache diagnostic traces distinguish access violations, stale versions and value mismatches', () => {
  const item = sample('backend-cache-isolation');
  const report = engineeringExperiment(item, 1, {
    ...item.variant.oracle.specialized!.referencePlans[0],
    key: 'resource',
    auth: 'miss-only',
    invalidation: 'ttl-only',
  });
  assert.equal(report.checks.accessIsolation, false);
  assert.ok(report.trace?.some((line) => line.includes('without token re-validation')));
  assert.ok(report.trace?.some((line) => line.includes('Cached value mismatch')));
  assert.ok(report.trace?.some((line) => line.includes('Stale cache response')));
  assert.ok(report.trace?.every((line) => !/version v(\d+) returned instead of v\1\./.test(line)));
});
test('localization penalizes false positives and an earlier passing strategy never masks a later failing one', () => {
  const item = finish(sample());
  const truth = item.variant.oracle.engineering!.defects;
  recordAudit(item, { ...truth, input: 'data-contract' });
  const expected = Math.round(
    (200 * Object.keys(truth).length) / (Object.keys(truth).length * 2 + 1),
  );
  assert.equal(evaluateEngineering(item).maturity!.rootCauseAccuracy, expected);
  const old = item.result!.maturity!.strategyQuality;
  item.experiments.push(
    engineeringExperiment(item, 1, item.variant.oracle.specialized!.mutants[0][0]!),
  );
  assert.ok(evaluateEngineering(item).maturity!.strategyQuality < old);
  assert.throws(() => recordAudit(item, { unknownNode: 'data-contract' }));
  assert.throws(() => recordAudit(item, { input: 'made-up-defect' }));
});
test('AI maturity measures relevant diagnostic variety and repetition, never writing style or query length', () => {
  const first = finish(sample());
  const second = finish(sample());
  const node = Object.keys(first.variant.oracle.engineering!.defects)[0]!;
  for (const kind of ['logs', 'metrics', 'explain'] as const) {
    engineeringDiagnostic(first, node, kind, 'Короткий запрос');
    engineeringDiagnostic(second, node, kind, 'Подробная формулировка '.repeat(80));
  }
  assert.deepEqual(evaluateEngineering(first).maturity, evaluateEngineering(second).maturity);
  assert.equal(evaluateEngineering(first).maturity!.aiDepth, 3);
  assert.equal(evaluateEngineering(first).maturity!.aiEfficiency, 100);
  engineeringDiagnostic(first, node, 'logs', 'Повтор');
  assert.equal(evaluateEngineering(first).maturity!.aiEfficiency, 75);
  assert.equal(evaluateEngineering(second).score, 100);
  assert.equal(finish(sample()).result!.maturity!.aiEfficiency, null);
});
test('session level uses the weakest mandatory case and company evidence never replaces a general level', () => {
  const one = finish(sample());
  const two = finish(sample('backend-cache-isolation'));
  two.id = 'b';
  recordAudit(two, {});
  two.result = evaluateEngineering(two);
  const session: SessionView = {
    id: 's',
    candidateId: 'candidate',
    trackId: 'backend',
    grade: 'Middle',
    needId: null,
    assessmentIds: ['a', 'b'],
    createdAt: '',
    state: 'submitted',
    format: 'engineering-v1',
    assessments: [one, two],
  };
  assert.equal(sessionResult(session, session.assessments)!.proposedGrade, null);
  assert.equal(
    sessionResult({ ...session, needId: 'company' }, session.assessments)!.proposedGrade,
    null,
  );
});
test('engineering API allows edge tests before theory and audit, retains diagnostics, enforces completion and ownership', async () => {
  const store = new Store(':memory:');
  const user = store.createUser(
    'engineer@test.local',
    'Password2026!',
    'Candidate',
    'candidate',
    true,
  );
  const other = store.createUser(
    'other.engineer@test.local',
    'Password2026!',
    'Other',
    'candidate',
    true,
  );
  const app = createApplication(store, { development: true, dataDir: 'data' });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const request = (
    path: string,
    data?: unknown,
    token = store.session(user),
    method = data ? 'POST' : 'GET',
  ) =>
    fetch(base + path, {
      method,
      headers: {
        cookie: `sid=${token}`,
        'Content-Type': 'application/json',
        'X-Platform-Request': '1',
      },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  try {
    const created = await request('/api/sessions', {
      trackId: 'backend',
      grade: 'Junior',
      toolMode: 'docs',
      format: 'engineering-v1',
    });
    assert.equal(created.status, 201);
    const session = (await created.json()) as SessionView;
    const first = store.get<Assessment>('assessments', session.assessmentIds[0]!)!;
    const path = `/api/assessments/${first.id}/engineering`;
    assert.equal((await request(path, { operation: 'submit' })).status, 400);
    const edge = {
      ...first.variant.oracle.specialized!.referencePlans[1],
      resilience: first.variant.engineering!.edge.failurePercent >= 50 ? 'breaker-async' : 'async',
    };
    assert.equal(
      (await request(path, { operation: 'strategy', stage: 2, plan: edge })).status,
      200,
    );
    assert.equal(
      (await request(path, { operation: 'audit', audit: {} }, store.session(other))).status,
      404,
    );
    assert.equal(
      (
        await request(`/api/assessments/${first.id}/answers`, {
          answers: first.variant.oracle.answers,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request(path, {
          operation: 'diagnostic',
          nodeId: 'input',
          kind: 'logs',
          question: 'Проверить повтор',
        })
      ).status,
      200,
    );
    assert.equal(
      store.get<Assessment>('assessments', first.id)!.engineeringProgress!.diagnostics.length,
      1,
    );
    for (const id of session.assessmentIds) {
      const item = store.get<Assessment>('assessments', id)!;
      const endpoint = `/api/assessments/${id}/engineering`;
      for (const data of [
        { operation: 'theory', answers: item.variant.oracle.answers },
        { operation: 'audit', audit: item.variant.oracle.engineering!.defects },
        {
          operation: 'strategy',
          stage: 1,
          plan: item.variant.oracle.specialized!.referencePlans[0],
        },
        {
          operation: 'strategy',
          stage: 2,
          plan: {
            ...item.variant.oracle.specialized!.referencePlans[1],
            resilience:
              item.variant.engineering!.edge.failurePercent >= 50 ? 'breaker-async' : 'async',
          },
        },
        { operation: 'submit' },
      ])
        assert.equal((await request(endpoint, data)).status, 200);
    }
    const complete = (await (
      await request(`/api/sessions/${session.id}`)
    ).json()) as SessionView & { result: { proposedGrade: Grade } };
    assert.equal(complete.state, 'submitted');
    assert.equal(complete.result.proposedGrade, 'Junior');
    assert.equal((await request(path, { operation: 'audit', audit: {} })).status, 409);
    assert.equal(JSON.stringify(complete).includes('"oracle"'), false);
    store.updateUser(user.id, { fspId: 'FSP-123', fspVerified: true });
    assert.equal((await (await request('/api/fsp/status')).json()).verified, false);
    store.save('fsp-verifications', `${user.id}:FSP-123`, 'trusted-integration', {
      id: 'FSP-123',
      verified: true,
      verifiedAt: '2026-10-06',
      competition: 'Competition',
      topPercent: 10,
    });
    const fsp = await (await request('/api/fsp/status')).json();
    assert.equal(fsp.verified, true);
    assert.equal(fsp.topPercent, 10);
    store.updateUser(other.id, { fspId: 'FSP-123', fspVerified: true });
    assert.equal(
      (await (await request('/api/fsp/status', undefined, store.session(other))).json()).verified,
      false,
    );
  } finally {
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
    store.close();
  }
});
test('real LLM artifacts preserve verified faulty decisions and malformed output is rejected', async (context) => {
  const variant = sample().variant;
  const prior = {
    live: process.env.LLM_LIVE_ENABLED,
    key: process.env.YANDEX_API_KEY,
    folder: process.env.YANDEX_FOLDER_ID,
  };
  context.after(() => {
    for (const [key, value] of Object.entries({
      LLM_LIVE_ENABLED: prior.live,
      YANDEX_API_KEY: prior.key,
      YANDEX_FOLDER_ID: prior.folder,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  process.env.LLM_LIVE_ENABLED = 'false';
  assert.equal(await enrichEngineeringArtifact(variant), variant);
  process.env.LLM_LIVE_ENABLED = 'true';
  process.env.YANDEX_API_KEY = 'test-key';
  process.env.YANDEX_FOLDER_ID = 'test-folder';
  const provider = context.mock.method(globalThis, 'fetch', async () =>
    Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              nodes: variant.engineering!.nodes.map((node) => ({
                id: node.id,
                code: `BEGIN\n${node.code}\nEND`,
              })),
            }),
          },
        },
      ],
    }),
  );
  const generated = await enrichEngineeringArtifact(variant);
  assert.equal(generated.engineering!.artifactSource, 'llm');
  assert.deepEqual(generated.oracle, variant.oracle);
  provider.mock.mockImplementation(async () =>
    Response.json({ choices: [{ message: { content: '{"nodes":[]}' } }] }),
  );
  await assert.rejects(enrichEngineeringArtifact(variant), /неверная структура/);
});

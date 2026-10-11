import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { createApplication } from '../src/server.js';
import { oracleInput } from '../src/validation-engine.js';
import type { Assessment } from '../src/domain.js';

test('full API flow: identity, owned assessments, privacy, needs and invitations', async () => {
  const store = new Store(':memory:');
  const candidate = store.createUser(
    'a@example.org',
    'Password2026!',
    'Candidate',
    'candidate',
    true,
  );
  const other = store.createUser('b@example.org', 'Password2026!', 'Other', 'candidate', true);
  const employer = store.createUser('e@example.org', 'Password2026!', 'Employer', 'employer', true);
  const admin = store.createUser('admin@example.org', 'Password2026!', 'Expert', 'admin', true);
  const { server } = createApplication(store, { development: true, dataDir: 'data' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const cookie = (id: typeof candidate) => `sid=${store.session(id)}`;
  const candidateCookie = cookie(candidate);
  const otherCookie = cookie(other);
  const employerCookie = cookie(employer);
  const adminCookie = cookie(admin);
  async function call(path: string, method = 'GET', data?: unknown, session = candidateCookie) {
    const response = await fetch(`${base}/api${path}`, {
      method,
      headers: { Cookie: session, 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, body: (await response.json()) as Record<string, unknown> };
  }
  try {
    const schema = await call('/openapi.json');
    assert.equal(schema.body.openapi, '3.1.0');
    assert.ok((schema.body.paths as Record<string, unknown>)['/api/cases/{id}/assistant']);
    assert.equal((await call('/admin/validation')).status, 403);
    assert.equal((await call('/admin/generative-status')).status, 403);
    const generatorStatus = await call('/admin/generative-status', 'GET', undefined, adminCookie);
    assert.equal(generatorStatus.status, 200);
    assert.ok('assessmentValidation' in generatorStatus.body);
    if (generatorStatus.body.assessmentValidation) {
      const summary = generatorStatus.body.assessmentValidation as Record<string, unknown>;
      assert.equal(summary.humanPilot, false);
      assert.equal('rows' in summary, false);
      assert.equal('accepted' in summary, false);
    }
    assert.equal(
      (
        await call('/assessments', 'POST', {
          trackId: 'backend',
          grade: 'Middle',
          familyId: 'cv-detection-nms',
        })
      ).status,
      400,
    );
    const created = await call('/assessments', 'POST', {
      trackId: 'backend',
      grade: 'Middle',
      toolMode: 'local',
      familyId: 'backend-payment-idempotency',
    });
    assert.equal(created.status, 201);
    const id = String(created.body.id);
    assert.equal('oracle' in (created.body.variant as Record<string, unknown>), false);
    assert.equal((await call(`/assessments/${id}`, 'GET', undefined, otherCookie)).status, 404);
    assert.equal(
      (await call(`/assessments/${id}/assistant`, 'POST', { question: 'Help' })).status,
      400,
    );
    assert.equal((await call(`/assessments/${id}/advance`, 'POST', {})).status, 409);
    const stored = store.get<Assessment>('assessments', id)!;
    await call(`/assessments/${id}/answers`, 'POST', { answers: stored.variant.oracle.answers });
    await call(`/assessments/${id}/advance`, 'POST', {});
    assert.equal(
      (
        await call(`/assessments/${id}/experiments`, 'POST', {
          plan: { key: 'injected', transaction: 'atomic', retry: 'same-id' },
        })
      ).status,
      400,
    );
    const help = await call(`/assessments/${id}/assistant`, 'POST', {
      question: 'Как проверить гипотезу?',
    });
    assert.equal(help.body.live, false);
    await call(`/assessments/${id}/experiments`, 'POST', oracleInput(stored.variant));
    await call(`/assessments/${id}/advance`, 'POST', {});
    await call(`/assessments/${id}/experiments`, 'POST', oracleInput(stored.variant, 2));
    const submitted = await call(`/assessments/${id}/submit`, 'POST', {
      recommendation: 'Запуск после проверки максимальной версии, повторов и плана отката.',
    });
    assert.equal((submitted.body.result as Record<string, unknown>).status, 'provisional');
    assert.equal(
      (await call(`/assessments/${id}/submit`, 'POST', { recommendation: 'Duplicate' })).status,
      409,
    );
    assert.equal((await call(`/assessments/${id}/archive`, 'POST', {})).status, 409);
    assert.equal(
      (await call('/assessments', 'POST', { trackId: 'backend', grade: 'Senior' })).status,
      409,
    );
    const need = await call(
      '/needs',
      'POST',
      {
        title: 'Backend',
        trackId: 'backend',
        grade: 'Middle',
        required: ['reliability'],
        weights: { reliability: 5 },
        stack: ['TypeScript'],
        toolMode: 'local',
        salaryMin: 100000,
        salaryMax: 200000,
        description: 'Payment events',
      },
      employerCookie,
    );
    assert.equal(need.status, 201);
    assert.equal(
      (need.body.blueprint as Record<string, unknown>).familyId,
      'backend-cache-isolation',
    );
    assert.ok(
      (
        (need.body.blueprint as Record<string, unknown>).additionalChecksNeeded as string[]
      ).includes('reasoning'),
    );
    const listBefore = await fetch(`${base}/api/candidates?needId=${need.body.id}`, {
      headers: { Cookie: employerCookie },
    });
    const candidates = (await listBefore.json()) as { contacts: string | null }[];
    assert.equal(candidates[0]?.contacts, null);
    const invitation = await call(
      '/invitations',
      'POST',
      {
        candidateId: candidate.id,
        description: 'Join our team',
        salaryMin: 100000,
        salaryMax: 200000,
      },
      employerCookie,
    );
    assert.equal(invitation.status, 201);
    assert.equal(
      (
        await call(
          `/invitations/${invitation.body.id}`,
          'PATCH',
          { status: 'accepted' },
          otherCookie,
        )
      ).status,
      404,
    );
    await call(`/invitations/${invitation.body.id}`, 'PATCH', { status: 'accepted' });
    const listAfter = await fetch(`${base}/api/candidates`, {
      headers: { Cookie: employerCookie },
    });
    assert.equal(
      ((await listAfter.json()) as { contacts: string }[])[0]?.contacts,
      'a@example.org',
    );
    assert.equal((await call('/admin/budget', 'GET', undefined, adminCookie)).status, 404);
    assert.equal(
      (await call('/admin/observations', 'GET', undefined, adminCookie)).body.humanObservations,
      0,
    );
    const invalid = await fetch(`${base}/api/needs`, {
      method: 'POST',
      headers: { Cookie: employerCookie },
      body: '{}',
    });
    assert.equal(invalid.status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test('special cases remain experimental; templates produce owned variants without leaking answers', async () => {
  const store = new Store(':memory:');
  const employer = store.createUser('e@example.org', 'Password2026!', 'E', 'employer', true);
  const candidate = store.createUser('c@example.org', 'Password2026!', 'C', 'candidate', true);
  const { server } = createApplication(store, { development: true, dataDir: 'data' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const ec = `sid=${store.session(employer)}`;
  const cc = `sid=${store.session(candidate)}`;
  async function call(path: string, method = 'GET', data?: unknown, cookie = ec) {
    const response = await fetch(base + path, {
      method,
      headers: { Cookie: cookie, 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
  }
  try {
    const created = await call('/cases', 'POST', {
      title: 'Special',
      trackId: 'backend',
      skills: ['reliability'],
      context: 'Задержка {{days}} дней',
      deliverable: 'План проверки',
      constraints: 'CPU only',
      materials: [{ name: 'contract', content: 'at least once' }],
      questions: [
        { prompt: 'Повторы возможны?', options: ['Да', 'Нет'], correct: 0, skill: 'reliability' },
      ],
      variations: ['days=3:20'],
      rubric: 'Проверить повторную доставку',
      mode: 'docs',
    });
    assert.equal(created.status, 201);
    const id = String(created.data.id);
    await call(`/cases/${id}/publish`, 'POST', {});
    const variant = await call(`/cases/${id}/variant`, 'GET', undefined, cc);
    assert.ok(!String(variant.data.context).includes('{{'));
    assert.equal('answers' in variant.data, false);
    const result = await call(
      `/cases/${id}/submit`,
      'POST',
      {
        variantId: variant.data.id,
        answers: { 'custom-0': '0' },
        recommendation: 'План проверки повторной доставки.',
      },
      cc,
    );
    assert.equal(result.status, 201);
    assert.equal(result.data.affectsGrade, false);
    assert.equal(store.list('assessments').length, 0);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { Store } from '../src/store.js';
import { createApplication } from '../src/server.js';
import { sessionResult, latestLevelChange } from '../src/session.js';
import { evaluate } from '../src/scoring.js';
import { runExperiment } from '../src/simulator.js';
import { oracleInput } from '../src/validation-engine.js';
import { generateVariant } from '../src/generator.js';
import { initialState, rank } from '../offerly-web/lib/model.js';
import type { Assessment, AssessmentSession, SessionView } from '../src/domain.js';

function finish(assessment: Assessment): Assessment {
  assessment.answers = assessment.variant.oracle.answers;
  assessment.experiments = [1, 2].map((stage) =>
    runExperiment(assessment.variant, oracleInput(assessment.variant, stage), stage),
  );
  assessment.recommendation =
    'Проверены исходные и изменённые условия; ограничения и дальнейшие проверки описаны.';
  assessment.state = 'submitted';
  assessment.submittedAt = new Date().toISOString();
  assessment.result = evaluate(assessment);
  return assessment;
}

test('a general level requires both cases, while company sessions never assign a general level', async () => {
  const store = new Store(':memory:');
  const user = store.createUser(
    'session@test.local',
    'Test2026!password',
    'Кандидат',
    'candidate',
    true,
  );
  const { server } = createApplication(store, { development: true, dataDir: 'data' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const cookie = `sid=${store.session(user)}`;
  const request = (path: string, data?: unknown) =>
    fetch(base + path, {
      method: data ? 'POST' : 'GET',
      headers: { cookie, 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
      ...(data ? { body: JSON.stringify(data) } : {}),
    });
  try {
    const created = await request('/api/sessions', {
      trackId: 'backend',
      grade: 'Middle',
      toolMode: 'docs',
    });
    assert.equal(created.status, 201);
    const program = (await created.json()) as SessionView;
    assert.equal(program.assessments.length, 2);
    assert.equal(new Set(program.assessments.map((item) => item.variant.familyId)).size, 2);
    assert.equal('oracle' in program.assessments[0]!.variant, false);
    assert.equal(
      (await request('/api/sessions', { trackId: 'backend', grade: 'Middle' })).status,
      409,
    );
    const other = store.createUser(
      'other@test.local',
      'Test2026!password',
      'Другой',
      'candidate',
      true,
    );
    assert.equal(
      (
        await fetch(`${base}/api/sessions/${program.id}`, {
          headers: { cookie: `sid=${store.session(other)}` },
        })
      ).status,
      404,
    );
    const session = store.get<AssessmentSession>('assessment-sessions', program.id)!;
    const members = session.assessmentIds.map((id) => store.get<Assessment>('assessments', id)!);
    finish(members[0]!);
    assert.equal(sessionResult(session, members), null);
    finish(members[1]!);
    assert.equal(sessionResult(session, members)!.proposedGrade, 'Middle');
    assert.equal(
      sessionResult({ ...session, assessmentIds: [members[0]!.id, members[0]!.id] }, members),
      null,
    );
    assert.equal(sessionResult({ ...session, assessmentIds: [] }, []), null);
    assert.equal(sessionResult({ ...session, needId: 'company' }, members)!.proposedGrade, null);
    members[1]!.expertReview = {
      decision: 'needs_revision',
      notes: 'Нет обоснования',
      at: new Date().toISOString(),
    };
    assert.equal(sessionResult(session, members)!.proposedGrade, null);
    const archived = await request(`/api/sessions/${session.id}/archive`, {});
    assert.equal(archived.status, 200);
    const restored = await request(`/api/sessions/${session.id}/resume`, {});
    assert.equal(restored.status, 200);
    assert.ok(
      ((await restored.json()) as SessionView).assessments.every(
        (member) => member.state === 'active',
      ),
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test('production does not expose the local workspace bridge', async () => {
  const store = new Store(':memory:');
  const { server } = createApplication(store, {
    development: false,
    dataDir: 'data',
    bridgeSecret: 'configured-but-disabled',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/auth/bridge`, {
      method: 'POST',
      headers: { 'X-Platform-Request': '1', 'Content-Type': 'application/json' },
      body: '{}',
    });
    assert.equal(response.status, 404);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test('signed workspace sessions isolate users and reject unsigned or production bridge access', async () => {
  const store = new Store(':memory:');
  const { server } = createApplication(store, {
    development: true,
    dataDir: 'data',
    bridgeSecret: 'test-secret',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/auth/bridge`;
  const bridge = async (owner: string, signatureOverride?: string) => {
    const payload = JSON.stringify({ owner, role: 'candidate', at: Date.now() });
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
      body: JSON.stringify({
        payload,
        signature:
          signatureOverride || createHmac('sha256', 'test-secret').update(payload).digest('hex'),
      }),
    });
  };
  try {
    const first = await bridge('workspace-a');
    const again = await bridge('workspace-a');
    const second = await bridge('workspace-b');
    assert.equal(first.status, 200);
    const firstId = ((await first.json()) as { id: string }).id;
    assert.equal(firstId, ((await again.json()) as { id: string }).id);
    assert.notEqual(((await second.json()) as { id: string }).id, firstId);
    assert.equal((await bridge('workspace-a', 'invalid')).status, 403);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
  }
});

test('employer priorities change ranking using accumulated competencies without certifying resume technologies', () => {
  const base = initialState();
  const need = {
    ...base.needs[0]!,
    competencyRequired: ['reliability', 'data'],
    competencyWeights: { reliability: 10, data: 1 },
  };
  const evidence = (skillId: string, score: number) => ({
    skillId,
    name: skillId,
    track: 'Backend',
    score,
    at: '',
    assessmentId: skillId,
    familyId: skillId,
    companyOnly: false,
  });
  const reliable = {
    ...base.profile,
    verified: [],
    evidence: [evidence('reliability', 100), evidence('data', 0)],
  };
  const data = {
    ...base.profile,
    verified: [],
    evidence: [evidence('reliability', 0), evidence('data', 100)],
  };
  assert.ok(rank(reliable, need).score > rank(data, need).score);
  const reversed = { ...need, competencyWeights: { reliability: 1, data: 10 } };
  assert.ok(rank(data, reversed).score > rank(reliable, reversed).score);
  assert.deepEqual(rank(reliable, need).matched, ['Надёжность']);
  assert.ok(rank(reliable, need).reasons.some((reason) => reason.includes('Качество данных')));
});

test('repeating the current level preserves the original level-change date', () => {
  const base: AssessmentSession = {
    id: 's',
    candidateId: 'c',
    trackId: 'backend',
    grade: 'Middle',
    needId: null,
    assessmentIds: [],
    createdAt: '2026-01-01T00:00:00Z',
    state: 'submitted',
  };
  assert.deepEqual(
    latestLevelChange([base, { ...base, id: 'repeat', createdAt: '2026-02-01T00:00:00Z' }]),
    { grade: 'Middle', at: base.createdAt },
  );
  assert.deepEqual(
    latestLevelChange([
      base,
      { ...base, id: 'senior', grade: 'Senior', createdAt: '2026-05-01T00:00:00Z' },
    ]),
    { grade: 'Senior', at: '2026-05-01T00:00:00Z' },
  );
});

test('payment variants require different reasoning and the changed senior contract requires adaptation', () => {
  const signatures = new Set<string>();
  const theories = new Set<string>();
  let changed = 0;
  for (const grade of ['Junior', 'Middle', 'Senior'] as const)
    for (let seed = 1; seed <= 32; seed++) {
      const variant = generateVariant(
        'backend',
        grade,
        seed,
        'docs',
        'backend-payment-idempotency',
      );
      const references = variant.oracle.specialized!.referencePlans;
      signatures.add(JSON.stringify(references[0]));
      theories.add(JSON.stringify(variant.questions.map((question) => question.prompt)));
      if (JSON.stringify(references[0]) !== JSON.stringify(references[1])) changed++;
      for (const stage of [1, 2])
        assert.ok(
          Object.values(runExperiment(variant, oracleInput(variant, stage), stage).checks).every(
            Boolean,
          ),
        );
      if (grade === 'Senior')
        assert.ok(
          !Object.values(runExperiment(variant, { plan: references[0] }, 2).checks).every(Boolean),
        );
    }
  assert.ok(signatures.size >= 6);
  assert.ok(theories.size >= 6);
  assert.ok(changed >= 32);
});

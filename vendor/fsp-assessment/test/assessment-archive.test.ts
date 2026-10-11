import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Store } from '../src/store.js';
import { createApplication } from '../src/server.js';
import type { Assessment } from '../src/domain.js';

test('archiving frees a slot, preserves progress and enforces ownership and restore capacity', async () => {
  const store = new Store(':memory:');
  const user = store.createUser(
    'archive@example.org',
    'Password2026!',
    'Candidate',
    'candidate',
    true,
  );
  const other = store.createUser(
    'other-archive@example.org',
    'Password2026!',
    'Other',
    'candidate',
    true,
  );
  const cookie = `sid=${store.session(user)}`;
  const foreignCookie = `sid=${store.session(other)}`;
  const { server } = createApplication(store, { development: true, dataDir: 'data' });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  async function post(path: string, data: unknown = {}, session = cookie) {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { Cookie: session, 'Content-Type': 'application/json', 'X-Platform-Request': '1' },
      body: JSON.stringify(data),
    });
    return { status: response.status, body: (await response.json()) as Assessment };
  }
  try {
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      const created = await post('/assessments', {
        trackId: 'backend',
        grade: 'Middle',
        familyId: 'backend-payment-idempotency',
      });
      assert.equal(created.status, 201);
      ids.push(created.body.id);
    }
    assert.equal((await post('/assessments', { trackId: 'backend', grade: 'Middle' })).status, 409);
    const first = store.get<Assessment>('assessments', ids[0]!)!;
    await post(`/assessments/${first.id}/answers`, { answers: first.variant.oracle.answers });
    await post(`/assessments/${first.id}/advance`);
    assert.equal((await post(`/assessments/${first.id}/archive`, {}, foreignCookie)).status, 404);
    const archived = await post(`/assessments/${first.id}/archive`);
    assert.equal(archived.body.state, 'archived');
    assert.equal(archived.body.stage, 1);
    assert.deepEqual(archived.body.answers, first.variant.oracle.answers);
    assert.equal('oracle' in archived.body.variant, false);
    assert.equal((await post(`/assessments/${first.id}/advance`)).status, 409);
    assert.equal((await post('/assessments', { trackId: 'backend', grade: 'Middle' })).status, 201);
    assert.equal((await post(`/assessments/${first.id}/resume`)).status, 409);
    await post(`/assessments/${ids[1]}/archive`);
    const resumed = await post(`/assessments/${first.id}/resume`);
    assert.equal(resumed.status, 200);
    assert.equal(resumed.body.state, 'active');
    assert.equal(resumed.body.stage, 1);
    assert.deepEqual(resumed.body.answers, archived.body.answers);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
  }
});

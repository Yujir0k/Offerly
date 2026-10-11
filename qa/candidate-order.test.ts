import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { candidateOrderSql } from '../lib/candidate-order';

test('explicit sorts precede category/version grouping and pagination', async () => {
  const db = new PGlite();
  const fixtures = Array.from({length: 25}, (_, i) => ({
    id: i + 1, specialty: i < 20 ? 'Android' : 'Backend', grade: i === 24 ? null : i % 2 ? 'Senior' : 'Junior',
    score: i < 20 ? 81 : 100, salaryMin: 200000 - i * 1000,
    assessmentEvidence: { confirmedAt: `2026-10-${String(i+1).padStart(2,'0')}`, assessmentVersion: i % 2 ? 'a' : 'z' },
    sport: i, group: i < 20 ? 0 : 1,
  }));
  async function order(sort: string, page = 0) {
    const {rows} = await db.query<{id:number}>(`WITH p AS (
      SELECT (v->>'id')::int id,v->>'specialty' specialty,v->>'grade' grade,v payload FROM jsonb_array_elements($1::jsonb) v
    ) SELECT p.id FROM p CROSS JOIN LATERAL (SELECT jsonb_build_object('group',p.payload->'group','sport',p.payload->'sport','value',p.payload->'score') metrics) r
    ORDER BY ${candidateOrderSql(sort, sort === 'По достижениям ФСП' ? 'fsp' : 'test')} LIMIT 20 OFFSET $2`, [JSON.stringify(fixtures),page*20]);
    return rows.map(r => r.id);
  }
  try {
    const ids = [...await order('По результату теста'),...await order('По результату теста',1)];
    assert(ids.slice(0,4).every(id => id >= 21 && id <=24));
    assert.equal(ids.at(-1),25,'An unconfirmed claimed score cannot outrank assessed candidates');
    assert.equal(new Set(ids).size,25,'Pagination must not duplicate candidates');
    assert.deepEqual((await order('По достижениям ФСП')).slice(0,3),[25,24,23]);
    assert.deepEqual((await order('По зарплате')).slice(0,3),[25,24,23]);
    assert.deepEqual((await order('По дате подтверждения')).slice(0,3),[25,24,23]);
    assert(candidateOrderSql('По соответствию','balanced').startsWith("(r.metrics->>'group')"),'Default matching keeps category comparison');
  } finally { await db.close(); }
});

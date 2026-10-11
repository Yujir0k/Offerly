// Runs trusted, captured SELECT shapes with bound parameters. Never prints rows or parameters.
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
assert.equal(process.env.PERF_SQL_ALLOWED, 'opherly');
const { Client } = createRequire('/app/package.json')('pg');
const queries = JSON.parse(readFileSync(0, 'utf8'));
const query = queries.find(q => q.sql.startsWith('SELECT p.payload,'));
assert(query && !query.sql.includes(';'));
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SET statement_timeout='10s'");
  let baseline;
  for (const fence of [false, true]) for (const jit of [true, false]) {
    await client.query('SET jit=' + (jit ? 'on' : 'off'));
    const sql = fence ? query.sql.replace(' AS metrics) r', ' AS metrics OFFSET 0) r') : query.sql;
    const timings = [], jitTimings = [];
    for (let n = 0; n < 3; n++) {
      const { rows } = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, query.params);
      const plan = rows[0]['QUERY PLAN'][0];
      timings.push(plan['Execution Time']);
      jitTimings.push(plan.JIT?.Timing?.Total ?? 0);
    }
    const rows = (await client.query(sql, query.params)).rows;
    const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    baseline ||= hash;
    assert.equal(hash, baseline, 'Query result changed');
    console.log(JSON.stringify({ fence, jit, sameResult: true, rows: rows.length, executionMs: timings, jitMs: jitTimings }));
  }
} finally { await client.end(); }

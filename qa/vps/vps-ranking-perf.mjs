// Compare complete ranking JSON and query timings with a session-local function.
// No production function, schema, profile, or migration is changed by this check.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
assert.equal(process.env.PERF_SQL_ALLOWED, 'opherly');
const { Client } = createRequire('/app/package.json')('pg');
const { queries, migration } = JSON.parse(readFileSync(0, 'utf8'));
const query = queries.find(q => q.sql.startsWith('SELECT p.payload,'));
assert(query && !query.sql.includes(';'));
const client = new Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("SET statement_timeout='45s'");
  await client.query('CREATE TEMP TABLE perf_profiles (LIKE candidate_profiles INCLUDING DEFAULTS)');
  let ddl = migration.slice(0, migration.indexOf('INSERT INTO schema_migrations'));
  for(const name of ['offerly_candidate_rank','offerly_catalog_payload','offerly_candidate_searchable'])
    ddl=ddl.replaceAll(name+'(', 'pg_temp.'+name+'(');
  ddl=ddl.replaceAll('candidate_profiles','pg_temp.perf_profiles');
  await client.query(ddl);
  await client.query('INSERT INTO perf_profiles SELECT * FROM candidate_profiles');
  await client.query('ANALYZE perf_profiles');
  const contexts = [{}, { specialty: 'Backend', grade: 'Junior' },
    { skills: ['Python'], desiredSkills: ['SQL'] },
    { task: 'product', weights: { diagnosis: 1, correctness: 1, engineering_judgment: 3, adaptation: 3 } },
    { mode: 'fsp', skills: ['React'], specialty: 'Frontend' }];
  const comparison = await client.query(`SELECT count(*)::integer AS comparisons,
    count(*) FILTER (WHERE offerly_candidate_rank(p.payload,c.value) IS DISTINCT FROM
      pg_temp.offerly_candidate_rank(p.catalog_payload,c.value))::integer AS differences
    FROM perf_profiles p CROSS JOIN jsonb_array_elements($1::jsonb) c(value)`, [JSON.stringify(contexts)]);
  assert.equal(comparison.rows[0].differences, 0);
  console.log(JSON.stringify(comparison.rows[0]));
  console.log(JSON.stringify({eligible:(await client.query(queries[0].sql,queries[0].params)).rows[0].total, profiles:(await client.query('SELECT count(*)::integer AS n FROM perf_profiles')).rows[0].n}));
  let baseline;
  for (const optimized of [false, true]) {
    let sql = query.sql;
    if(optimized){
      const start=sql.indexOf('p.visible AND p.consent AND '),end=sql.indexOf(' AND p.id<>',start);
      assert(start>0&&end>start);
      sql=sql.slice(0,start)+'p.catalog_eligible'+sql.slice(end);
      sql=sql.replaceAll('candidate_profiles','perf_profiles').replaceAll('p.payload','p.catalog_payload')
        .replace('SELECT p.catalog_payload,','SELECT p.payload,')
        .replaceAll('offerly_candidate_rank(', 'pg_temp.offerly_candidate_rank(');
    }
    const times = [];
    for (let n = 0; n < 4; n++) {
      const { rows } = await client.query('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + sql, query.params);
      times.push(rows[0]['QUERY PLAN'][0]['Execution Time']);
    }
    const rows = (await client.query(sql, query.params)).rows;
    const hash = createHash('sha256').update(JSON.stringify(rows)).digest('hex');
    baseline ||= hash;
    assert.equal(hash, baseline);
    console.log(JSON.stringify({ optimized, sameResult: true, rows: rows.length, executionMs: times }));
  }
} finally { await client.end(); }

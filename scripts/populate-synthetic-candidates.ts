import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import type { Database } from '../db';
import { installSyntheticPopulation } from '../lib/synthetic-population';

// Run only while this PGlite checkout's dev server is stopped.
if (process.env.DATABASE_URL)
  throw new Error('Этот инструмент предназначен для локального PGlite');
const pg = new PGlite(
  path.resolve(process.env.PGLITE_PATH || '.data/postgres'),
);
await pg.waitReady;
const wrap = (client: Pick<PGlite, 'query'>): Database => ({
  query: (sql, params = []) => client.query(sql, params),
  transaction: (operation) => pg.transaction((tx) => operation(wrap(tx))),
});
for (const file of (await readdir('db/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort())
  await pg.exec(await readFile(path.join('db/migrations', file), 'utf8'));
const db = wrap(pg);
const unchangedQuery =
  "SELECT count(*)::integer AS total,md5(string_agg(p.payload::text,'|' ORDER BY p.id)) AS fingerprint FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE NOT u.demo";
const before = (await db.query(unchangedQuery)).rows;
const { rows: scopes } = await db.query<{ id: string }>(
  'SELECT u.id FROM users u JOIN account_state a ON a.user_id=u.id WHERE u.demo=true AND u.scope=u.id AND u.deleted_at IS NULL ORDER BY u.created_at',
);
for (const scope of scopes) {
  const result = await db.transaction((tx) =>
    installSyntheticPopulation(tx, scope.id),
  );
  process.stdout.write(`${scope.id}: ${JSON.stringify(result)}\n`);
}
process.stdout.write(
  `Filled ${scopes.length} private demo scopes; ordinary accounts were untouched.\n`,
);
assert.deepEqual(
  (await db.query(unchangedQuery)).rows,
  before,
  'Ordinary profiles changed',
);
await pg.close();

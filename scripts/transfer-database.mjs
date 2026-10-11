// Offline PGlite snapshot -> fresh PostgreSQL. Never attach this tool to the live local DB.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const [mode, input, output] = process.argv.slice(2);
const quote = (v) => '"' + v.replaceAll('"', '""') + '"';
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])]));
  return v;
}
const digest = (rows) => createHash('sha256').update(rows.map(r => JSON.stringify(canonical(r))).sort().join('\n')).digest('hex');

if (mode === 'export') {
  if (!input || !output) throw Error('export SNAPSHOT_DIR OUTPUT_JSON');
  await fs.access(path.join(input, '.offerly-offline-copy'));
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(input);
  await db.waitReady;
  try {
    await db.exec("SET TIME ZONE 'UTC'");
    const { rows: tables } = await db.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename");
    const { rows: fks } = await db.query("SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE c.contype='f' AND n.nspname='public'");
    const data = [];
    for (const { tablename } of tables) {
      if (['schema_migrations','migration_checksums'].includes(tablename)) continue;
      const { rows } = await db.query(`SELECT to_jsonb(t) AS row FROM public.${quote(tablename)} t`);
      const { rows: columns } = await db.query("SELECT column_name, is_generated FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position", [tablename]);
      const values = rows.map(r => r.row);
      data.push({ name: tablename, columns: columns.filter(c=>c.is_generated==='NEVER').map(c=>c.column_name), rows: values, count: values.length, sha256: digest(values) });
    }
    await fs.writeFile(output, JSON.stringify({ format: 'offerly-db-v1', createdAt: new Date().toISOString(), fks, tables: data }), { mode: 0o600 });
    console.log(JSON.stringify({ exportedTables: data.length, totalRows: data.reduce((n,t)=>n+t.count,0) }));
  } finally { await db.close(); }
} else if (mode === 'import' || mode === 'verify') {
  if (!process.env.DATABASE_URL || !input) throw Error('DATABASE_URL and input required');
  const { Client } = await import('pg');
  const snapshot = JSON.parse(await fs.readFile(input, 'utf8'));
  if (snapshot.format !== 'offerly-db-v1') throw Error('Unsupported snapshot');
  for (const t of snapshot.tables) if (digest(t.rows)!==t.sha256 || t.rows.length!==t.count) throw Error('Snapshot integrity: '+t.name);
  const destination = new URL(process.env.DATABASE_URL);
  if (process.env.TRANSFER_DATABASE_NAME) destination.pathname = '/' + process.env.TRANSFER_DATABASE_NAME;
  const db = new Client({ connectionString: destination.toString() });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query("SET LOCAL TIME ZONE 'UTC'");
    if (mode === 'import') {
      for (const t of snapshot.tables) {
        const {rows:[row]}=await db.query(`SELECT count(*)::int AS n FROM public.${quote(t.name)}`);
        if (row.n) throw Error('Destination not empty: '+t.name);
      }
      const pending = [...snapshot.tables], done = new Set(['schema_migrations','migration_checksums']);
      while (pending.length) {
        const index = pending.findIndex(t=>snapshot.fks.every(f=>f.child!==t.name || f.parent===t.name || done.has(f.parent)));
        if (index<0) throw Error('Foreign key dependency cycle');
        const [t]=pending.splice(index,1), cols=t.columns.map(quote).join(',');
        for(let i=0;i<t.rows.length;i+=100) {
          await db.query(`INSERT INTO public.${quote(t.name)} (${cols}) OVERRIDING SYSTEM VALUE SELECT ${cols} FROM jsonb_populate_recordset(NULL::public.${quote(t.name)}, $1::jsonb)`, [JSON.stringify(t.rows.slice(i,i+100))]);
        }
        for(const col of t.columns) {
          const {rows:[s]}=await db.query('SELECT pg_get_serial_sequence($1,$2) AS name', ['public.'+quote(t.name),col]);
          if(s.name) await db.query(`SELECT setval($1, COALESCE((SELECT max(${quote(col)}) FROM public.${quote(t.name)}),1), EXISTS(SELECT 1 FROM public.${quote(t.name)}))`,[s.name]);
        }
        done.add(t.name);
      }
    }
    const report=[];
    for (const t of snapshot.tables) {
      const {rows}=await db.query(`SELECT to_jsonb(t) AS row FROM public.${quote(t.name)} t`);
      if(rows.length!==t.count || digest(rows.map(r=>r.row))!==t.sha256) throw Error('Target differs: '+t.name);
      report.push({table:t.name,rows:t.count,verified:true});
    }
    await db.query('COMMIT');
    console.log(JSON.stringify({mode,tables:report,totalRows:report.reduce((n,t)=>n+t.rows,0)}));
  } catch(e) { await db.query('ROLLBACK'); throw e; }
  finally {await db.end();}
} else throw Error('Use export, import or verify');

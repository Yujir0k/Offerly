import { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
const db = await pool.connect();
try {
  await db.query("SELECT pg_advisory_lock(71422310)");
  await db.query(
    "CREATE TABLE IF NOT EXISTS schema_migrations(id text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
  );
  await db.query(
    "CREATE TABLE IF NOT EXISTS migration_checksums(id text PRIMARY KEY REFERENCES schema_migrations(id), checksum text NOT NULL)",
  );
  for (const file of (await readdir("db/migrations"))
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort()) {
    const id = file.replace(/\.sql$/, ""),
      sql = await readFile("db/migrations/" + file, "utf8"),
      hash = createHash("sha256").update(sql).digest("hex");
    const {
      rows: [existing],
    } = await db.query(
      "SELECT m.id,c.checksum FROM schema_migrations m LEFT JOIN migration_checksums c ON c.id=m.id WHERE m.id=$1",
      [id],
    );
    if (existing) {
      if (existing.checksum && existing.checksum !== hash)
        throw new Error("Applied migration has changed: " + id);
      continue;
    }
    await db.query("BEGIN");
    try {
      await db.query(sql);
      await db.query(
        "INSERT INTO schema_migrations(id) VALUES ($1) ON CONFLICT DO NOTHING",
        [id],
      );
      await db.query(
        "INSERT INTO migration_checksums(id,checksum) VALUES ($1,$2)",
        [id, hash],
      );
      await db.query("COMMIT");
      console.log("Applied " + id);
    } catch (e) {
      await db.query("ROLLBACK");
      throw e;
    }
  }
  // Only the release job holds the owner credential. Runtime cannot create roles/schema or run migrations.
  const runtimePassword = process.env.POSTGRES_APP_PASSWORD;
  if (runtimePassword) {
    if (!/^[a-zA-Z0-9_-]{32,128}$/.test(runtimePassword)) throw new Error("POSTGRES_APP_PASSWORD must be a distinct 32–128 character URL-safe secret");
    const owner = await db.query("SELECT current_user AS name");
    const quote = value => '"' + value.replaceAll('"','""') + '"';
    await db.query("BEGIN");
    try {
      await db.query("DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='offerly_runtime') THEN CREATE ROLE offerly_runtime LOGIN; END IF; END $$");
      await db.query(`ALTER ROLE offerly_runtime WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD '${runtimePassword}'`);
      await db.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
      await db.query("GRANT USAGE ON SCHEMA public TO offerly_runtime");
      await db.query("GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO offerly_runtime");
      await db.query("REVOKE ALL ON schema_migrations,migration_checksums FROM offerly_runtime");
      // Health checks may read migration IDs, but can never alter migration history.
      await db.query("GRANT SELECT ON schema_migrations TO offerly_runtime");
      await db.query("GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO offerly_runtime");
      await db.query("GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO offerly_runtime");
      // Bootstrap re-grants after each release; future owner-created data tables inherit only DML.
      await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner.rows[0].name)} IN SCHEMA public GRANT SELECT,INSERT,UPDATE,DELETE ON TABLES TO offerly_runtime`);
      await db.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${quote(owner.rows[0].name)} IN SCHEMA public GRANT USAGE,SELECT ON SEQUENCES TO offerly_runtime`);
      await db.query("COMMIT");
      console.log("Runtime database privileges configured");
    } catch (e) { await db.query("ROLLBACK"); throw e; }
  }
} finally {
  await db.query("SELECT pg_advisory_unlock(71422310)");
  db.release();
  await pool.end();
}

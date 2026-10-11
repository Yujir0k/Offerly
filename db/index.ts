import { Pool, type PoolClient, type QueryResultRow } from "pg";
import { readFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";
export interface Database {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  transaction<T>(fn: (db: Database) => Promise<T>): Promise<T>;
}
const globals = globalThis as typeof globalThis & {
  offerlyDb?: Promise<Database>;
};
async function connect(): Promise<Database> {
  if (process.env.DATABASE_URL) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 20,
      statement_timeout: 15000,
      idle_in_transaction_session_timeout: 30000,
      application_name: "offerly-web",
      connectionTimeoutMillis: 5000,
    });
    const wrap = (client: Pool | PoolClient): Database => ({
      query: async <T extends QueryResultRow>(sql: string, params?: unknown[]) => client.query<T>(sql, params),
      async transaction(fn) {
        const c = await pool.connect();
        try {
          await c.query("BEGIN");
          const result = await fn(wrap(c));
          await c.query("COMMIT");
          return result;
        } catch (e) {
          await c.query("ROLLBACK");
          throw e;
        } finally {
          c.release();
        }
      },
    });
    const db = wrap(pool);
    // Production applies migrations explicitly in the release job, never during a request.
    return db;
  }
  if (process.env.NODE_ENV === "production")
    throw new Error("DATABASE_URL is required in production");
  const { PGlite } = await import("@electric-sql/pglite");
  const dataPath =
    process.env.PGLITE_PATH || path.join(process.cwd(), ".data/postgres");
  await mkdir(path.dirname(path.resolve(dataPath)), { recursive: true });
  const pg = new PGlite(dataPath);
  await pg.waitReady;
  const migrationDir = path.join(process.cwd(), "db/migrations");
  for (const file of (await readdir(migrationDir))
    .filter((f) => /^\d{3}_[a-z0-9_]+\.sql$/.test(f))
    .sort())
    await pg.exec(await readFile(path.join(migrationDir, file), "utf8"));
  const wrap = (client: Pick<typeof pg, "query">): Database => ({
    query: <T extends QueryResultRow>(sql: string, params: unknown[] = []) => client.query<T>(sql, params),
    transaction: (fn) => pg.transaction((tx) => fn(wrap(tx))),
  });
  return wrap(pg);
}
export async function getDb() {
  return (globals.offerlyDb ||= connect().catch((error) => {
    globals.offerlyDb = undefined;
    throw error;
  }));
}
export async function query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []) {
  return (await getDb()).query<T>(sql, params);
}

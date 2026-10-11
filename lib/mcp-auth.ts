import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { getDb, type Database } from "@/db";
import type { Account } from "@/lib/platform";
import { currentAccount, throttle } from "@/lib/auth";
import { McpError, assertMcpEnabled } from "./mcp-policy";

export type McpContext = { account: Account; companyId: string; db: Database };
export const mcpHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const keyCache = globalThis as typeof globalThis & {
  offerlyMcpKey?: Promise<Buffer>;
};

/** Preserve a useful 429 response without exposing internal database errors. */
export async function mcpThrottle(key: string, limit: number, seconds = 60) {
  try {
    await throttle(key, limit, seconds);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "Слишком много попыток. Попробуйте позже"
    )
      throw new McpError(error.message, 429);
    throw error;
  }
}

async function encryptionKey(): Promise<Buffer> {
  if (process.env.MCP_TOKEN_ENCRYPTION_KEY) {
    if (!/^[a-fA-F0-9]{64}$/.test(process.env.MCP_TOKEN_ENCRYPTION_KEY))
      throw new McpError("Проверьте ключ хранения MCP.", 503);
    return Buffer.from(process.env.MCP_TOKEN_ENCRYPTION_KEY, "hex");
  }
  if (process.env.NODE_ENV === "production")
    throw new McpError("Настройте ключ хранения MCP в локальном контуре.", 503);
  const dir = path.join(process.cwd(), ".data");
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, "mcp-token.key");
  try {
    await writeFile(file, randomBytes(32), { flag: "wx", mode: 0o600 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  const key = await readFile(file);
  if (key.length !== 32)
    throw new McpError("Проверьте ключ хранения MCP.", 503);
  return key;
}
async function key() {
  return (keyCache.offerlyMcpKey ||= encryptionKey().catch((error) => {
    keyCache.offerlyMcpKey = undefined;
    throw error;
  }));
}
async function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", await key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64url",
  );
}
async function decrypt(value: string) {
  const packed = Buffer.from(value, "base64url");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    await key(),
    packed.subarray(0, 12),
  );
  decipher.setAuthTag(packed.subarray(-16));
  return Buffer.concat([
    decipher.update(packed.subarray(12, -16)),
    decipher.final(),
  ]).toString("utf8");
}

/** Membership is checked in both browser management and every MCP request. */
async function contextForAccount(account: Account): Promise<McpContext> {
  assertMcpEnabled();
  if (account.deleted_at) throw new McpError("Аккаунт недоступен.", 403);
  const db = await getDb();
  const {
    rows: [member],
  } = await db.query<{ company_id: string; role: string }>(
    `SELECT m.company_id,m.role FROM company_memberships m JOIN companies c ON c.id=m.company_id
     JOIN users owner ON owner.id=c.owner_id WHERE m.user_id=$1 AND c.scope=$2 AND owner.deleted_at IS NULL
     AND length(btrim(coalesce(c.payload->>'name','')))>0
     ORDER BY CASE m.role WHEN 'owner' THEN 0 ELSE 1 END,c.id LIMIT 1`,
    [account.id, account.scope],
  );
  if (!member || !["owner", "recruiter"].includes(member.role))
    throw new McpError("Нет прав работодателя.", 403);
  return { account, db, companyId: member.company_id };
}

/** Browser-only token management does not accept the agent's bearer as HR approval. */
export async function mcpOwner(): Promise<McpContext> {
  const account = await currentAccount();
  if (!account || account.deleted_at)
    throw new McpError("Нужно войти в аккаунт.", 401);
  return contextForAccount(account);
}

/** One revocable API credential per employer; no extra roles, audit or expiry settings. */
export async function createMcpToken(context: McpContext) {
  const token = `omcp_${randomBytes(32).toString("base64url")}`;
  const encrypted = await encrypt(token);
  await context.db.query(
    `INSERT INTO mcp_employer_tokens(user_id,company_id,token_hash,encrypted_token) VALUES($1,$2,$3,$4)
    ON CONFLICT(user_id) DO UPDATE SET company_id=excluded.company_id,token_hash=excluded.token_hash,encrypted_token=excluded.encrypted_token,created_at=now()`,
    [context.account.id, context.companyId, mcpHash(token), encrypted],
  );
  return token;
}

/** Reveal is an explicit same-origin HR action; the reusable token remains encrypted at rest. */
export async function revealMcpToken(context: McpContext) {
  const {
    rows: [row],
  } = await context.db.query<{ encrypted_token: string }>(
    "SELECT encrypted_token FROM mcp_employer_tokens WHERE user_id=$1 AND company_id=$2",
    [context.account.id, context.companyId],
  );
  if (!row) throw new McpError("Сначала создайте API-токен.", 404);
  return decrypt(row.encrypted_token);
}

/** Every credential is bound to its employer and current company membership. */
export async function authenticateMcp(request: Request): Promise<McpContext> {
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer omcp_[a-zA-Z0-9_-]{43}$/.test(authorization))
    throw new McpError("Требуется API-токен работодателя.", 401);
  const db = await getDb();
  const {
    rows: [row],
  } = await db.query<{ account: Account; company_id: string }>(
    `SELECT json_build_object('id',u.id,'email',u.email,'name',u.name,'scope',u.scope,'demo',u.demo,'verified_at',u.verified_at,'deleted_at',u.deleted_at) AS account,t.company_id
     FROM mcp_employer_tokens t JOIN users u ON u.id=t.user_id WHERE t.token_hash=$1 AND u.deleted_at IS NULL`,
    [mcpHash(authorization.slice(7))],
  );
  if (!row) throw new McpError("Токен недействителен или отключён.", 401);
  const context = await contextForAccount(row.account);
  if (context.companyId !== row.company_id)
    throw new McpError("Доступ к компании изменился.", 403);
  await mcpThrottle(`mcp:${context.account.id}`, 60);
  return context;
}

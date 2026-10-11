import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { cookies } from "next/headers";
import { currentAccount, digest, SESSION_COOKIE, logout } from "@/lib/auth";
import { query } from "@/db";
import { checkOrigin, errorResponse } from "@/lib/store";
async function context() {
  const account = await currentAccount();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!account || !token) throw new Error("AUTH");
  return { account, hash: digest(token) };
}
async function list(user: string, hash: string) {
  const { rows } = await query(
    'SELECT id,device_name AS name,device_type AS type,token_hash=$2 AS current,created_at AS "createdAt",last_seen_at AS "lastSeenAt",expires_at AS "expiresAt" FROM sessions WHERE user_id=$1 AND expires_at>now() ORDER BY (token_hash=$2) DESC,last_seen_at DESC,id',
    [user, hash],
  );
  return rows;
}
export async function GET() {
  try {
    const { account, hash } = await context();
    return Response.json(
      { sessions: await list(account.id, hash) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const { account, hash } = await context();
    const raw = await readRequestText(request, 6000);
    if (raw.length > 1000) throw new Error("Слишком большой запрос");
    const body = parseRequestJson(raw);
    if (body.action === "logout") {
      await logout();
      return Response.json({ loggedOut: true });
    }
    if (body.action === "others")
      await query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [
        account.id,
        hash,
      ]);
    else if (
      body.action === "revoke" &&
      typeof body.id === "string" &&
      body.id.length <= 100
    ) {
      await query(
        "DELETE FROM sessions WHERE user_id=$1 AND id=$2 AND token_hash<>$3",
        [account.id, body.id, hash],
      );
    } else throw new Error("Выберите сеанс для завершения");
    return Response.json(
      { sessions: await list(account.id, hash) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}

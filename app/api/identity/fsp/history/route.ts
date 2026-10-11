import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { currentAccount, throttle } from "@/lib/auth";
import { checkOrigin, errorResponse } from "@/lib/store";
import { query } from "@/db";
import { syncDemoFspHistory } from "@/lib/fsp-history";
import { FspRegistryError } from "@/lib/fsp-registry";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const account = await currentAccount();
  if (!account)
    return Response.json({ error: "Требуется вход" }, { status: 401, headers });
  const {
    rows: [row],
  } = await query("SELECT payload FROM candidate_profiles WHERE user_id=$1", [
    account.id,
  ]);
  return Response.json(
    {
      source: account.demo ? "demo" : "unavailable",
      participantId: row?.payload.fsp || null,
      achievements: row?.payload.achievements || [],
      syncedAt: row?.payload.fspHistory?.syncedAt || null,
      message: account.demo
        ? "Демонстрационный реестр: синтетические достижения."
        : "Контракт API достижений ФСП ещё не предоставлен.",
    },
    { headers },
  );
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const account = await currentAccount();
    if (!account)
      return Response.json(
        { error: "Требуется вход" },
        { status: 401, headers },
      );
    if (!account.demo)
      throw new FspRegistryError(
        "Контракт API достижений ФСП ещё не предоставлен. Демоданные не добавлены.",
        503,
      );
    await throttle("fsp-history:" + account.id, 30, 60);
    const text = await readRequestText(request, 6000);
    if (text.length > 500)
      throw new FspRegistryError("Запрос слишком большой.", 400);
    let body;
    try {
      body = parseRequestJson(text);
    } catch {
      throw new FspRegistryError("Проверьте запрос.", 400);
    }
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new FspRegistryError("Проверьте запрос.", 400);
    return Response.json(await syncDemoFspHistory(account, body.id), {
      headers,
    });
  } catch (error) {
    if (error instanceof FspRegistryError)
      return Response.json(
        { error: error.message },
        { status: error.status, headers },
      );
    return errorResponse(error);
  }
}

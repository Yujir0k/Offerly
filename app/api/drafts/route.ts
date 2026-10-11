import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { query } from "@/db";
import { workspace, checkOrigin, errorResponse } from "@/lib/store";
async function context(r: Request) {
  const { owner } = await workspace();
  const key = new URL(r.url).searchParams.get("key") || "";
  if (
    !/^(registration|profile|company|survey|catalog|assessment|task|need|job|settings|invite|setup)(:[a-zA-Z0-9_-]{1,80})?$/.test(
      key,
    )
  )
    throw new Error("Недопустимый черновик");
  return { owner, id: owner + ":" + key };
}
export async function GET(r: Request) {
  try {
    const { owner, id } = await context(r);
    const {
      rows: [row],
    } = await query(
      "SELECT payload,updated_at FROM drafts WHERE id=$1 AND user_id=$2",
      [id, owner],
    );
    return Response.json(
      { value: row?.payload || null, updatedAt: row?.updated_at },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
export async function PUT(r: Request) {
  try {
    checkOrigin(r);
    const { owner, id } = await context(r);
    const text = await readRequestText(r, 240000);
    if (text.length > 60000) throw new Error("Черновик слишком большой");
    const body = parseRequestJson(text);
    if (body.value === undefined) throw new Error("Нет данных черновика");
    const {
      rows: [row],
    } = await query(
      "INSERT INTO drafts(id,user_id,payload) VALUES ($1,$2,$3) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=now() RETURNING updated_at",
      [id, owner, JSON.stringify(body.value)],
    );
    return Response.json({ saved: true, updatedAt: row.updated_at });
  } catch (e) {
    return errorResponse(e);
  }
}

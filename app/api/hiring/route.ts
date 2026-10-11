import { currentAccount, throttle } from "@/lib/auth";
import { checkOrigin, errorResponse } from "@/lib/store";
import { chatBody, chatRole } from "@/lib/conversations";
import { hiringOperation, HiringError } from "@/lib/hiring";
export const runtime = "nodejs";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const a = await currentAccount();
    if (!a) throw Error("AUTH");
    if (!a.demo && !a.verified_at)
      throw new HiringError("Подтвердите почту", 403);
    const b = await chatBody(r, 16000);
    await throttle("hiring:" + a.id, 180, 60);
    return Response.json(await hiringOperation(a, chatRole(r), b), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return e instanceof HiringError
      ? Response.json(
          { error: e.message },
          { status: e.status, headers: { "Cache-Control": "no-store" } },
        )
      : errorResponse(e);
  }
}

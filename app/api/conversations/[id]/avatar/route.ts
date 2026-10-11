import { currentAccount } from "@/lib/auth";
import { errorResponse } from "@/lib/store";
import { ChatError, conversationAvatar } from "@/lib/conversations";
export const runtime = "nodejs";
export async function GET(
  r: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const account = await currentAccount();
    if (!account) throw Error("AUTH");
    const { id } = await context.params;
    const role =
      new URL(r.url).searchParams.get("role") === "employer"
        ? "employer"
        : "candidate";
    return await conversationAvatar(account, role, id);
  } catch (e) {
    return e instanceof ChatError
      ? new Response(null, { status: e.status })
      : errorResponse(e);
  }
}

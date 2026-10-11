import { currentAccount, throttle } from "@/lib/auth";
import { checkOrigin, errorResponse } from "@/lib/store";
import {
  ChatError,
  chatBody,
  chatRole,
  readConversation,
  changeConversation,
} from "@/lib/conversations";
export const runtime = "nodejs";
const response = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });
type Context = { params: Promise<{ id: string }> };
export async function GET(r: Request, context: Context) {
  try {
    const account = await currentAccount();
    if (!account) throw Error("AUTH");
    const { id } = await context.params;
    return response(
      await readConversation(
        account,
        chatRole(r),
        id,
        new URL(r.url).searchParams.get("before"),
      ),
    );
  } catch (e) {
    return e instanceof ChatError
      ? Response.json({ error: e.message }, { status: e.status })
      : errorResponse(e);
  }
}
export async function POST(r: Request, context: Context) {
  try {
    checkOrigin(r);
    const account = await currentAccount();
    if (!account) throw Error("AUTH");
    const { id } = await context.params;
    const input = await chatBody(r, 24000);
    await throttle(
      "chat-" + (input.type === "read" ? "read:" : input.type === "task-draft" ? "draft:" : "send:") + account.id,
      input.type === "read" ? 240 : input.type === "task-draft" ? 120 : 40,
      60,
    );
    return response(await changeConversation(account, chatRole(r), id, input));
  } catch (e) {
    return e instanceof ChatError
      ? Response.json({ error: e.message }, { status: e.status })
      : errorResponse(e);
  }
}

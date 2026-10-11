import { currentAccount, throttle } from "@/lib/auth";
import { checkOrigin, errorResponse } from "@/lib/store";
import {
  ChatError,
  chatBody,
  chatRole,
  listConversations,
  openConversation,
  unreadConversations,
  readConversation,
  changeConversation,
} from "@/lib/conversations";
export const runtime = "nodejs";
const response = (value: unknown) =>
  Response.json(value, { headers: { "Cache-Control": "no-store" } });
export async function GET(r: Request) {
  try {
    const account = await currentAccount();
    if (!account) throw Error("AUTH");
    const params = new URL(r.url).searchParams;
    if (params.get('id')) {
      const data = await readConversation(account, chatRole(r), params.get('id')!, params.get('before'));
      return response({ ...data, canWrite:data.conversation.canWrite, messages:data.messages.map(m=>({...m,text:m.body,senderRole:m.mine?chatRole(r):chatRole(r)==='candidate'?'employer':'candidate'})),hasMore:data.hasOlder });
    }
    return response(
      params.get("summary") === "1"
        ? await unreadConversations(account, chatRole(r))
        : await listConversations(account, chatRole(r), params.get("before")),
    );
  } catch (e) {
    return e instanceof ChatError
      ? Response.json({ error: e.message }, { status: e.status })
      : errorResponse(e);
  }
}
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const account = await currentAccount();
    if (!account) throw Error("AUTH");
    const input = await chatBody(r, 24000);
    const role = r.headers.has('X-Offerly-Role') ? chatRole(r) : input.role === 'employer' ? 'employer' : 'candidate';
    if (['send','task-response','task-review','task-draft','read'].includes(String(input.type))) {
      await throttle((input.type==='task-draft'?'chat-draft:':'chat-send:')+account.id,input.type==='task-draft'?120:40,60);
      const data = await changeConversation(account,role,String(input.id || input.conversationId || ''), input.type === 'send' ? {...input,type:'message',body:input.text} : input);
      return response({...data,...('message' in data ? {id:data.message?.id} : {})});
    }
    await throttle("chat-open:" + account.id, 30, 60);
    return response(await openConversation(account, role, input));
  } catch (e) {
    return e instanceof ChatError
      ? Response.json({ error: e.message }, { status: e.status })
      : errorResponse(e);
  }
}

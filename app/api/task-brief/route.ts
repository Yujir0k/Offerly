import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { throttle } from '@/lib/auth';
import { checkOrigin, errorResponse, workspace } from '@/lib/store';
import { parseTaskBrief } from '@/lib/task-brief';

/** Parse a bounded employer description locally, returning evidence and editable conditions. */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const raw = await readRequestText(request, 48000);
    if (raw.length > 16000) throw new Error('Слишком большой запрос');
    const body = parseRequestJson(raw) as Record<string, unknown>;
    if (body?.role !== 'employer')
      throw new Error('Доступно только работодателю');
    if (
      typeof body.text !== 'string' ||
      body.text.trim().length < 10 ||
      body.text.length > 3000
    )
      throw new Error('Опишите задачу: от 10 до 3000 символов.');
    const { account } = await workspace();
    await throttle(`task-brief:${account.id}`, 60, 60);
    return Response.json(parseTaskBrief(body.text), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    if (error instanceof SyntaxError)
      return Response.json({ error: 'Проверьте запрос' }, { status: 400 });
    return errorResponse(error);
  }
}

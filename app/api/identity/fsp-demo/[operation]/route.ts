import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { NextResponse } from 'next/server';
import { checkOrigin } from '@/lib/store';
import { createDemo } from '@/lib/demo-platform';
import {
  startDemoFsp,
  finishDemoFsp,
  linkDemoFsp,
  syncDemoFsp,
  unlinkDemoFsp,
  demoFspConfig,
  DemoFspError,
} from '@/lib/fsp-demo';
export const dynamic = 'force-dynamic';
export async function POST(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  try {
    checkOrigin(request);
    const { operation } = await context.params;
    const text = await readRequestText(request, 12000);
    if (text.length > 1000) throw new DemoFspError('Запрос слишком большой');
    if (operation === 'unlink') return Response.json(await unlinkDemoFsp(), {headers:{'Cache-Control':'no-store'}});
    if (operation === 'sync')
      return Response.json(await syncDemoFsp(), {
        headers: { 'Cache-Control': 'no-store' },
      });
    if (operation !== 'start')
      return Response.json({ error: 'Неизвестный метод' }, { status: 404 });
    const body = parseRequestJson(text);
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw new DemoFspError('Некорректный запрос');
    return Response.json(await startDemoFsp(body), {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof DemoFspError
            ? error.message
            : 'Не удалось выполнить демонстрационное подключение',
      },
      {
        status: error instanceof DemoFspError ? error.status : 400,
        headers: { 'Cache-Control': 'no-store' },
      },
    );
  }
}
export async function GET(
  request: Request,
  context: { params: Promise<{ operation: string }> },
) {
  const { operation } = await context.params;
  if (operation !== 'callback')
    return Response.json({ error: 'Неизвестный метод' }, { status: 404 });
  const base = process.env.APP_URL || new URL(request.url).origin;
  const redirect = (to: string) => {
    const response = NextResponse.redirect(new URL(to, base), 303);
    response.headers.set('Cache-Control', 'no-store');
    response.headers.set('Referrer-Policy', 'no-referrer');
    return response;
  };
  try {
    demoFspConfig();
    const { flow, account, cancelled, identity } = await finishDemoFsp(request);
    if (cancelled)
      return redirect(
        account
          ? `/demo/${flow.role}/settings?fspDemo=cancelled`
          : `/login?role=${flow.role}&fspDemo=cancelled`,
      );
    const own = account || (await createDemo());
    await linkDemoFsp(own, identity!);
    return redirect(`/demo/${flow.role}/settings?fspDemo=linked`);
  } catch (error) {
    console.error('FSP demo callback rejected', {
      name: error instanceof Error ? error.name : 'UnknownError',
      code:
        error && typeof error === 'object' && 'code' in error
          ? error.code
          : null,
    });
    return redirect('/login?role=candidate&fspDemo=failed');
  }
}

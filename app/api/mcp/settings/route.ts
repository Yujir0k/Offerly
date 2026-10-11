import path from 'node:path';
import { mcpOwner, createMcpToken, revealMcpToken, mcpThrottle } from '@/lib/mcp-auth';
import { checkMcpBrowser, readMcpBody, mcpErrorResponse, mcpOrigin, McpError } from '@/lib/mcp-policy';
import { closeMcpSseOwner } from '@/lib/mcp-sse';

async function info(context: Awaited<ReturnType<typeof mcpOwner>>) {
  const tokens = await context.db.query('SELECT user_id FROM mcp_employer_tokens WHERE user_id=$1 AND company_id=$2', [context.account.id, context.companyId]);
  return { status: 'running', hasToken: tokens.rows.length > 0, sseUrl: `${mcpOrigin()}/api/mcp/sse`,
    bridgePath: process.env.MCP_STDIO_SCRIPT_PATH || (process.env.NODE_ENV === 'production' ? '/путь/на/компьютере/offerly-web/scripts/mcp-stdio.mjs' : path.join(process.cwd(), 'scripts/mcp-stdio.mjs')),
    tools: ['search_candidates', 'get_candidate_profile', 'draft_invitation'], directSending: false, data: context.account.demo ? 'synthetic-only' : 'employer-catalog' };
}

export async function GET() {
  try { return Response.json(await info(await mcpOwner()), { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return mcpErrorResponse(error); }
}

/** Secrets are only revealed through explicit same-origin browser actions, never in /api/state. */
export async function POST(request: Request) {
  try {
    checkMcpBrowser(request);
    const context = await mcpOwner();
    await mcpThrottle(`mcp-settings:${context.account.id}`, 15);
    const body = JSON.parse(await readMcpBody(request, 1000));
    if (body.action === 'create' || body.action === 'rotate') {
      const exists = await context.db.query('SELECT user_id FROM mcp_employer_tokens WHERE user_id=$1', [context.account.id]);
      if (body.action === 'create' && exists.rows.length) throw new McpError('Токен уже создан. Используйте копирование или замену.', 409);
      const token = await createMcpToken(context);
      closeMcpSseOwner(context.account.id);
      return Response.json({ ...await info(context), token }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    }
    if (body.action === 'reveal') return Response.json({ token: await revealMcpToken(context) }, { headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } });
    if (body.action === 'revoke') {
      await context.db.query('DELETE FROM mcp_employer_tokens WHERE user_id=$1 AND company_id=$2', [context.account.id, context.companyId]);
      closeMcpSseOwner(context.account.id);
      return Response.json(await info(context), { headers: { 'Cache-Control': 'no-store' } });
    }
    throw new McpError('Выберите действие с подключением.');
  } catch (error) { return mcpErrorResponse(error); }
}

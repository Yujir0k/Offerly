import { mcpOwner, mcpThrottle } from '@/lib/mcp-auth';
import { listMcpDrafts, decideMcpDraft } from '@/lib/mcp-drafts';
import { checkMcpBrowser, mcpErrorResponse, readMcpBody, McpError } from '@/lib/mcp-policy';

export async function GET() {
  try { return Response.json({ drafts: await listMcpDrafts(await mcpOwner()) }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch (error) { return mcpErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    checkMcpBrowser(request);
    const context = await mcpOwner();
    await mcpThrottle(`mcp-approval:${context.account.id}`, 30);
    const body = JSON.parse(await readMcpBody(request, 1000));
    if (typeof body.id !== 'string' || body.id.length > 80 || !['approve', 'delete'].includes(body.action)) throw new McpError('Выберите черновик и действие.');
    const state = await decideMcpDraft(context, body.id, body.action);
    return Response.json({ drafts: await listMcpDrafts(context), state }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return mcpErrorResponse(error); }
}

import { authenticateMcp } from '@/lib/mcp-auth';
import { checkMcpTransport, readMcpBody, mcpErrorResponse, McpError } from '@/lib/mcp-policy';
import { handleMcpMessage, mcpVersions } from '@/lib/mcp-protocol';
export const runtime = 'nodejs';
/** Optional modern JSON transport shares exactly the same tools and bearer checks as SSE. */
export async function POST(request: Request) {
  try {
    checkMcpTransport(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new McpError('Требуется JSON.');
    const version = request.headers.get('mcp-protocol-version');
    if (version && !mcpVersions.includes(version)) throw new McpError('Версия протокола не поддерживается.');
    const context = await authenticateMcp(request);
    const result = await handleMcpMessage(context, JSON.parse(await readMcpBody(request)));
    return result ? Response.json(result, { headers: { 'Cache-Control': 'no-store' } }) : new Response(null, { status: 202 });
  } catch (error) { return mcpErrorResponse(error); }
}
export async function GET(request: Request) {
  try { checkMcpTransport(request); await authenticateMcp(request); return new Response(null, { status: 405, headers: { Allow: 'POST' } }); }
  catch (error) { return mcpErrorResponse(error); }
}

import { authenticateMcp, mcpHash } from '@/lib/mcp-auth';
import { checkMcpTransport, readMcpBody, mcpErrorResponse, McpError } from '@/lib/mcp-policy';
import { assertMcpSseSession, sendMcpSse } from '@/lib/mcp-sse';
import { handleMcpMessage } from '@/lib/mcp-protocol';
export const runtime = 'nodejs';
export async function POST(request: Request) {
  try {
    checkMcpTransport(request);
    if (!request.headers.get('content-type')?.startsWith('application/json')) throw new McpError('Требуется JSON.');
    const context = await authenticateMcp(request);
    const id = new URL(request.url).searchParams.get('sessionId') || '';
    assertMcpSseSession(id, context.account.id, mcpHash(request.headers.get('authorization') || ''));
    const result = await handleMcpMessage(context, JSON.parse(await readMcpBody(request)));
    if (result) sendMcpSse(id, result);
    return new Response(null, { status: 202, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return mcpErrorResponse(error); }
}

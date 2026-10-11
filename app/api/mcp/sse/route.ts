import { authenticateMcp, mcpHash } from '@/lib/mcp-auth';
import { checkMcpTransport, mcpErrorResponse, McpError } from '@/lib/mcp-policy';
import { createMcpSse } from '@/lib/mcp-sse';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  try {
    checkMcpTransport(request);
    if (!request.headers.get('accept')?.includes('text/event-stream')) throw new McpError('Требуется SSE-клиент.', 406);
    const context = await authenticateMcp(request);
    return new Response(createMcpSse(context.account.id, mcpHash(request.headers.get('authorization') || ''), request.signal), {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' },
    });
  } catch (error) { return mcpErrorResponse(error); }
}

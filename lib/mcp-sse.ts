import { randomUUID } from 'node:crypto';
import { McpError } from './mcp-policy';

type Connection = { owner: string; tokenHash: string; controller: ReadableStreamDefaultController<Uint8Array>; timer?: ReturnType<typeof setInterval> };
const globalConnections = globalThis as typeof globalThis & { offerlyMcpConnections?: Map<string, Connection> };
const connections = globalConnections.offerlyMcpConnections ||= new Map<string, Connection>();
const encoder = new TextEncoder();

function close(id: string) {
  const connection = connections.get(id);
  if (!connection) return;
  clearInterval(connection.timer);
  connections.delete(id);
  try { connection.controller.close(); } catch {}
}

/** Process-local SSE is appropriate for the single backend instance in the local compose stack. */
export function createMcpSse(owner: string, tokenHash: string, signal: AbortSignal) {
  if (connections.size >= 100 || [...connections.values()].filter(c => c.owner === owner).length >= 3)
    throw new McpError('Закройте неиспользуемые соединения MCP.', 429);
  const id = randomUUID();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      connections.set(id, { owner, tokenHash, controller });
      controller.enqueue(encoder.encode(`event: endpoint\ndata: /api/mcp/messages?sessionId=${id}\n\n`));
      const connection = connections.get(id)!;
      connection.timer = setInterval(() => {
        try { controller.enqueue(encoder.encode(': keepalive\n\n')); } catch { close(id); }
      }, 15000);
      signal.addEventListener('abort', () => close(id), { once: true });
      if (signal.aborted) close(id);
    },
    cancel() { close(id); },
  });
  return stream;
}

/** A guessed or another employer's session cannot receive responses or trigger tool calls. */
export function assertMcpSseSession(id: string, owner: string, tokenHash: string) {
  const connection = connections.get(id);
  if (!connection || connection.owner !== owner || connection.tokenHash !== tokenHash) throw new McpError('Соединение MCP недоступно.', 403);
}

export function sendMcpSse(id: string, message: unknown) {
  const connection = connections.get(id);
  if (!connection) throw new McpError('Соединение MCP закрыто.', 409);
  try { connection.controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`)); }
  catch { close(id); throw new McpError('Соединение MCP закрыто.', 409); }
}

/** Token rotation and disconnect immediately close live streams as well as invalidating requests. */
export function closeMcpSseOwner(owner: string) {
  for (const [id, connection] of connections) if (connection.owner === owner) close(id);
}

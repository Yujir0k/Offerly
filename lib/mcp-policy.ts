export class McpError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Canonical server address is deployment-owned, never inferred from a foreign Host header. */
export function mcpOrigin() {
  const url = new URL(process.env.APP_URL || 'http://localhost:5174');
  return url.origin;
}

/** Deployment controls availability; tool arguments cannot change the data scope. */
export function assertMcpEnabled() {
  const enabled = process.env.MCP_ENABLED ?? process.env.MCP_DEMO_ENABLED;
  if (enabled === 'false' || (process.env.NODE_ENV === 'production' && enabled !== 'true'))
    throw new McpError('Подключение MCP отключено на сервере.', 503);
}

/** Bound UTF-8 body bytes before buffering the entire request. */
export async function readMcpBody(request: Request, max = 16384) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytes += chunk.value.byteLength;
    if (bytes > max) { await reader.cancel(); throw new McpError('Слишком большой запрос.', 413); }
    chunks.push(chunk.value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** Bearer requests have no cookie authority; reject foreign Origins and DNS rebinding. */
export function checkMcpTransport(request: Request) {
  assertMcpEnabled();
  const origin = request.headers.get('origin');
  if (origin && origin !== mcpOrigin()) throw new McpError('Недопустимый источник запроса.', 403);
  // Next standalone constructs request.url from its internal bind address behind the gateway.
  // Validate the actual Host instead; never trust X-Forwarded-Host for MCP authority.
  if (request.headers.get('host')?.toLowerCase() !== new URL(mcpOrigin()).host)
    throw new McpError('Недопустимый адрес сервера.', 403);
}

/** Management and manual approval require the browser's exact Origin as well as its session. */
export function checkMcpBrowser(request: Request) {
  if (request.headers.get('origin') !== mcpOrigin()) throw new McpError('Недопустимый источник запроса.', 403);
}

/** Never return raw arguments, SQL, database errors or credentials in errors. */
export function mcpErrorResponse(error: unknown) {
  if (error instanceof SyntaxError) error = new McpError('Некорректный JSON.');
  const known = error instanceof McpError ? error : null;
  return Response.json({ error: known ? known.message : 'Не удалось выполнить действие MCP.' }, {
    status: known ? known.status : 500,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
  });
}

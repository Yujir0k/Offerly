import { createInterface } from 'node:readline';

// Local stdio ↔ authenticated SSE bridge. No cloud requests or third-party packages.
const url = new URL(process.env.OFFERLY_MCP_SSE_URL || 'http://localhost:5173/api/mcp/sse');
const token = process.env.OFFERLY_MCP_TOKEN || '';
if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.pathname !== '/api/mcp/sse' || url.search || url.username || url.password || !/^omcp_[a-zA-Z0-9_-]{43}$/.test(token)) {
  process.stderr.write('Offerly MCP: нужен локальный SSE URL и API-токен из кабинета.\n');
  process.exit(1);
}
const stop = new AbortController();
const headers = { Authorization: `Bearer ${token}` };
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.pause();
const lines = input[Symbol.asyncIterator]();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stop.abort(); input.close(); });
let endpoint;
let resolveEndpoint;
let rejectEndpoint;
const ready = new Promise((resolve, reject) => { resolveEndpoint = resolve; rejectEndpoint = reject; });
const timer = setTimeout(() => rejectEndpoint(new Error('SSE endpoint timeout')), 10000);

async function listen() {
  const response = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' }, signal: stop.signal, redirect: 'error' });
  if (!response.ok || !response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('SSE unavailable');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true }).replaceAll('\r\n', '\n');
    if (buffer.length > 131072) throw new Error('SSE frame too large');
    let split;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const event = frame.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
      const data = frame.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
      if (event === 'endpoint') {
        const next = new URL(data, url);
        if (next.origin !== url.origin || next.pathname !== '/api/mcp/messages' || !next.searchParams.get('sessionId')) throw new Error('Unexpected SSE endpoint');
        endpoint = next;
        clearTimeout(timer);
        resolveEndpoint();
      } else if (event === 'message') {
        const message = JSON.parse(data);
        if (message.jsonrpc !== '2.0') throw new Error('Invalid MCP response');
        process.stdout.write(JSON.stringify(message) + '\n');
      }
    }
  }
  if (!stop.signal.aborted) throw new Error('SSE disconnected');
}

function fail() {
  clearTimeout(timer);
  rejectEndpoint(new Error('SSE unavailable'));
  stop.abort();
  input.close();
  process.stderr.write('Offerly MCP: соединение закрыто. Проверьте сайт и токен в кабинете.\n');
  process.exitCode = 1;
}
const listening = listen().catch(() => { if (!stop.signal.aborted) fail(); });
try {
  await ready;
  input.resume();
  for await (const line of lines) {
    if (line.length > 16384) throw new Error('MCP request too large');
    JSON.parse(line);
    const response = await fetch(endpoint, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: line, signal: stop.signal, redirect: 'error' });
    if (response.status !== 202) throw new Error('MCP request denied');
  }
  stop.abort();
  await listening;
} catch { if (!stop.signal.aborted) fail(); }

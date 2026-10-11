import { createServer, request as upstreamRequest } from 'node:http';

// Fixed internal destination: this is not an open proxy and cannot select an external host.
const server = createServer((request, response) => {
  if (!request.url?.startsWith('/') || request.url.startsWith('//') || request.method === 'CONNECT') {
    response.writeHead(400); response.end(); return;
  }
  const headers = { ...request.headers };
  for (const name of ['forwarded', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'proxy-authorization', 'proxy-connection', 'upgrade']) delete headers[name];
  let remote;
  const upstream = upstreamRequest({ hostname: 'app', port: 3000, method: request.method, path: request.url, headers }, incoming => {
    remote = incoming;
    response.writeHead(incoming.statusCode || 502, incoming.headers);
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  upstream.on('error', () => {
    if (!response.headersSent) response.writeHead(502, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' });
    response.end('Локальный сервер временно недоступен');
  });
  request.on('aborted', () => upstream.destroy());
  request.on('error', () => upstream.destroy());
  response.on('close', () => { upstream.destroy(); remote?.destroy(); });
  request.pipe(upstream);
});
server.on('connect', (_request, socket) => socket.destroy());
server.on('upgrade', (_request, socket) => socket.destroy());
server.listen(3000, '0.0.0.0');
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => { server.close(); server.closeAllConnections(); });

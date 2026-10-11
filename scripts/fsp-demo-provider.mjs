// Local demonstration provider. No official FSP accounts, passwords or results are used.
import http from 'node:http';
import {
  generateKeyPairSync,
  createHash,
  randomBytes,
  sign,
  timingSafeEqual,
} from 'node:crypto';
import { readFile } from 'node:fs/promises';
try {
  process.loadEnvFile('.env.local');
} catch {}
if (process.env.NODE_ENV === 'production')
  throw new Error('Demo provider is local only');
const issuer = new URL(
  process.env.FSP_DEMO_ISSUER || 'http://127.0.0.1:5291/realms/fsp-demo',
);
const app = new URL(process.env.APP_URL || 'http://localhost:5174');
if (
  issuer.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(issuer.hostname) ||
  app.protocol !== 'http:' ||
  !['127.0.0.1', 'localhost'].includes(app.hostname)
)
  throw new Error('Demo requires loopback origins');
const clientId = process.env.FSP_DEMO_CLIENT_ID || 'offerly-demo';
const secret = process.env.FSP_DEMO_CLIENT_SECRET || 'local-demo-only';
const callback = new URL('/api/identity/fsp-demo/callback', app).href;
const registry = JSON.parse(
  await readFile(
    new URL('../data/fsp-demo-registry.json', import.meta.url),
    'utf8',
  ),
);
const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const jwk = publicKey.export({ format: 'jwk' });
const kid = createHash('sha256')
  .update(JSON.stringify(jwk))
  .digest('hex')
  .slice(0, 16);
const pending = new Map(),
  codes = new Map();
let registryUnavailable = false;
const nonce = () => randomBytes(32).toString('hex');
const hash = (value) => createHash('sha256').update(value).digest('base64url');
const escape = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ],
  );
const json = (res, status, value) => {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(value));
};
const authenticated = (req) => {
  if (!req.headers.authorization?.toLowerCase().startsWith('basic '))
    return false;
  const expected = Buffer.from(`${clientId}:${secret}`);
  const actual = Buffer.from(
    Buffer.from(req.headers.authorization.slice(6), 'base64')
      .toString()
      .split(':')
      .map((value) => decodeURIComponent(value.replace(/\+/g, ' ')))
      .join(':'),
  );
  return expected.length === actual.length && timingSafeEqual(expected, actual);
};
const jwt = (claims) => {
  const header = Buffer.from(
    JSON.stringify({ alg: 'RS256', kid, typ: 'JWT' }),
  ).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
};
const redirect = (res, params, values, jsonReply = false) => {
  const to = new URL(callback);
  to.searchParams.set('state', params.state);
  to.searchParams.set('iss', issuer.href);
  for (const [key, value] of Object.entries(values))
    to.searchParams.set(key, value);
  if (jsonReply) return json(res, 200, { redirectUrl: to.href });
  res.writeHead(303, {
    Location: to.href,
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
  });
  res.end();
};
const uiScript = `document.getElementById('fsp-choice').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget, data = new URLSearchParams(new FormData(form));
  data.set('decision', event.submitter?.value || 'allow');
  const buttons = [...form.querySelectorAll('button')], status = document.getElementById('fsp-status');
  buttons.forEach(button => button.disabled = true); status.textContent = 'Подключаем аккаунт…';
  try {
    const response = await fetch(form.action, { method: 'POST', headers: { Accept: 'application/json' }, body: data });
    const result = await response.json();
    if (!response.ok || !result.redirectUrl) throw new Error();
    window.location.assign(result.redirectUrl);
  } catch { status.textContent = 'Не удалось подтвердить выбор. Вернитесь в Офферли и начните привязку заново.'; buttons.forEach(button => button.disabled = false); }
});`;
const screen = (
  token,
) => `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>ФСП ID · демонстрационный сервис</title><style>
*{box-sizing:border-box}body{margin:0;background:#11121b;color:#faf9ff;font:16px/1.6 system-ui,sans-serif}main{max-width:800px;margin:48px auto;padding:0 24px}header{display:flex;align-items:center;justify-content:space-between;gap:16px}.label{border:1px solid #6c5885;border-radius:8px;padding:5px 12px;color:#d6c6ef;font-size:12px}h1{font-size:clamp(28px,5vw,42px);line-height:1.2;letter-spacing:-.035em}p{color:#bdb8cb}fieldset{padding:0;margin:24px 0;border:0}legend{font-weight:650;margin-bottom:14px}label{display:block;border:1px solid #454055;border-radius:16px;padding:20px;margin-bottom:12px;cursor:pointer;background:#22222f}label:has(input:checked){border-color:#a38aff;background:#342a4c}input{accent-color:#a38aff;margin-right:12px}strong{font-size:18px}small{display:block;color:#bdb8cb;margin:8px 0 0 28px}.actions{display:flex;gap:12px;flex-wrap:wrap}button{padding:14px 22px;border-radius:12px;border:1px solid #625276;background:#402fff;color:white;font:inherit;font-weight:650;cursor:pointer}button[value=cancel]{background:transparent}.foot{font-size:13px;border-top:1px solid #454055;margin-top:28px;padding-top:18px}button:focus-visible,input:focus-visible{outline:3px solid #beabff;outline-offset:4px}@media(max-width:480px){main{margin:24px auto}.actions button{width:100%}header{align-items:start;flex-direction:column}}
</style></head><body><main><header><strong>ФСП ID</strong><span class="label">Демонстрационный сервис</span></header><h1>Один аккаунт.<br>История ваших достижений.</h1><p>Выберите тестовый профиль для Офферли. Все имена и результаты вымышлены. Настоящий аккаунт ФСП и пароль здесь не нужны.</p><form id="fsp-choice" method="post" action="${issuer.pathname}/protocol/openid-connect/auth"><input type="hidden" name="request" value="${token}"><fieldset><legend>Тестовый аккаунт</legend>${registry.accounts.map((a, i) => `<label><input type="radio" name="subject" value="${escape(a.subject)}" ${i === 0 ? 'checked' : ''}><strong>${escape(a.name)}</strong><small>${escape(a.description)}</small><small>${escape(a.participantId)} · ${a.events.length ? `${a.events.length} ${a.events.length === 1 ? 'результат' : 'результата'}` : 'Без истории соревнований'}</small></label>`).join('')}</fieldset><p>Офферли получит ID выбранного аккаунта и его демонстрационные результаты. Ваш профиль и результат профессионального теста сохранятся.</p><div class="actions"><button name="decision" value="allow">Подтвердить и вернуться</button><button name="decision" value="cancel">Отмена</button></div><p id="fsp-status" role="status"></p></form><p class="foot">Это отдельный локальный стенд Офферли. Он показывает сценарий будущего подключения к ФСП.</p></main><script src="/provider-ui.js" defer></script></body></html>`;
const server = http.createServer(async (req, res) => {
  try {
    const now = Date.now();
    for (const map of [pending, codes])
      for (const [key, value] of map) if (value.expires < now) map.delete(key);
    const url = new URL(req.url, issuer),
      endpoint = issuer.pathname + '/protocol/openid-connect/';
    if (req.headers.host !== issuer.host)
      return json(res, 400, { error: 'invalid_host' });
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 8000) return json(res, 413, { error: 'too_large' });
      chunks.push(chunk);
    }
    const body = new URLSearchParams(Buffer.concat(chunks).toString());
    if (url.pathname === '/provider-ui.js' && req.method === 'GET') {
      res.writeHead(200, {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      return res.end(uiScript);
    }
    if (url.pathname === '/health')
      return json(res, 200, {
        provider: 'fsp-demo',
        version: registry.version,
      });
    if (url.pathname === issuer.pathname + '/.well-known/openid-configuration')
      return json(res, 200, {
        issuer: issuer.href,
        authorization_endpoint: issuer.origin + endpoint + 'auth',
        token_endpoint: issuer.origin + endpoint + 'token',
        jwks_uri: issuer.origin + endpoint + 'certs',
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        token_endpoint_auth_methods_supported: ['client_secret_basic'],
        code_challenge_methods_supported: ['S256'],
        scopes_supported: ['openid', 'profile', 'email'],
      });
    if (url.pathname === endpoint + 'certs')
      return json(res, 200, {
        keys: [{ ...jwk, kid, alg: 'RS256', use: 'sig' }],
      });
    if (url.pathname === endpoint + 'auth' && req.method === 'GET') {
      const params = Object.fromEntries(url.searchParams);
      if (
        params.client_id !== clientId ||
        params.redirect_uri !== callback ||
        params.response_type !== 'code' ||
        params.code_challenge_method !== 'S256' ||
        !/^[A-Za-z0-9_-]{43}$/.test(params.code_challenge || '') ||
        !params.nonce ||
        !params.state ||
        params.state.length > 128 ||
        !params.scope?.split(' ').includes('openid')
      )
        return json(res, 400, { error: 'invalid_authorization_request' });
      if (pending.size >= 1000)
        return json(res, 429, { error: 'too_many_requests' });
      const token = nonce(),
        browser = nonce();
      pending.set(token, { params, browser, expires: now + 600000 });
      res.writeHead(200, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'Set-Cookie': `fsp_demo_browser=${browser}; HttpOnly; SameSite=Lax; Path=${issuer.pathname}; Max-Age=600`,
        'Content-Security-Policy': `default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'; form-action 'self' ${app.origin}; frame-ancestors 'none'; base-uri 'none'`,
      });
      return res.end(screen(token));
    }
    if (url.pathname === endpoint + 'auth' && req.method === 'POST') {
      const token = body.get('request'),
        entry = pending.get(token);
      const browser = req.headers.cookie
        ?.split(';')
        .map((s) => s.trim())
        .find((s) => s.startsWith('fsp_demo_browser='))
        ?.split('=')[1];
      if (
        req.headers.origin !== issuer.origin ||
        !entry ||
        entry.browser !== browser
      )
        return json(res, 400, { error: 'invalid_browser_request' });
      pending.delete(token);
      const jsonReply = req.headers.accept === 'application/json';
      if (body.get('decision') === 'cancel')
        return redirect(
          res,
          entry.params,
          { error: 'access_denied' },
          jsonReply,
        );
      const account = registry.accounts.find(
        (a) => a.subject === body.get('subject'),
      );
      if (!account || body.get('decision') !== 'allow')
        return json(res, 400, { error: 'invalid_account' });
      const code = nonce();
      codes.set(code, { params: entry.params, account, expires: now + 60000 });
      return redirect(res, entry.params, { code }, jsonReply);
    }
    if (url.pathname === endpoint + 'token' && req.method === 'POST') {
      const code = body.get('code'),
        entry = codes.get(code);
      codes.delete(code);
      if (
        !authenticated(req) ||
        !entry ||
        body.get('grant_type') !== 'authorization_code' ||
        body.get('redirect_uri') !== callback ||
        hash(body.get('code_verifier') || '') !== entry.params.code_challenge
      ) {
        return json(res, 400, { error: 'invalid_grant' });
      }
      const issued = Math.floor(now / 1000),
        a = entry.account;
      return json(res, 200, {
        access_token: nonce(),
        token_type: 'Bearer',
        expires_in: 300,
        id_token: jwt({
          iss: issuer.href,
          sub: a.subject,
          aud: clientId,
          iat: issued,
          exp: issued + 300,
          nonce: entry.params.nonce,
          name: a.name,
          email: `${a.subject}@example.test`,
          email_verified: true,
          fsp_id: a.participantId,
        }),
      });
    }
    if (url.pathname === '/registry/results' && req.method === 'GET') {
      if (!authenticated(req)) return json(res, 401, { error: 'unauthorized' });
      if (registryUnavailable)
        return json(res, 503, { error: 'registry_unavailable' });
      const account = registry.accounts.find(
        (a) => a.subject === url.searchParams.get('subject'),
      );
      if (!account) return json(res, 404, { error: 'not_found' });
      return json(res, 200, { version: registry.version, ...account });
    }
    if (
      url.pathname === '/test/registry-mode' &&
      req.method === 'POST' &&
      process.env.FSP_DEMO_TEST_CONTROL === 'true' &&
      authenticated(req)
    ) {
      registryUnavailable = body.get('unavailable') === 'true';
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: 'not_found' });
  } catch {
    return json(res, 500, { error: 'demo_provider_error' });
  }
});
server.listen(Number(issuer.port), '127.0.0.1', () =>
  process.stdout.write(`ФСП ID · демо: ${issuer.origin}\n`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));

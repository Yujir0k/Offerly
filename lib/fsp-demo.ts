import * as oidc from 'openid-client';
import { randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { query, getDb, type Database } from '@/db';
import { currentAccount, digest, SESSION_COOKIE, throttle } from './auth';
import type { Account } from './platform';
import type { Profile, Role } from './model';
import type { CompetitionResult } from './employer-matching';
import registry from '../data/fsp-demo-registry.json';

const path = '/api/identity/fsp-demo';
const cookieName = 'offerly_fsp_demo_flow';
type Link = {
  user_id: string;
  issuer: string;
  subject: string;
  participant_id: string;
  participant_name: string;
  catalog_key: string;
};
type Flow = {
  user_id: string | null;
  session_hash: string | null;
  intent: 'login' | 'link';
  role: Role;
  issuer: string;
  redirect_uri: string;
  verifier: string;
  nonce: string;
};
export type DemoFspStatus = {
  enabled: boolean;
  available: boolean;
  linked: boolean;
  participantId?: string;
  participantName?: string;
  catalogCandidateId?: number;
  connection?: Profile['fspConnection'];
  events: CompetitionResult[];
};
export class DemoFspError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
/** The demo provider is strictly local and separate from real FSP identities. */
export function demoFspConfig() {
  if (
    process.env.NODE_ENV === 'production' ||
    process.env.ENABLE_DEMO !== 'true' ||
    process.env.FSP_DEMO_ENABLED === 'false'
  )
    throw new DemoFspError('Демонстрация ФСП ID отключена', 503);
  const base = new URL(process.env.APP_URL || 'http://localhost:5174');
  const issuer = new URL(
    process.env.FSP_DEMO_ISSUER || 'http://127.0.0.1:5291/realms/fsp-demo',
  );
  for (const url of [base, issuer])
    if (
      url.protocol !== 'http:' ||
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new DemoFspError(
        'Демонстрация ФСП ID доступна только локально',
        503,
      );
  if (base.pathname !== '/' || issuer.pathname !== '/realms/fsp-demo')
    throw new DemoFspError('Некорректная конфигурация демонстрации', 503);
  return {
    base: base.origin,
    issuer: issuer.href,
    clientId: process.env.FSP_DEMO_CLIENT_ID || 'offerly-demo',
    secret: process.env.FSP_DEMO_CLIENT_SECRET || 'local-demo-only',
    redirectUri: new URL(path + '/callback', base).href,
  };
}
let cached: { key: string; client: Promise<oidc.Configuration> } | undefined;
async function client() {
  const cfg = demoFspConfig(),
    key = digest(JSON.stringify(cfg));
  if (!cached || cached.key !== key) {
    const pending = oidc.discovery(
      new URL(cfg.issuer),
      cfg.clientId,
      { id_token_signed_response_alg: 'RS256' },
      oidc.ClientSecretBasic(cfg.secret),
      {
        timeout: 5,
        execute: [oidc.allowInsecureRequests, oidc.enableNonRepudiationChecks],
      },
    );
    cached = { key, client: pending };
  }
  try {
    const config = await cached.client;
    for (const endpoint of [
      config.serverMetadata().authorization_endpoint,
      config.serverMetadata().token_endpoint,
      config.serverMetadata().jwks_uri,
    ])
      if (!endpoint || new URL(endpoint).origin !== new URL(cfg.issuer).origin)
        throw new Error('Provider origin changed');
    return config;
  } catch {
    cached = undefined;
    throw new DemoFspError(
      'Демонстрационный сервис ФСП ID недоступен. Запустите локальный стенд.',
      503,
    );
  }
}
async function privateAccount() {
  const account = await currentAccount();
  if (!account) throw new DemoFspError('Войдите в демоверсию', 401);
  if (!account.demo || account.scope !== account.id)
    throw new DemoFspError(
      'Тестовые ФСП ID доступны только в приватной демоверсии',
      403,
    );
  return account;
}
/** Start a browser-bound OIDC login or link, without trusting browser-supplied claims. */
export async function startDemoFsp(body: Record<string, unknown>) {
  const cfg = demoFspConfig();
  if (body.intent !== 'login' && body.intent !== 'link')
    throw new DemoFspError('Неизвестный сценарий');
  const intent = body.intent,
    role = body.role === 'employer' ? 'employer' : 'candidate';
  const account = await currentAccount();
  if (account && (!account.demo || account.scope !== account.id))
    throw new DemoFspError(
      'Выйдите из обычного аккаунта, чтобы открыть отдельную демоверсию',
      403,
    );
  if (intent === 'link' && !account)
    throw new DemoFspError('Войдите в демоверсию', 401);
  await throttle('fsp-demo-start:' + (account?.id || 'local'), 30, 600);
  const config = await client(),
    state = oidc.randomState(),
    nonce = oidc.randomNonce(),
    verifier = oidc.randomPKCECodeVerifier(),
    browser = randomBytes(32).toString('hex');
  const jar = await cookies(),
    previous = jar.get(cookieName)?.value;
  if (previous)
    await query('DELETE FROM fsp_demo_flows WHERE browser_hash=$1', [
      digest(previous),
    ]);
  await query('DELETE FROM fsp_demo_flows WHERE expires_at<now()');
  await query(
    "INSERT INTO fsp_demo_flows(state_hash,browser_hash,session_hash,user_id,intent,role,issuer,redirect_uri,verifier,nonce,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()+interval '10 minutes')",
    [
      digest(state),
      digest(browser),
      account ? digest(jar.get(SESSION_COOKIE)?.value || '') : null,
      account?.id || null,
      intent,
      role,
      cfg.issuer,
      cfg.redirectUri,
      verifier,
      nonce,
    ],
  );
  jar.set(cookieName, browser, {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path,
    maxAge: 600,
  });
  return {
    authorizationUrl: oidc.buildAuthorizationUrl(config, {
      redirect_uri: cfg.redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      state,
      nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      prompt: 'login',
    }).href,
  };
}
/** Consume one callback, verifying browser, local session, PKCE and the signed ID token. */
export async function finishDemoFsp(request: Request) {
  const cfg = demoFspConfig(),
    incoming = new URL(request.url),
    jar = await cookies();
  if (request.headers.get('host') !== new URL(cfg.base).host)
    throw new DemoFspError('Недопустимый адрес возврата');
  const url = new URL(incoming.pathname + incoming.search, cfg.base),
    state = url.searchParams.get('state'),
    browser = jar.get(cookieName)?.value;
  if (
    !state ||
    state.length > 128 ||
    !browser ||
    !/^[a-f0-9]{64}$/.test(browser)
  )
    throw new DemoFspError('Попытка привязки истекла. Начните заново.');
  const {
    rows: [flow],
  } = await query<Flow>(
    'DELETE FROM fsp_demo_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *',
    [digest(state), digest(browser)],
  );
  if (!flow)
    throw new DemoFspError('Попытка привязки истекла или уже использована.');
  jar.set(cookieName, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path,
    maxAge: 0,
  });
  if (flow.issuer !== cfg.issuer || flow.redirect_uri !== cfg.redirectUri)
    throw new DemoFspError('Настройки подключения изменились. Начните заново.');
  let account: Account | null = null;
  if (flow.user_id) {
    account = await privateAccount();
    if (
      account.id !== flow.user_id ||
      digest(jar.get(SESSION_COOKIE)?.value || '') !== flow.session_hash
    )
      throw new DemoFspError('Сеанс изменился. Начните привязку заново.');
  } else if (await currentAccount())
    throw new DemoFspError('Сеанс изменился. Начните вход заново.');
  if (url.searchParams.has('error'))
    return { flow, account, cancelled: true, identity: null };
  const tokens = await oidc.authorizationCodeGrant(await client(), url, {
    expectedState: state,
    expectedNonce: flow.nonce,
    pkceCodeVerifier: flow.verifier,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  const identity = registry.accounts.find(
    (a) => a.subject === claims?.sub && a.participantId === claims?.fsp_id,
  );
  if (!identity)
    throw new DemoFspError('Сервис передал неизвестный тестовый аккаунт');
  return { flow, account, cancelled: false, identity };
}
async function ownedLink(account: Account) {
  return (
    await query<Link>('SELECT * FROM fsp_demo_links WHERE user_id=$1', [
      account.id,
    ])
  ).rows[0];
}
/** Bind only a validated demo identity; real external_identities remain untouched. */
export async function linkDemoFsp(
  account: Account,
  identity: (typeof registry.accounts)[number],
) {
  if (!account.demo || account.scope !== account.id)
    throw new DemoFspError('Недопустимый аккаунт', 403);
  await query(
    'INSERT INTO fsp_demo_links(user_id,issuer,subject,participant_id,participant_name,catalog_key) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(user_id) DO UPDATE SET issuer=excluded.issuer,subject=excluded.subject,participant_id=excluded.participant_id,participant_name=excluded.participant_name,catalog_key=excluded.catalog_key,linked_at=now()',
    [
      account.id,
      demoFspConfig().issuer,
      identity.subject,
      identity.participantId,
      identity.name,
      identity.catalogKey,
    ],
  );
  return syncDemoFsp(account);
}
async function writeConnection(
  db: Database,
  account: Account,
  link: Link,
  patch: Partial<Profile>,
) {
  const {
    rows: [current],
  } = await db.query<Link>(
    'SELECT * FROM fsp_demo_links WHERE user_id=$1 FOR UPDATE',
    [account.id],
  );
  if (
    !current ||
    current.subject !== link.subject ||
    current.issuer !== link.issuer
  )
    throw new DemoFspError(
      'Привязка изменилась. Обновите достижения заново.',
      409,
    );
  // Mirror achievements in an existing synthetic profile for the private employer preview.
  // The registry never changes professional grades, skills or any ordinary user's data.
  await db.query(
    'UPDATE candidate_profiles p SET payload=payload||$2::jsonb FROM users u WHERE p.user_id=u.id AND u.demo AND u.scope=$3 AND p.user_id IN ($1,$4)',
    [
      account.id,
      JSON.stringify(patch),
      account.scope,
      `${account.scope}:synthetic-specialists-1:${link.catalog_key}`,
    ],
  );
  await db.query(
    'UPDATE account_state SET version=version+1 WHERE user_id=$1',
    [account.id],
  );
}
/** An unavailable registry keeps the last saved achievements for the same identity. */
export async function syncDemoFsp(given?: Account) {
  const account = given || (await privateAccount()),
    link = await ownedLink(account),
    cfg = demoFspConfig();
  if (
    !account.demo ||
    account.scope !== account.id ||
    !link ||
    link.issuer !== cfg.issuer
  )
    throw new DemoFspError('Сначала привяжите тестовый ФСП ID');
  const expected = registry.accounts.find(
    (a) =>
      a.subject === link.subject && a.participantId === link.participant_id,
  );
  if (!expected) throw new DemoFspError('Неизвестный тестовый профиль');
  let patch: Partial<Profile>;
  try {
    const url = new URL('/registry/results', cfg.issuer);
    url.searchParams.set('subject', link.subject);
    const response = await fetch(url, {
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${cfg.clientId}:${cfg.secret}`).toString('base64'),
      },
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error('Registry unavailable');
    const body = await response.json();
    if (
      body.subject !== link.subject ||
      body.participantId !== link.participant_id ||
      JSON.stringify(body.events) !== JSON.stringify(expected.events)
    )
      throw new Error('Unexpected registry data');
    const events = body.events as CompetitionResult[];
    patch = {
      fsp: link.participant_id,
      competitionResults: events,
      achievements: events.map(
        (e) =>
          `${e.title} · ${e.date} · ${e.result === 'winner' ? 'Победа' : e.result === 'prize' ? 'Призовое место' : 'Участие'}`,
      ),
      fspConnection: {
        provider: 'demo',
        participantId: link.participant_id,
        participantName: link.participant_name,
        status: events.length ? 'synced' : 'empty',
        syncedAt: new Date().toISOString(),
      },
    };
  } catch {
    const {
      rows: [row],
    } = await query<{ payload: Profile }>(
      'SELECT payload FROM candidate_profiles WHERE user_id=$1',
      [account.id],
    );
    patch = {
      fsp: link.participant_id,
      fspConnection: {
        provider: 'demo',
        participantId: link.participant_id,
        participantName: link.participant_name,
        status: 'unavailable',
        syncedAt:
          row?.payload.fspConnection?.participantId === link.participant_id
            ? row.payload.fspConnection.syncedAt
            : undefined,
      },
    };
    if (row?.payload.fspConnection?.participantId !== link.participant_id) {
      patch.competitionResults = [];
      patch.achievements = [];
    }
  }
  await (
    await getDb()
  ).transaction((db) => writeConnection(db, account, link, patch));
  return demoFspStatus();
}
/** Read only the current private demo's identity and registry results. */
export async function demoFspStatus(): Promise<DemoFspStatus> {
  let cfg: ReturnType<typeof demoFspConfig>;
  try {
    cfg = demoFspConfig();
  } catch {
    return { enabled: false, available: false, linked: false, events: [] };
  }
  let available = false;
  try {
    const r = await fetch(new URL('/health', cfg.issuer), {
      signal: AbortSignal.timeout(1000),
      cache: 'no-store',
      redirect: 'error',
    });
    available = r.ok && (await r.json()).provider === 'fsp-demo';
  } catch {}
  const account = await currentAccount();
  if (!account?.demo || account.scope !== account.id)
    return { enabled: true, available, linked: false, events: [] };
  const link = await ownedLink(account);
  if (!link || link.issuer !== cfg.issuer)
    return { enabled: true, available, linked: false, events: [] };
  const { rows } = await query<{
    user_id: string;
    id: number;
    payload: Profile;
  }>(
    'SELECT p.user_id,p.id,p.payload FROM candidate_profiles p JOIN users u ON u.id=p.user_id WHERE u.demo AND u.scope=$1 AND p.user_id IN ($1,$2)',
    [
      account.id,
      `${account.scope}:synthetic-specialists-1:${link.catalog_key}`,
    ],
  );
  const own = rows.find((r) => r.user_id === account.id)?.payload;
  return {
    enabled: true,
    available,
    linked: true,
    participantId: link.participant_id,
    participantName: link.participant_name,
    catalogCandidateId: rows.find((r) => r.user_id !== account.id)?.id,
    connection: own?.fspConnection,
    events: own?.competitionResults || [],
  };
}

/** Remove only this demo identity; professional test evidence and skills are retained. */
export async function unlinkDemoFsp() {
  demoFspConfig();
  const account = await privateAccount();
  await (await getDb()).transaction(async db => {
    const {rows:[link]} = await db.query<Link>('SELECT * FROM fsp_demo_links WHERE user_id=$1 FOR UPDATE',[account.id]);
    if (!link) return;
    await db.query('DELETE FROM fsp_demo_links WHERE user_id=$1',[account.id]);
    await db.query('DELETE FROM fsp_demo_flows WHERE user_id=$1',[account.id]);
    await db.query(`UPDATE candidate_profiles p SET payload=(payload - 'fspConnection') || jsonb_build_object('fsp',NULL,'achievements','[]'::jsonb,'competitionResults','[]'::jsonb) FROM users u WHERE p.user_id=u.id AND u.demo AND u.scope=$2 AND p.user_id IN ($1,$3)`,[account.id,account.scope,`${account.scope}:synthetic-specialists-1:${link.catalog_key}`]);
    await db.query('UPDATE account_state SET version=version+1 WHERE user_id=$1',[account.id]);
  });
  return demoFspStatus();
}

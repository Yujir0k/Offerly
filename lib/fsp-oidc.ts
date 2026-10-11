import * as oidc from "openid-client";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { query } from "@/db";
import { currentAccount, digest, throttle, SESSION_COOKIE } from "./auth";
import { FspError } from "./fsp-errors";
export const FLOW_COOKIE = "offerly_fsp_flow";
export const FLOW_PATH = "/api/identity/fsp";
type Intent = "login" | "register" | "link";
export type FspFlow = {
  intent: Intent;
  role: "candidate" | "employer";
  consent: boolean;
  user_id?: string;
  session_hash?: string;
  issuer: string;
  redirect_uri: string;
  verifier: string;
  nonce: string;
  expires_at: string;
};

function secureUrl(value: string, allowLocal = false) {
  const u = new URL(value);
  const local =
    process.env.NODE_ENV !== "production" &&
    allowLocal &&
    ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
  if (
    (u.protocol !== "https:" && !(local && u.protocol === "http:")) ||
    u.username ||
    u.password ||
    u.search ||
    u.hash
  )
    throw new Error("Invalid OIDC URL");
  return u;
}
export function fspConfiguration() {
  if (process.env.FSP_OIDC_ENABLED !== "true")
    throw new FspError("unavailable", 503);
  const issuer = process.env.FSP_OIDC_ISSUER || "",
    clientId = process.env.FSP_OIDC_CLIENT_ID || "";
  if (!issuer || !clientId || !process.env.APP_URL)
    throw new FspError("unavailable", 503);
  try {
    const base = secureUrl(process.env.APP_URL, true);
    if (base.pathname !== "/") throw new Error("APP_URL must be an origin");
    const server = secureUrl(
      issuer,
      process.env.FSP_OIDC_ALLOW_LOCAL_HTTP === "true",
    );
    return {
      issuer: server.href,
      clientId,
      clientSecret: process.env.FSP_OIDC_CLIENT_SECRET || "",
      base: base.origin,
      redirectUri: new URL(FLOW_PATH + "/callback", base).href,
      participantClaim: process.env.FSP_OIDC_PARTICIPANT_CLAIM || "fsp_id",
    };
  } catch {
    throw new FspError("unavailable", 503);
  }
}
let cached:
  | { key: string; expires: number; value: Promise<oidc.Configuration> }
  | undefined;
export async function fspClient() {
  const cfg = fspConfiguration();
  const key = digest(JSON.stringify(cfg));
  if (!cached || cached.key !== key || cached.expires < Date.now()) {
    const value = oidc
      .discovery(
        new URL(cfg.issuer),
        cfg.clientId,
        { id_token_signed_response_alg: "RS256" },
        cfg.clientSecret
          ? oidc.ClientSecretBasic(cfg.clientSecret)
          : oidc.None(),
        {
          timeout: 10,
          execute: [
            oidc.enableNonRepudiationChecks,
            ...(cfg.issuer.startsWith("http:")
              ? [oidc.allowInsecureRequests]
              : []),
          ],
        },
      )
      .then((config) => {
        // Keycloak's realm endpoints stay on the configured issuer origin.
        for (const endpoint of [
          config.serverMetadata().authorization_endpoint,
          config.serverMetadata().token_endpoint,
          config.serverMetadata().jwks_uri,
        ]) {
          if (
            !endpoint ||
            secureUrl(endpoint, cfg.issuer.startsWith("http:")).origin !==
              new URL(cfg.issuer).origin
          )
            throw new FspError("failed", 503);
        }
        return config;
      });
    cached = { key, expires: Date.now() + 15 * 60_000, value };
    value.catch(() => {
      if (cached?.value === value) cached = undefined;
    });
  }
  return cached.value;
}
export async function startFsp(
  body: Record<string, unknown>,
  forceLink = false,
  address = "local",
) {
  const cfg = fspConfiguration();
  const intent: Intent = forceLink
    ? "link"
    : body.intent === "register"
      ? "register"
      : body.intent === "login"
        ? "login"
        : (() => {
            throw new FspError("failed");
          })();
  const role = body.role === "employer" ? "employer" : "candidate";
  const account = await currentAccount();
  if (intent === "register" && body.consent !== true)
    throw new FspError("consent");
  if (intent === "link" && (!account || !account.verified_at))
    throw new FspError("session", 401);
  if (intent === "link" && account?.demo) throw new FspError("demo");
  const jar = await cookies();
  await throttle("fsp-start-address:" + address, 60, 600);
  if (account) await throttle("fsp-start-account:" + account.id, 30, 600);
  const config = await fspClient();
  const state = oidc.randomState(),
    nonce = oidc.randomNonce(),
    verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier),
    browser = randomBytes(32).toString("hex");
  const previous = jar.get(FLOW_COOKIE)?.value;
  if (previous)
    await query("DELETE FROM oidc_flows WHERE browser_hash=$1", [
      digest(previous),
    ]);
  await query("DELETE FROM oidc_flows WHERE expires_at<now()");
  await query(
    "INSERT INTO oidc_flows(state_hash,browser_hash,session_hash,user_id,intent,role,consent,issuer,redirect_uri,verifier,nonce,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '10 minutes')",
    [
      digest(state),
      digest(browser),
      intent === "link" ? digest(jar.get(SESSION_COOKIE)?.value || "") : null,
      intent === "link" ? account!.id : null,
      intent,
      role,
      body.consent === true,
      cfg.issuer,
      cfg.redirectUri,
      verifier,
      nonce,
    ],
  );
  jar.set(FLOW_COOKIE, browser, {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(cfg.base).protocol === "https:",
    path: FLOW_PATH,
    maxAge: 600,
  });
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    response_mode: "query",
    scope: "openid profile email",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    ...(intent === "link" ? { prompt: "login" } : {}),
  });
  return { authorizationUrl: url.href };
}
/** Consume the browser-bound attempt atomically before redeeming its code. */
export async function takeFspFlow(url: URL): Promise<FspFlow> {
  const state = url.searchParams.get("state"),
    browser = (await cookies()).get(FLOW_COOKIE)?.value;
  if (
    !state ||
    state.length > 128 ||
    !browser ||
    !/^[a-f0-9]{64}$/.test(browser)
  )
    throw new FspError("expired");
  const {
    rows: [flow],
  } = await query<FspFlow>(
    "DELETE FROM oidc_flows WHERE state_hash=$1 AND browser_hash=$2 AND expires_at>now() RETURNING *",
    [digest(state), digest(browser)],
  );
  if (!flow) throw new FspError("expired");
  (await cookies()).set(FLOW_COOKIE, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: new URL(flow.redirect_uri).protocol === "https:",
    path: FLOW_PATH,
    maxAge: 0,
  });
  return flow;
}
export async function validateFspCallback(url: URL, flow: FspFlow) {
  const cfg = fspConfiguration();
  if (
    flow.issuer !== cfg.issuer ||
    flow.redirect_uri !== cfg.redirectUri ||
    url.origin + url.pathname !== cfg.redirectUri
  )
    throw new FspError("failed");
  if (flow.intent === "link") {
    const own = await currentAccount(),
      token = (await cookies()).get(SESSION_COOKIE)?.value;
    if (
      !own ||
      own.id !== flow.user_id ||
      !token ||
      digest(token) !== flow.session_hash ||
      !own.verified_at ||
      own.demo
    )
      throw new FspError("session", 401);
  }
  if (url.searchParams.has("error")) throw new FspError("cancelled");
  const code = url.searchParams.get("code");
  if (!code || code.length > 4096) throw new FspError("failed");
  const tokens = await oidc.authorizationCodeGrant(await fspClient(), url, {
    expectedState: url.searchParams.get("state")!,
    expectedNonce: flow.nonce,
    pkceCodeVerifier: flow.verifier,
    idTokenExpected: true,
  });
  const claims = tokens.claims();
  if (!claims) throw new FspError("failed");
  return { claims, participantClaim: cfg.participantClaim };
}

// Loopback-only OIDC protocol fixture. This is not a real Keycloak/FSP registry.
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
const issuer = "http://127.0.0.1:5290/realms/fsp",
  prefix = "/realms/fsp";
const keys = await generateKeyPair("RS256", { extractable: true }),
  wrong = await generateKeyPair("RS256");
const jwk = {
  ...(await exportJWK(keys.publicKey)),
  kid: "test-key",
  alg: "RS256",
  use: "sig",
};
let scenario = {
  sub: "test-person",
  name: "Тестовый Участник",
  email: "fsp@example.test",
  email_verified: true,
  fsp_id: "FSP-TEST-123",
};
const codes = new Map();
const json = (r, status, value) => {
  r.writeHead(status, { "Content-Type": "application/json" });
  r.end(JSON.stringify(value));
};
http
  .createServer(async (req, res) => {
    try {
      const url = new URL(req.url, issuer),
        chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      if (url.pathname === "/test-scenario" && req.method === "POST") {
        scenario = JSON.parse(body);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === prefix + "/.well-known/openid-configuration")
        return json(res, 200, {
          issuer,
          authorization_endpoint: issuer + "/protocol/openid-connect/auth",
          token_endpoint: issuer + "/protocol/openid-connect/token",
          jwks_uri: issuer + "/protocol/openid-connect/certs",
          response_types_supported: ["code"],
          subject_types_supported: ["public"],
          id_token_signing_alg_values_supported: ["RS256"],
          token_endpoint_auth_methods_supported: ["client_secret_basic"],
          code_challenge_methods_supported: ["S256"],
        });
      if (url.pathname === prefix + "/protocol/openid-connect/certs")
        return json(res, 200, { keys: [jwk] });
      if (url.pathname === prefix + "/protocol/openid-connect/auth") {
        const code = randomBytes(24).toString("hex");
        codes.set(code, {
          params: Object.fromEntries(url.searchParams),
          claims: { ...scenario },
        });
        const to = new URL(url.searchParams.get("redirect_uri"));
        to.searchParams.set("code", code);
        to.searchParams.set("state", url.searchParams.get("state"));
        to.searchParams.set("iss", issuer);
        res.writeHead(302, { Location: to.href });
        return res.end();
      }
      if (url.pathname === prefix + "/protocol/openid-connect/token") {
        const p = new URLSearchParams(body),
          entry = codes.get(p.get("code"));
        codes.delete(p.get("code"));
        const authenticated =
          req.headers.authorization?.toLowerCase().startsWith("basic ") &&
          Buffer.from(req.headers.authorization.slice(6), "base64")
            .toString()
            .split(":")
            .map((value) => decodeURIComponent(value.replace(/\+/g, " ")))
            .join(":") === "offerly-test:test-secret";
        if (
          !authenticated ||
          !entry ||
          p.get("redirect_uri") !== entry.params.redirect_uri ||
          createHash("sha256")
            .update(p.get("code_verifier") || "")
            .digest("base64url") !== entry.params.code_challenge
        ) {
          console.log("Fixture checks", {
            auth: !!authenticated,
            method: req.headers.authorization?.split(" ")[0],
            client: Buffer.from(
              req.headers.authorization?.split(" ")[1] || "",
              "base64",
            )
              .toString()
              .split(":")[0],
            secretLength: Buffer.from(
              req.headers.authorization?.split(" ")[1] || "",
              "base64",
            )
              .toString()
              .split(":")[1]?.length,
            code: !!entry,
            redirect: entry?.params.redirect_uri === p.get("redirect_uri"),
            pkce:
              entry &&
              createHash("sha256")
                .update(p.get("code_verifier") || "")
                .digest("base64url") === entry.params.code_challenge,
          });
          return json(res, 400, { error: "invalid_grant" });
        }
        const { badNonce, badAudience, badSignature, expired, ...claims } =
          entry.claims;
        const id_token = await new SignJWT({
          ...claims,
          nonce: badNonce ? "wrong" : entry.params.nonce,
        })
          .setProtectedHeader({ alg: "RS256", kid: "test-key" })
          .setIssuer(issuer)
          .setAudience(badAudience ? "wrong" : entry.params.client_id)
          .setIssuedAt()
          .setExpirationTime(
            expired ? Math.floor(Date.now() / 1000) - 30 : "5m",
          )
          .sign(badSignature ? wrong.privateKey : keys.privateKey);
        return json(res, 200, {
          access_token: "synthetic-test-token",
          token_type: "Bearer",
          expires_in: 300,
          id_token,
        });
      }
      json(res, 404, { error: "not_found" });
    } catch {
      json(res, 500, { error: "fixture_error" });
    }
  })
  .listen(5290, "127.0.0.1", () =>
    console.log("Loopback OIDC fixture ready on 5290"),
  );

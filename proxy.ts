import { NextResponse, type NextRequest } from "next/server";
import { randomBytes } from "node:crypto";
export function proxy(request: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  const nonce = randomBytes(18).toString("base64");
  const csp = [
    "default-src 'self'", `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob: https:", "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`, "worker-src 'self' blob:",
    "object-src 'none'", "frame-src 'none'", "frame-ancestors 'none'", "base-uri 'none'", "form-action 'self'",
    ...(!dev ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
  const headers = new Headers(request.headers);
  // Discard any caller-supplied nonce/policy; Next propagates this server-generated nonce to its scripts.
  headers.set("x-nonce", nonce); headers.set("Content-Security-Policy", csp);
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = { matcher: ["/((?!api(?:/|$)|_next/|fonts/|branding/|images/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|woff2?|ttf|mp4|pdf)$).*)"] };

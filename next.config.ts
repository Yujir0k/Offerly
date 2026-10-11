import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import type { NextConfig } from "next";
const config: NextConfig = {
  devIndicators: false,
  typescript: { tsconfigPath: "tsconfig.build.json" },
  poweredByHeader: false,
  // All product images use ordinary img elements and the private raster upload API.
  images: { unoptimized: true },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
    ] }, { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "private, no-store" }] }];
  },
  output: "standalone",
  serverExternalPackages: [
    "pg",
    "@electric-sql/pglite",
    "nodemailer",
    "openid-client",
  ],
  logging: { incomingRequests: { ignore: [/\/api\/identity\/fsp(?:-demo)?\/callback/] } },
  experimental: { serverActions: { bodySizeLimit: "1mb" } },
};
export default (phase: string): NextConfig => ({
  ...config,
  distDir: phase === PHASE_DEVELOPMENT_SERVER ? process.env.NEXT_DEV_DIST_DIR || ".next-dev" : ".next",
  outputFileTracingRoot: process.cwd(),
});

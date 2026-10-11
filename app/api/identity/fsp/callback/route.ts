import { NextResponse } from "next/server";
import {
  takeFspFlow,
  validateFspCallback,
  fspConfiguration,
  type FspFlow,
} from "@/lib/fsp-oidc";
import { resolveFspIdentity } from "@/lib/fsp-identity";
import { logout, setSession } from "@/lib/auth";
import { FspError } from "@/lib/fsp-errors";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  let flow: FspFlow | undefined;
  // No tokens, provider descriptions or arbitrary return URLs go into redirects.
  const configuredBase = process.env.APP_URL || new URL(request.url).origin;
  const redirect = (path: string) => {
    const response = NextResponse.redirect(new URL(path, configuredBase), 303);
    response.headers.set("Cache-Control", "no-store");
    response.headers.set("Referrer-Policy", "no-referrer");
    return response;
  };
  try {
    const cfg = fspConfiguration(),
      incoming = new URL(request.url);
    if (request.headers.get("host") !== new URL(cfg.base).host)
      throw new FspError("failed");
    const url = new URL(incoming.pathname + incoming.search, cfg.base);
    flow = await takeFspFlow(url);
    const { claims, participantClaim } = await validateFspCallback(url, flow);
    const { account, created } = await resolveFspIdentity({
      issuer: flow.issuer,
      claims,
      intent: flow.intent,
      consent: flow.consent,
      userId: flow.user_id,
      participantClaim,
    });
    if (flow.intent === "link")
      return redirect(`/demo/${flow.role}/settings?fsp=linked`);
    await logout();
    await setSession(account);
    return redirect(
      !account.verified_at
        ? `/verify-email?role=${flow.role}`
        : created
          ? `/onboarding/${flow.role}`
          : `/demo/${flow.role}/overview`,
    );
  } catch (e) {
    const code = e instanceof FspError ? e.code : "failed";
    const role = flow?.role || "candidate";
    const path =
      flow?.intent === "link"
        ? `/demo/${role}/settings`
        : code === "consent"
          ? "/register"
          : "/login";
    return redirect(
      `${path}?${path.startsWith("/demo/") ? "" : "role=" + role + "&"}fsp=${code}`,
    );
  }
}

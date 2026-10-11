import { cookies } from "next/headers";
import { randomBytes } from "node:crypto";
import { throttle } from "@/lib/auth";
import { checkOrigin, errorResponse } from "@/lib/store";
import {
  requestPasswordReset,
  verifyPasswordReset,
  completePasswordReset,
} from "@/lib/password-recovery";
import { chatBody } from "@/lib/conversations";
export const runtime = "nodejs";
export async function POST(r: Request) {
  try {
    checkOrigin(r);
    const b = await chatBody(r, 3000),
      jar = await cookies();
    let binding = jar.get("offerly_reset")?.value;
    const source =
      process.env.TRUST_PROXY === "true"
        ? r.headers.get("x-forwarded-for")?.split(",").pop()?.trim() ||
          "unknown"
        : "local";
    await throttle("reset-source:" + source, 30, 600);
    if (b.type === "request") {
      binding = randomBytes(32).toString("hex");
      const result = await requestPasswordReset(b.email, binding);
      jar.set("offerly_reset", binding, {
        httpOnly: true,
        secure:
          process.env.NODE_ENV === "production" ||
          process.env.COOKIE_SECURE === "true",
        sameSite: "strict",
        path: "/api/auth/recovery",
        maxAge: 600,
      });
      return Response.json(result, {
        headers: { "Cache-Control": "no-store" },
      });
    }
    if (!binding || !/^[a-f0-9]{64}$/.test(binding))
      throw Error("Начните восстановление заново");
    const id = String(b.id || "").slice(0, 100);
    const result =
      b.type === "verify"
        ? await verifyPasswordReset(id, String(b.code || ""), binding)
        : b.type === "complete"
          ? await completePasswordReset(
              id,
              String(b.grant || ""),
              String(b.password || ""),
              binding,
            )
          : null;
    if (!result) throw Error("Неизвестное действие");
    if (b.type === "complete")
      jar.set("offerly_reset", "", {
        httpOnly: true,
        sameSite: "strict",
        path: "/api/auth/recovery",
        maxAge: 0,
      });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}

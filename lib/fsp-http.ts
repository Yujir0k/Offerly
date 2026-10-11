import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { checkOrigin } from "./store";
import { startFsp } from "./fsp-oidc";
import { FspError, fspMessages } from "./fsp-errors";
export async function fspStartResponse(request: Request, link = false) {
  try {
    checkOrigin(request);
    const text = await readRequestText(request, 6000);
    if (text.length > 2000) throw new FspError("failed");
    const body = parseRequestJson(text);
    if (!body || typeof body !== "object" || Array.isArray(body))
      throw new FspError("failed");
    const address =
      process.env.TRUST_PROXY === "true"
        ? request.headers
            .get("x-forwarded-for")
            ?.split(",")
            .pop()
            ?.trim()
            .slice(0, 100) || "unknown"
        : "local";
    return Response.json(await startFsp(body, link, address), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    if (e instanceof FspError)
      return Response.json(
        { error: e.message, code: e.code },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    const originError =
      e instanceof Error && e.message === "Недопустимый источник запроса";
    return Response.json(
      {
        error: originError
          ? "Недопустимый источник запроса"
          : fspMessages.failed,
        code: "failed",
      },
      {
        status: originError ? 400 : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
}

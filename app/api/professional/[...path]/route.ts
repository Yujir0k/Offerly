import { parseRequestJson, readRequestText } from "@/lib/request-security";
import { currentAccount, throttle } from "@/lib/auth";
import { checkOrigin, errorResponse } from "@/lib/store";
import {
  AssessmentHttpError,
  professionalOperation,
  professionalPacks,
  professionalEligibility,
} from "@/lib/professional-assessment";
export const runtime = "nodejs";
async function handle(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    if (request.method === "POST") checkOrigin(request);
    const account = await currentAccount();
    if (!account) throw new Error("AUTH");
    if (request.headers.get("X-Offerly-Role") !== "candidate")
      throw new AssessmentHttpError(
        "Проверка доступна в кабинете кандидата",
        403,
      );
    if (!account.demo && !account.verified_at)
      throw new AssessmentHttpError("Подтвердите почту перед проверкой", 403);
    const { path } = await context.params;
    let input: Record<string, unknown> = {};
    if (request.method === "POST") {
      const raw = await readRequestText(request, 65536);
      if (raw.length > 16384)
        throw new AssessmentHttpError("Слишком большой ответ", 413);
      try {
        input = parseRequestJson(raw);
      } catch {
        throw new AssessmentHttpError("Некорректный запрос");
      }
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new AssessmentHttpError("Некорректный запрос");
    }
    let data;
    if (
      path.length === 1 &&
      path[0] === "generative-packs" &&
      request.method === "GET"
    )
      data = professionalPacks();
    else if (
      path.length === 1 &&
      path[0] === "eligibility" &&
      request.method === "GET"
    ) {
      const params = new URL(request.url).searchParams;
      data = await professionalEligibility(
        account,
        params.get("specialization") || "backend",
        params.get("targetGrade") || "Junior",
      );
    } else if (path[0] === "adaptive-sessions" && path.length === 1) {
      if (request.method === "POST")
        await throttle("professional-start:" + account.id, 30, 60);
      data = await professionalOperation(
        account,
        request.method === "GET" ? "list" : "start",
        input,
      );
    } else if (
      path[0] === "adaptive-sessions" &&
      path.length === 2 &&
      request.method === "GET"
    )
      data = await professionalOperation(account, "get", { id: path[1] });
    else if (
      path[0] === "adaptive-sessions" &&
      path.length === 3 &&
      request.method === "POST" &&
      ["answer", "evidence", "navigate", "revise"].includes(path[2]!)
    )
      data = await professionalOperation(
        account,
        path[2] as "answer" | "evidence" | "navigate" | "revise",
        { ...input, id: path[1] },
      );
    else throw new AssessmentHttpError("Раздел недоступен", 404);
    return Response.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof AssessmentHttpError)
      return Response.json(
        {
          error: e.message,
          ...(e.details ? { code: "ASSESSMENT_COOLDOWN", ...e.details } : {}),
        },
        { status: e.status, headers: { "Cache-Control": "no-store" } },
      );
    return errorResponse(e);
  }
}
export const GET = handle;
export const POST = handle;

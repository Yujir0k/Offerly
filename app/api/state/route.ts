import { workspace, clientState, errorResponse } from "@/lib/store";
export async function GET(request: Request) {
  try {
    const { state } = await workspace();
    const role =
      new URL(request.url).searchParams.get("role") === "employer"
        ? "employer"
        : "candidate";
    return Response.json(clientState(state, role), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (e) {
    return errorResponse(e);
  }
}

// Unknown API URLs must not fall through to the client-side website with HTTP 200.
function missingEndpoint() {
  return Response.json(
    { error: "Метод API не найден" },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );
}
export const GET = missingEndpoint;
export const POST = missingEndpoint;
export const PUT = missingEndpoint;
export const PATCH = missingEndpoint;
export const DELETE = missingEndpoint;
export const OPTIONS = missingEndpoint;
export function HEAD() {
  return new Response(null, { status: 404 });
}

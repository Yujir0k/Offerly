import { workspace, errorResponse } from "@/lib/store";
const cache = new Map<string, { at: number; items: string[] }>();
/** Only a skill search fragment is sent to HH; résumé and profile stay private. */
export async function GET(request: Request) {
  try {
    await workspace();
    const text = (new URL(request.url).searchParams.get("text") || "").trim();
    if (text.length < 2 || text.length > 100)
      return Response.json({ items: [] });
    const key = text.toLocaleLowerCase("ru"),
      entry = cache.get(key);
    if (entry && Date.now() - entry.at < 3_600_000)
      return Response.json({ items: entry.items });
    try {
      const response = await fetch(
        `https://api.hh.ru/suggests/skill_set?text=${encodeURIComponent(text)}`,
        {
          headers: { "HH-User-Agent": "Offerly/0.1" },
          signal: AbortSignal.timeout(3000),
        },
      );
      if (!response.ok) throw new Error("HH unavailable");
      const body = (await response.json()) as { items?: { text: string }[] };
      const items = (body.items || [])
        .map((i) => i.text)
        .filter((v) => typeof v === "string" && v.length <= 100)
        .slice(0, 30);
      if (cache.size >= 250) cache.delete(cache.keys().next().value!);
      cache.set(key, { at: Date.now(), items });
      return Response.json({ items });
    } catch {
      return Response.json({ items: [], fallback: true });
    }
  } catch (error) {
    return errorResponse(error);
  }
}

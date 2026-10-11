import type { Role } from "./model";
export async function hiringApi<T = any>(
  role: Role,
  type: string,
  data: Record<string, unknown> = {},
): Promise<T> {
  const r = await fetch("/api/hiring", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Offerly-Role": role },
    body: JSON.stringify({ ...data, type }),
    cache: "no-store",
  });
  const body = await r.json();
  if (!r.ok) throw Error(body.error || "Не удалось выполнить действие");
  return body;
}
export const hiringStages = [
  { value: "saved", label: "Сохранён" },
  { value: "invited", label: "Приглашён" },
  { value: "talking", label: "В общении" },
  { value: "interview", label: "Интервью" },
  { value: "offer", label: "Оффер" },
  { value: "closed", label: "Завершён" },
];

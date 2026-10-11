import type { Role } from "./model";
export async function chatRequest<T>(
  role: Role,
  path = "",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let r: Response;
  try {
    r = await fetch("/api/conversations" + path, {
      method: body ? "POST" : "GET",
      headers: {
        "X-Offerly-Role": role,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: signal || AbortSignal.timeout(12000),
      cache: "no-store",
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new Error(
      "Нет связи с сервером. Ваш текст сохранён; повторите отправку после восстановления соединения.",
    );
  }
  let value: any;
  try {
    value = await r.json();
  } catch {
    throw new Error(
      "Сервер временно недоступен. Ваш текст сохранён; повторите отправку.",
    );
  }
  if (!r.ok) throw new Error(value.error || "Не удалось загрузить переписку");
  return value;
}

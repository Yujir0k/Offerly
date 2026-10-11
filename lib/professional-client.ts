export async function platform<T>(
  path: string,
  method = "GET",
  data?: unknown,
): Promise<T> {
  const response = await fetch("/api/professional" + path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-Offerly-Role": "candidate",
    },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  const body = await response.json();
  if (!response.ok)
    throw new Error(body.error || "Не удалось загрузить проверку");
  return body as T;
}

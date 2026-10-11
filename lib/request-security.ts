/** Infrastructure limits are server-side and independent of the caller's role. */
export class RequestSecurityError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function readRequestBytes(request: Request, max: number): Promise<Uint8Array> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > max))
    throw new RequestSecurityError("Слишком большой запрос", 413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const parts: Uint8Array[] = []; let size = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => { void reader.cancel().catch(() => {}); reject(new RequestSecurityError("Запрос передавался слишком долго. Повторите отправку", 408)); }, 15000);
    timer.unref?.();
  });
  try {
    while (true) {
      const { value, done } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel(); throw new RequestSecurityError("Слишком большой запрос", 413); }
      parts.push(value);
    }
  } finally { clearTimeout(timer); reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const part of parts) { bytes.set(part, offset); offset += part.length; }
  return bytes;
}
export async function readRequestText(request: Request, max: number) {
  return new TextDecoder().decode(await readRequestBytes(request, max));
}
export function parseRequestJson(text: string): Record<string, any> {
  let value: any;
  try { value = JSON.parse(text); } catch { throw new RequestSecurityError("Проверьте запрос", 400); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestSecurityError("Проверьте запрос", 400);
  const stack = [{value, depth: 0}]; let count = 0;
  while (stack.length) {
    const next = stack.pop()!;
    if (++count > 20000 || next.depth > 64) throw new RequestSecurityError("Слишком сложный запрос", 400);
    if (next.value && typeof next.value === "object") for (const [key, child] of Object.entries(next.value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new RequestSecurityError("Недопустимые поля запроса", 400);
      stack.push({value: child, depth: next.depth + 1});
    }
  }
  return value;
}
export async function readRequestJson(request: Request, max: number): Promise<Record<string, any>> {
  return parseRequestJson(await readRequestText(request, max));
}
export async function readRequestForm(request: Request, max: number) {
  const bytes = await readRequestBytes(request, max);
  try { return await new Response(bytes as BodyInit, { headers: { "content-type": request.headers.get("content-type") || "" } }).formData(); }
  catch { throw new RequestSecurityError("Проверьте загружаемый файл", 400); }
}

import type { Role, State } from "./model";
/** Retry only a read, never a mutation; dev recompilation/proxy failures can return HTML. */
export async function readWorkspace(role: Role, signal?: AbortSignal) {
  let response = await fetch(`/api/state?role=${role}`, { signal });
  if (response.status >= 500) {
    signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 250));
    signal?.throwIfAborted();
    response = await fetch(`/api/state?role=${role}`, { signal });
  }
  let body: State & { error?: string };
  try {
    body = await response.json();
  } catch {
    throw new Error(
      "Не удалось загрузить кабинет. Повторите попытку через несколько секунд.",
    );
  }
  if (!body || typeof body !== "object")
    throw new Error("Не удалось загрузить кабинет. Повторите попытку.");
  return { response, body };
}

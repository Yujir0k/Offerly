import { Worker } from "node:worker_threads";
import path from "node:path";
import type { extractResume } from "./resume-extraction";
import { RequestSecurityError } from "./request-security";
const state = globalThis as typeof globalThis & { offerlyResumeWorkers?: number };
/** Two bounded workers; no unbounded waiting queue or PDF parsing on the web event loop. */
export async function parseResumeIsolated(bytes: Uint8Array): Promise<Awaited<ReturnType<typeof extractResume>>> {
  if ((state.offerlyResumeWorkers || 0) >= 2) throw new RequestSecurityError("Сервис обрабатывает резюме. Повторите загрузку чуть позже", 429);
  state.offerlyResumeWorkers = (state.offerlyResumeWorkers || 0) + 1;
  let worker: Worker | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise((resolve, reject) => {
      worker = new Worker(path.join(process.cwd(), "scripts/resume-worker.mjs"), { workerData: bytes, resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 } });
      timer = setTimeout(() => reject(new RequestSecurityError("Обработка PDF заняла слишком долго. Попробуйте более простой файл", 422)), 20000);
      worker.once("message", message => message.error ? reject(new RequestSecurityError(message.error, 400)) : resolve(message.result));
      worker.once("error", () => reject(new RequestSecurityError("Не удалось обработать PDF в безопасных пределах. Попробуйте другой файл", 422)));
      worker.once("exit", code => { if (code) reject(new RequestSecurityError("Не удалось прочитать PDF. Попробуйте другой файл", 422)); });
    });
  } finally { clearTimeout(timer); await worker?.terminate(); state.offerlyResumeWorkers!--; }
}

import { parentPort, workerData } from "node:worker_threads";
import { extractResume } from "../lib/resume-extraction";
try { parentPort!.postMessage({ result: await extractResume(new Uint8Array(workerData)) }); }
catch (e) { parentPort!.postMessage({ error: e instanceof Error && /[А-Яа-яЁё]/.test(e.message) ? e.message : "Не удалось прочитать PDF. Проверьте файл и попробуйте снова" }); }

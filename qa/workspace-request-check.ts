import assert from "node:assert/strict";
import { readWorkspace } from "../lib/workspace-request";
const original = globalThis.fetch;
let calls = 0;
let queue: Response[] = [];
globalThis.fetch = async () => {
  calls++;
  const r = queue.shift();
  assert(r, "unexpected repeated request");
  return r;
};
try {
  queue = [
    new Response("recompiling", { status: 500 }),
    Response.json({ profile: { id: 1 } }),
  ];
  calls = 0;
  assert.equal((await readWorkspace("candidate")).body.profile.id, 1);
  assert.equal(calls, 2);
  queue = [Response.json({ error: "AUTH" }, { status: 401 })];
  calls = 0;
  assert.equal((await readWorkspace("candidate")).response.status, 401);
  assert.equal(calls, 1);
  queue = [
    new Response("<html>", { status: 500 }),
    new Response("<html>", { status: 500 }),
  ];
  calls = 0;
  await assert.rejects(
    readWorkspace("candidate"),
    /Не удалось загрузить кабинет/,
  );
  assert.equal(calls, 2);
  queue = [new Response("offline", { status: 500 })];
  calls = 0;
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(readWorkspace("candidate", abort.signal), {
    name: "AbortError",
  });
  assert.equal(calls, 1);
  console.log(
    JSON.stringify({
      checks: 8,
      readRetryBounded: true,
      unauthorizedNotRetried: true,
      abortRespected: true,
      technicalHtmlHidden: true,
    }),
  );
} finally {
  globalThis.fetch = original;
}

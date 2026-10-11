import { test } from "node:test";
import assert from "node:assert/strict";
import { chatRequest } from "../lib/chat-client";
test("offline, invalid server response and aborted reads are handled without retrying mutations", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  try {
    globalThis.fetch = async () => {
      calls++;
      throw new TypeError("Failed to fetch");
    };
    await assert.rejects(
      () =>
        chatRequest("candidate", "/qa", {
          type: "task-response",
          answer: "Набранный ответ",
        }),
      /Нет связи.*текст сохранён/,
    );
    assert.equal(calls, 1);
    globalThis.fetch = async () =>
      new Response("<html>Ошибка шлюза</html>", { status: 502 });
    await assert.rejects(
      () => chatRequest("candidate", "/qa"),
      /временно недоступен/,
    );
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Время выполнения истекло" }), {
        status: 409,
      });
    await assert.rejects(
      () => chatRequest("candidate", "/qa", { type: "task-response" }),
      /истекло/,
    );
    const stop = new AbortController();
    stop.abort();
    globalThis.fetch = async () => {
      throw stop.signal.reason;
    };
    await assert.rejects(
      () => chatRequest("candidate", "/qa", undefined, stop.signal),
      (e) => e === stop.signal.reason,
    );
  } finally {
    globalThis.fetch = original;
  }
});

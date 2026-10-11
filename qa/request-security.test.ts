import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { readRequestBytes, readRequestJson, readRequestForm, parseRequestJson, RequestSecurityError } from "../lib/request-security";
import { safeImage } from "../lib/image-upload";
import { checkOrigin, errorResponse } from "../lib/store";
const request = (body: string, headers = {}) => new Request("http://localhost:5174/api/action", {method:"POST", headers, body});
const status = (n: number) => (e: unknown) => e instanceof RequestSecurityError && e.status === n;
test("body limit counts UTF-8 bytes and does not trust missing or fake Content-Length", async () => {
  await assert.rejects(readRequestBytes(request("я".repeat(20)), 30), status(413));
  await assert.rejects(readRequestBytes(request("x".repeat(40), {"Content-Length":"1"}), 30), status(413));
  let pulls = 0;
  const stream = new ReadableStream({ pull(c) { pulls++; c.enqueue(new Uint8Array(20)); } });
  const r = new Request("http://localhost:5174", {method:"POST", body:stream, duplex:"half"} as RequestInit);
  await assert.rejects(readRequestBytes(r, 30), status(413));
  assert(pulls < 10, "oversized streams stop promptly");
});
test("malformed, null and array JSON are rejected without internal errors", async () => {
  for (const s of ["null", "[]", "{broken", '"string"']) await assert.rejects(readRequestJson(request(s), 100), status(400));
  assert.deepEqual(await readRequestJson(request('{"text":"Ответ"}'), 100), {text:"Ответ"});
});
test("multipart is bounded before parser buffering", async () => {
  const form = new FormData();form.set("file", new File(["abc"],"test.txt"));
  const encoded = new Request("http://localhost:5174", {method:"POST", body:form});
  const headers = encoded.headers, bytes = await encoded.arrayBuffer();
  const r = new Request("http://localhost:5174", {method:"POST", headers, body:bytes});
  assert.equal((await readRequestForm(r, 2000)).get("file") instanceof File, true);
  await assert.rejects(readRequestForm(new Request("http://localhost:5174", {method:"POST",headers,body:bytes}), 20),status(413));
});
test("CSRF rejects missing/foreign/malformed origins and returns safe 403", () => {
  for (const origin of [undefined,"https://evil.example","null","bad:url"] ) {
    const r = request("{}", origin?{Origin:origin}:{});
    assert.throws(()=>checkOrigin(r), status(403));
  }
  checkOrigin(request("{}", {Origin: process.env.APP_URL || "http://localhost:5174"}));
  const e = errorResponse(new RequestSecurityError("Проверьте запрос", 413));
  assert.equal(e.status,413);assert.equal(e.headers.get("Cache-Control"),"no-store");
});
test("images are decoded and normalized: SVG, corrupt header and decompression bombs denied", async () => {
  await assert.rejects(safeImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')), status(400));
  await assert.rejects(safeImage(new Uint8Array([137,80,78,71,13,10,26,10,0,0])), status(400));
  const bomb = await sharp({create:{width:4001,height:4000,channels:3,background:"white"}}).png().toBuffer();
  await assert.rejects(safeImage(bomb),status(400));
  const png = await sharp({create:{width:40,height:30,channels:3,background:"red"}}).png().toBuffer();
  const result = await safeImage(new Uint8Array(png));
  const meta = await sharp(result).metadata(); assert.equal(meta.format,"webp");assert.equal(meta.width,40);assert.equal(meta.height,30);assert.equal(meta.exif,undefined);
});

test("deep or prototype-polluting request structures are rejected, ordinary code text is preserved", () => {
  assert.throws(()=>parseRequestJson('{"__proto__":{"polluted":true}}'), status(400));
  assert.throws(()=>parseRequestJson('{"value":'+ '{"x":'.repeat(100)+'0'+'}'.repeat(100)+'}'), status(400));
  assert.equal(({} as { polluted?: unknown }).polluted,undefined);
  assert.equal(parseRequestJson('{"answer":"class C { constructor() {} }"}').answer,"class C { constructor() {} }");
});

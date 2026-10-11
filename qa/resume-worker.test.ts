import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseResumeIsolated } from "../lib/resume-worker";
import { RequestSecurityError } from "../lib/request-security";
test("isolated PDF worker preserves the real text and photograph import", async () => {
  const b = new Uint8Array(await readFile("output/pdf/resume-benchmark/authored-photo-top-right.pdf"));
  const {parsed,photos,content} = await parseResumeIsolated(b);
  assert(parsed.skills?.includes("Python"));assert(parsed.skills?.includes("SQL"));assert(content.length>100);assert(photos.length>0);
  assert.equal((globalThis as typeof globalThis & { offerlyResumeWorkers?: number }).offerlyResumeWorkers,0);
});
test("corrupt PDF cannot crash the parent; worker slot is released after rejection", async () => {
  await assert.rejects(parseResumeIsolated(new TextEncoder().encode("%PDF-not-a-real-document")), e=>e instanceof RequestSecurityError);
  assert.equal((globalThis as typeof globalThis & { offerlyResumeWorkers?: number }).offerlyResumeWorkers,0);
});
test("oversubscribed PDF workers reject promptly instead of building an unbounded queue", async () => {
  (globalThis as typeof globalThis & { offerlyResumeWorkers?: number }).offerlyResumeWorkers=2;
  try { await assert.rejects(parseResumeIsolated(new Uint8Array()), e=>e instanceof RequestSecurityError&&e.status===429); }
  finally { (globalThis as typeof globalThis & { offerlyResumeWorkers?: number }).offerlyResumeWorkers=0; }
});

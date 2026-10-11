import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
const bytes = await readFile("docs/api/openapi.json", "utf8");
assert.equal(await readFile("public/openapi.json", "utf8"), bytes);
const doc = JSON.parse(bytes);
let references = 0;
const ids = new Set();
function visit(v) {
  if (!v || typeof v !== "object") return;
  if (v.$ref) {
    assert(v.$ref.startsWith("#/"));
    let target = doc;
    for (const key of v.$ref.slice(2).split("/")) target = target?.[key];
    assert(target, "Unresolved " + v.$ref);
    references++;
  }
  Object.values(v).forEach(visit);
}
visit(doc);
for (const entry of Object.values(doc.paths))
  for (const [method, op] of Object.entries(entry))
    if (["get", "post", "put", "patch", "delete"].includes(method)) {
      assert(op.operationId);
      assert(
        !ids.has(op.operationId),
        "Duplicate operationId " + op.operationId,
      );
      ids.add(op.operationId);
    }
let methods = 0;
async function routes(dir) {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const f = path.join(dir, ent.name);
    if (ent.isDirectory()) await routes(f);
    else if (ent.name === "route.ts") {
      const source = await readFile(f, "utf8");
      const url =
        "/" +
        path
          .dirname(f)
          .replace(/^app\//, "")
          .replaceAll("[", "{")
          .replaceAll("]", "}");
      for (const m of source.matchAll(
        /export (?:async )?function (GET|POST|PUT|PATCH|DELETE)/g,
      )) {
        assert(
          doc.paths[url]?.[m[1].toLowerCase()],
          `Undocumented ${m[1]} ${url}`,
        );
        methods++;
      }
    }
  }
}
await routes("app/api");
assert(doc.components.schemas.PublicAssessmentResult.properties.timeoutSummary);
assert(
  doc.components.schemas.EmployerTask.properties.status.enum.includes(
    "expired",
  ),
);
console.log(
  JSON.stringify({
    passed: true,
    paths: Object.keys(doc.paths).length,
    references,
    directRouteMethods: methods,
    matchingCopies: true,
  }),
);

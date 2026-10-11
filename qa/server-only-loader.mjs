// Next provides this marker through its bundler. Native Node policy tests use
// Next's own empty server implementation; this loader is never imported by app code.
import { registerHooks, createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const require = createRequire(import.meta.url);
const marker = pathToFileURL(
  require.resolve("next/dist/compiled/server-only/empty.js"),
).href;
registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(
      specifier === "server-only" ? marker : specifier,
      context,
    );
  },
});

import { build } from "esbuild";
await build({ entryPoints: ["scripts/resume-worker.ts"], outfile: "scripts/resume-worker.mjs", bundle: true, platform: "node", format: "esm", target: "node22", banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });

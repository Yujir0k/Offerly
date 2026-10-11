import { existsSync, readdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Upstream tests read historical locks relative to cwd. Never regenerate those locks.
const reference = resolve(
  process.env.ASSESSMENT_REFERENCE_DIR ||
    resolve(root, "../work/fsp-assessment-7.3.3-original/blabla"),
);
if (
  !existsSync(
    resolve(reference, "data/synthetic-validation/BASELINE_LOCK.json"),
  )
) {
  console.error(
    "Нужна полная исходная распаковка алгоритма. Укажите её корень через ASSESSMENT_REFERENCE_DIR; исторические locks не создаются заново.",
  );
  process.exit(1);
}
const testDir = resolve(root, "vendor/fsp-assessment/dist/test");
const requested = process.argv.slice(2);
const names = requested.length
  ? requested
  : readdirSync(testDir).filter((n) => n.endsWith(".test.js"));
if (
  names.some(
    (n) =>
      !/^[a-z0-9-]+\.test\.js$/.test(n) || !existsSync(resolve(testDir, n)),
  )
) {
  console.error(
    "Передайте имена скомпилированных файлов, например domain.test.js session.test.js.",
  );
  process.exit(1);
}
const concurrency = Number(process.env.ASSESSMENT_TEST_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16)
  throw new Error("ASSESSMENT_TEST_CONCURRENCY must be 1..16");
const result = spawnSync(
  process.execPath,
  [
    "--test",
    `--test-concurrency=${concurrency}`,
    ...names.map((n) => resolve(testDir, n)),
  ],
  {
    cwd: reference,
    stdio: "inherit",
  },
);
process.exit(result.status ?? 1);

import {
  mkdir,
  readFile,
  writeFile,
  rename,
  unlink,
  readdir,
} from "node:fs/promises";
import path from "node:path";
const root = path.resolve(process.env.UPLOAD_DIR || ".data/uploads");
function target(key: string) {
  if (
    !/^(avatars|resumes|company-media)\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(
      key,
    )
  )
    throw new Error("Недопустимый файл");
  if ([".", ".."].includes(key.split("/").pop()!))
    throw new Error("Недопустимый файл");
  return path.join(root, key);
}
type Metadata = {
  httpMetadata?: { contentType?: string };
  customMetadata?: Record<string, string>;
};
// Private durable volume. Replace this adapter with S3 without changing the API.
export const bucket = {
  async put(key: string, bytes: Uint8Array, metadata: Metadata = {}) {
    const file = target(key);
    await mkdir(path.dirname(file), { recursive: true });
    const tmp = file + "." + crypto.randomUUID() + ".tmp";
    await writeFile(tmp, bytes, { mode: 0o600 });
    await rename(tmp, file);
    await writeFile(file + ".json", JSON.stringify(metadata), { mode: 0o600 });
  },
  async get(key: string) {
    const file = target(key);
    try {
      const bytes = await readFile(file);
      const meta: Metadata = JSON.parse(await readFile(file + ".json", "utf8"));
      return {
        ...meta,
        size: bytes.length,
        body: new Uint8Array(bytes),
        arrayBuffer: async () =>
          bytes.buffer.slice(
            bytes.byteOffset,
            bytes.byteOffset + bytes.byteLength,
          ) as ArrayBuffer,
      };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  },
  async delete(keys: string | string[]) {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      const file = target(key);
      await Promise.all(
        [file, file + ".json"].map((f) =>
          unlink(f).catch((e) => {
            if (e.code !== "ENOENT") throw e;
          }),
        ),
      );
    }
  },
  async list({ prefix }: { prefix: string; cursor?: string }) {
    if (!/^(resumes|avatars|company-media)\/[a-zA-Z0-9_-]+\/$/.test(prefix))
      throw new Error("Недопустимая папка");
    const dir = path.join(root, prefix);
    const files = await readdir(dir).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    });
    return {
      objects: files
        .filter((f) => !f.endsWith(".json") && !f.endsWith(".tmp"))
        .map((f) => ({ key: prefix + f })),
      truncated: false,
      cursor: undefined as string | undefined,
    };
  },
};

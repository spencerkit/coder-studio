import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

interface AtomicJsonFileDeps {
  rename?: typeof rename;
  remove?: (path: string) => Promise<void>;
}

export async function writeJsonFileAtomic(
  path: string,
  value: unknown,
  deps: AtomicJsonFileDeps = {}
): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await (deps.rename ?? rename)(temporaryPath, path);
  } finally {
    await (deps.remove ?? ((valuePath) => rm(valuePath, { force: true })))(temporaryPath);
  }
}

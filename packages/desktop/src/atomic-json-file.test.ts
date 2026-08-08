import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { writeJsonFileAtomic } from "./atomic-json-file.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("writeJsonFileAtomic", () => {
  it("preserves the previous file and removes the temporary file when rename fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "atomic-json-"));
    tempDirs.push(root);
    const path = join(root, "state.json");
    await writeFile(path, '{"version":"old"}\n', "utf8");
    const remove = vi.fn(async (temporaryPath: string) => rm(temporaryPath, { force: true }));

    await expect(
      writeJsonFileAtomic(
        path,
        { version: "new" },
        {
          rename: vi.fn(async () => {
            throw new Error("rename failed");
          }),
          remove,
        }
      )
    ).rejects.toThrow("rename failed");

    expect(await readFile(path, "utf8")).toBe('{"version":"old"}\n');
    expect(remove).toHaveBeenCalledTimes(1);
  });
});

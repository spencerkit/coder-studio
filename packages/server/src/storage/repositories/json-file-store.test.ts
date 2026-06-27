import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("writeJsonFileAtomic", () => {
  const originalPlatform = process.platform;
  const tempDirs: string[] = [];

  afterEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.doUnmock("node:fs");
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
    tempDirs.splice(0).forEach((dir) => rmSync(dir, { recursive: true, force: true }));
  });

  it.each([
    "EPERM",
    "EBUSY",
    "EACCES",
  ])("retries transient Windows rename failures for %s until the file is committed", async (errorCode) => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    const tempDir = mkdtempSync(join(tmpdir(), "json-file-store-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "state", "record.json");
    let renameAttempts = 0;

    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        renameSync: (sourcePath: string, targetPath: string) => {
          renameAttempts += 1;
          if (renameAttempts < 3) {
            throw Object.assign(new Error(`${errorCode}: operation not permitted`), {
              code: errorCode,
            });
          }
          actual.renameSync(sourcePath, targetPath);
        },
      };
    });

    const { writeJsonFileAtomic } = await import("./json-file-store.js");

    writeJsonFileAtomic(filePath, { ok: true });

    expect(renameAttempts).toBe(3);
    expect(JSON.parse(readFileSync(filePath, "utf-8"))).toEqual({ ok: true });
    expect(readdirSync(join(tempDir, "state"))).toEqual(["record.json"]);
  });

  it("does not retry non-transient rename failures and removes the temp file", async () => {
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true,
    });

    const tempDir = mkdtempSync(join(tmpdir(), "json-file-store-"));
    tempDirs.push(tempDir);
    const filePath = join(tempDir, "state", "record.json");
    let renameAttempts = 0;

    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return {
        ...actual,
        renameSync: () => {
          renameAttempts += 1;
          throw Object.assign(new Error("EINVAL: invalid rename"), {
            code: "EINVAL",
          });
        },
      };
    });

    const { writeJsonFileAtomic } = await import("./json-file-store.js");

    expect(() => writeJsonFileAtomic(filePath, { ok: false })).toThrowError(
      /EINVAL: invalid rename/
    );
    expect(renameAttempts).toBe(1);
    expect(readdirSync(join(tempDir, "state"))).toEqual([]);
  });
});

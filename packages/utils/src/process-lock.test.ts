import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireProcessLock, ProcessLockError } from "./process-lock.js";

describe("process-lock", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes a lock file and releases it", () => {
    const dir = mkdtempSync(join(tmpdir(), "coder-studio-lock-"));
    tempDirs.push(dir);
    const lockPath = join(dir, ".runtime.lock.json");

    const release = acquireProcessLock({
      lockPath,
      pid: 3001,
      now: () => 1700000000000,
      metadata: { owner: "desktop" },
      processExists: () => true,
    });

    expect(existsSync(lockPath)).toBe(true);
    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({
      pid: 3001,
      owner: "desktop",
      acquiredAt: 1700000000000,
    });

    release();
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes a stale lock before reacquiring", () => {
    const dir = mkdtempSync(join(tmpdir(), "coder-studio-lock-"));
    tempDirs.push(dir);
    const lockPath = join(dir, ".runtime.lock.json");

    writeFileSync(lockPath, JSON.stringify({ pid: 91234, acquiredAt: 1 }), "utf8");

    const release = acquireProcessLock({
      lockPath,
      pid: 4002,
      processExists: () => false,
    });

    expect(JSON.parse(readFileSync(lockPath, "utf8"))).toMatchObject({ pid: 4002 });
    release();
  });

  it("rejects an active competing lock", () => {
    const dir = mkdtempSync(join(tmpdir(), "coder-studio-lock-"));
    tempDirs.push(dir);
    const lockPath = join(dir, ".runtime.lock.json");

    writeFileSync(lockPath, JSON.stringify({ pid: 5003, acquiredAt: 1 }), "utf8");

    expect(() =>
      acquireProcessLock({
        lockPath,
        pid: 5004,
        processExists: (pid) => pid === 5003,
      })
    ).toThrow(ProcessLockError);
  });
});

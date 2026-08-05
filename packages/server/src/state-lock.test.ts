import { existsSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireStateLock } from "./state-lock.js";

const tempDirs = new Set<string>();

afterEach(async () => {
  await Promise.all(
    [...tempDirs].map((path) => rm(path, { recursive: true, force: true }).catch(() => undefined))
  );
  tempDirs.clear();
});

async function createStateDir(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "coder-studio-state-lock-"));
  tempDirs.add(path);
  return path;
}

describe("state lock", () => {
  it("prevents a second live process from opening the same state directory", async () => {
    const stateDir = await createStateDir();
    const first = acquireStateLock(stateDir, { pid: 101, isProcessRunning: () => true });

    expect(() =>
      acquireStateLock(stateDir, { pid: 202, isProcessRunning: (pid) => pid === 101 })
    ).toThrow(/already in use by process 101/);

    first.release();
    expect(existsSync(join(stateDir, "server.lock"))).toBe(false);
  });

  it("replaces a stale lock and only removes locks it still owns", async () => {
    const stateDir = await createStateDir();
    acquireStateLock(stateDir, { pid: 101, isProcessRunning: () => false });
    const second = acquireStateLock(stateDir, { pid: 202, isProcessRunning: () => false });
    const lockPath = second.path as string;
    const record = JSON.parse(await readFile(lockPath, "utf8")) as { token: string };
    writeFileSync(lockPath, JSON.stringify({ pid: 303, token: "replacement", startedAt: 1 }));

    second.release();
    expect(existsSync(lockPath)).toBe(true);
    expect(record.token).not.toBe("replacement");
  });

  it("does not create a lock for in-memory state", () => {
    const lock = acquireStateLock(":memory:");
    expect(lock.path).toBeNull();
    expect(() => lock.release()).not.toThrow();
  });
});

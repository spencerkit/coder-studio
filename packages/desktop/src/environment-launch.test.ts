import { link, mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  EnvironmentLaunchStore,
  type EnvironmentLaunchStoreOptions,
  isEnvironmentLaunchRequestId,
} from "./environment-launch.js";
import type { DesktopEnvironmentTarget } from "./protocol.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createStore(
  options?: EnvironmentLaunchStoreOptions
): Promise<EnvironmentLaunchStore> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-test-"));
  roots.push(root);
  return new EnvironmentLaunchStore(root, options);
}

function target(id: string, label = id): DesktopEnvironmentTarget {
  return { id, kind: "native", label };
}

describe("EnvironmentLaunchStore", () => {
  it("creates requests beneath the trusted root and rejects invalid request paths", async () => {
    const store = await createStore();
    const request = await store.create(target("native", "Local: Windows"));
    const requestId = request.requestId;
    const trustedRoot = roots[0]!;

    expect(isEnvironmentLaunchRequestId(requestId)).toBe(true);
    expect(store.getRequestPath(requestId)).toBe(
      resolve(trustedRoot, "environment-launches", `${requestId}.json`)
    );
    await expect(readFile(store.getRequestPath(requestId), "utf8")).resolves.toContain(
      '"status": "pending"'
    );
    expect(() => store.getRequestPath("../outside")).toThrow(
      "Invalid environment launch request id"
    );
    expect(isEnvironmentLaunchRequestId("not-a-uuid")).toBe(false);
  });

  it("waits while pending and returns the pid after markReady", async () => {
    const store = await createStore();
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await store.create(requestTarget)).requestId;
    let settled = false;
    const waiting = store
      .waitForTerminal(requestId, requestTarget, { pollIntervalMs: 2, timeoutMs: 250 })
      .then((pid) => {
        settled = true;
        return pid;
      });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 12));
    expect(settled).toBe(false);
    await expect(store.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    await expect(waiting).resolves.toMatchObject({ status: "ready", pid: 4321 });
  });

  it("surfaces a matching failure message to the waiter", async () => {
    const store = await createStore();
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;
    const waiting = store.waitForTerminal(requestId, requestTarget, {
      pollIntervalMs: 2,
      timeoutMs: 250,
    });
    const failure = expect(waiting).rejects.toThrow("The environment process exited.");

    await expect(
      store.markFailed(requestId, requestTarget.id, "The environment process exited.")
    ).resolves.toBe(true);
    await failure;
  });

  it("times out atomically and rejects a late ready transition", async () => {
    const store = await createStore();
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await store.create(requestTarget)).requestId;

    await expect(
      store.waitForTerminal(requestId, requestTarget, { pollIntervalMs: 2, timeoutMs: 12 })
    ).rejects.toThrow(
      "Timed out waiting for WSL: Ubuntu to open. It may still be starting; try again to focus it."
    );
    await expect(store.read(requestId)).resolves.toMatchObject({
      status: "timed-out",
      message:
        "Timed out waiting for WSL: Ubuntu to open. It may still be starting; try again to focus it.",
    });
    await expect(store.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(false);
    await expect(store.read(requestId)).resolves.toMatchObject({ status: "timed-out" });
  });

  it("does not transition a request for a different environment", async () => {
    const store = await createStore();
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;

    await expect(store.markReady(requestId, "wsl:ubuntu", 4321)).resolves.toBe(false);
    await expect(store.markFailed(requestId, "wsl:ubuntu", "wrong target")).resolves.toBe(false);
    await expect(store.read(requestId)).resolves.toMatchObject({
      environmentId: requestTarget.id,
      status: "pending",
    });
  });

  it("removes stale launch files while preserving current requests", async () => {
    const store = await createStore();
    const oldId = (await store.create(target("old"))).requestId;
    const currentId = (await store.create(target("current"))).requestId;
    const oldPath = store.getRequestPath(oldId);
    const currentPath = store.getRequestPath(currentId);
    await expect(store.markReady(oldId, "old", 1234)).resolves.toBe(true);
    const oldTerminalPath = oldPath.replace(/\.json$/, ".terminal.json");
    const old = new Date(Date.now() - 10_000);
    await utimes(oldPath, old, old);
    await utimes(oldTerminalPath, old, old);

    await store.cleanupStale(2_000);
    await expect(stat(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(oldTerminalPath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(currentPath)).resolves.toBeDefined();
  });

  it("waits through one store while an independent store marks ready", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const writer = new EnvironmentLaunchStore(root);
    const waiter = new EnvironmentLaunchStore(root);
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await writer.create(requestTarget)).requestId;
    const waiting = waiter.waitForTerminal(requestId, requestTarget, {
      pollIntervalMs: 2,
      timeoutMs: 250,
    });

    await expect(writer.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    await expect(waiting).resolves.toMatchObject({ status: "ready", pid: 4321 });
  });

  it("allows exactly one terminal transition across independent stores", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const readyStore = new EnvironmentLaunchStore(root);
    const failedStore = new EnvironmentLaunchStore(root);
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await readyStore.create(requestTarget)).requestId;

    const outcomes = await Promise.all([
      readyStore.markReady(requestId, requestTarget.id, 4321),
      failedStore.markFailed(requestId, requestTarget.id, "startup failed"),
    ]);

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    await expect(readyStore.read(requestId)).resolves.toMatchObject({
      status: expect.any(String),
    });
    await expect(readyStore.read(requestId)).resolves.toMatchObject({
      status: expect.stringMatching(/^(ready|failed)$/),
    });
  });

  it("keeps timed-out state when a different store sends a late ready", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const waiter = new EnvironmentLaunchStore(root);
    const targetStore = new EnvironmentLaunchStore(root);
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await waiter.create(requestTarget)).requestId;

    await expect(
      waiter.waitForTerminal(requestId, requestTarget, { pollIntervalMs: 2, timeoutMs: 12 })
    ).rejects.toThrow("Timed out waiting for WSL: Ubuntu to open");
    await expect(targetStore.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(false);
    await expect(waiter.read(requestId)).resolves.toMatchObject({ status: "timed-out" });
  });

  it("commits terminal readiness without waiting on stale lock artifacts", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const owner = new EnvironmentLaunchStore(root);
    const targetStore = new EnvironmentLaunchStore(root);
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await owner.create(requestTarget)).requestId;
    const lockPath = `${owner.getRequestPath(requestId)}.lock`;
    await mkdir(lockPath);
    await mkdir(`${lockPath}.gate`);

    await expect(targetStore.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    await expect(targetStore.read(requestId)).resolves.toMatchObject({
      status: "ready",
      pid: 4321,
    });
  });

  it("reads a terminal claim even when the pending request file is gone", async () => {
    const store = await createStore();
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;
    const requestPath = store.getRequestPath(requestId);

    await expect(store.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    await rm(requestPath, { force: true });
    await expect(store.read(requestId)).resolves.toMatchObject({ status: "ready", pid: 4321 });
    await expect(stat(requestPath.replace(/\.json$/, ".terminal.json"))).resolves.toBeDefined();
  });

  it("preserves a failed terminal claim independently of the pending request", async () => {
    const store = await createStore();
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;
    const requestPath = store.getRequestPath(requestId);

    await expect(store.markFailed(requestId, requestTarget.id, "startup failed")).resolves.toBe(
      true
    );
    await rm(requestPath, { force: true });
    await expect(store.read(requestId)).resolves.toMatchObject({
      status: "failed",
      message: "startup failed",
    });
  });

  it("cleans a stale terminal-only claim after its pending file is removed", async () => {
    const store = await createStore();
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;
    const requestPath = store.getRequestPath(requestId);
    const terminalPath = requestPath.replace(/\.json$/, ".terminal.json");
    await expect(store.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    await rm(requestPath, { force: true });
    const staleTime = new Date(Date.now() - 10_000);
    await utimes(terminalPath, staleTime, staleTime);

    await store.cleanupStale(2_000);
    await expect(stat(terminalPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("returns null and fails fast when the terminal claim is malformed or nonterminal", async () => {
    const store = await createStore();
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;
    const requestPath = store.getRequestPath(requestId);
    const terminalPath = requestPath.replace(/\.json$/, ".terminal.json");

    await writeFile(terminalPath, "not-json", "utf8");
    await expect(store.read(requestId)).resolves.toBeNull();
    await expect(
      store.waitForTerminal(requestId, requestTarget, { pollIntervalMs: 2, timeoutMs: 250 })
    ).rejects.toThrow(`Environment launch request disappeared: ${requestId}`);

    await writeFile(
      terminalPath,
      `${JSON.stringify({
        schemaVersion: 1,
        requestId,
        environmentId: requestTarget.id,
        status: "pending",
        updatedAt: Date.now(),
      })}\n`,
      "utf8"
    );
    await expect(store.read(requestId)).resolves.toBeNull();
  });

  it("retries transient terminal publication errors through the real transition", async () => {
    let attempts = 0;
    const store = await createStore({
      link: async (source, destination) => {
        attempts += 1;
        if (attempts < 3) {
          const error = Object.assign(new Error("transient link failure"), { code: "EPERM" });
          throw error;
        }
        await link(source, destination);
      },
    });
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await store.create(requestTarget)).requestId;

    await expect(store.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    expect(attempts).toBe(3);
    await expect(store.read(requestId)).resolves.toMatchObject({ status: "ready", pid: 4321 });
  });
});

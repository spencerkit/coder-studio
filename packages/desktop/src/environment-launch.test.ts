import { mkdir, mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentLaunchStore, isEnvironmentLaunchRequestId } from "./environment-launch.js";
import type { DesktopEnvironmentTarget } from "./protocol.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function createStore(): Promise<EnvironmentLaunchStore> {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-test-"));
  roots.push(root);
  return new EnvironmentLaunchStore(root);
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
    const old = new Date(Date.now() - 10_000);
    await utimes(oldPath, old, old);

    await store.cleanupStale(2_000);
    await expect(stat(oldPath)).rejects.toMatchObject({ code: "ENOENT" });
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

  it("finalizes timeout after a blocked lock is released before rejecting", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const waiter = new EnvironmentLaunchStore(root);
    const targetStore = new EnvironmentLaunchStore(root);
    const requestTarget = target("wsl:ubuntu", "WSL: Ubuntu");
    const requestId = (await waiter.create(requestTarget)).requestId;
    const lockPath = `${waiter.getRequestPath(requestId)}.lock`;
    await mkdir(lockPath);
    const releaseBlockedLock = new Promise<void>((resolveRelease) => {
      setTimeout(() => {
        void rm(lockPath, { recursive: true, force: true }).then(resolveRelease);
      }, 350);
    });

    await expect(
      waiter.waitForTerminal(requestId, requestTarget, { pollIntervalMs: 2, timeoutMs: 12 })
    ).rejects.toThrow("Timed out waiting for WSL: Ubuntu to open");
    await releaseBlockedLock;
    await expect(waiter.read(requestId)).resolves.toMatchObject({ status: "timed-out" });
    await expect(targetStore.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(false);
  });

  it("does not let an old lock owner release a successor lock", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const oldOwner = new EnvironmentLaunchStore(root);
    const successor = new EnvironmentLaunchStore(root);
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await oldOwner.create(requestTarget)).requestId;
    const acquire = (
      oldOwner as unknown as {
        acquireTransitionLock(id: string): Promise<(() => Promise<void>) | null>;
      }
    ).acquireTransitionLock;
    const oldRelease = await acquire.call(oldOwner, requestId);
    expect(oldRelease).not.toBeNull();
    const lockPath = `${oldOwner.getRequestPath(requestId)}.lock`;
    const staleTime = new Date(Date.now() - 60_000);
    await utimes(`${lockPath}/owner`, staleTime, staleTime);

    const successorAcquire = (
      successor as unknown as {
        acquireTransitionLock(id: string): Promise<(() => Promise<void>) | null>;
      }
    ).acquireTransitionLock;
    const successorRelease = await successorAcquire.call(successor, requestId);
    expect(successorRelease).not.toBeNull();
    await oldRelease!();
    await expect(stat(lockPath)).resolves.toBeDefined();
    await successorRelease!();
    await expect(successor.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(true);
    await expect(oldOwner.read(requestId)).resolves.toMatchObject({ status: "ready", pid: 4321 });
  });

  it("bounds transition lock acquisition when an abandoned lock remains", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "coder-studio-environment-launch-pair-test-"));
    roots.push(root);
    const owner = new EnvironmentLaunchStore(root);
    const contender = new EnvironmentLaunchStore(root);
    const requestTarget = target("native", "Local: Windows");
    const requestId = (await owner.create(requestTarget)).requestId;
    await mkdir(`${owner.getRequestPath(requestId)}.lock`);

    await expect(contender.markReady(requestId, requestTarget.id, 4321)).resolves.toBe(false);
    await expect(owner.read(requestId)).resolves.toMatchObject({ status: "pending" });
  });
});

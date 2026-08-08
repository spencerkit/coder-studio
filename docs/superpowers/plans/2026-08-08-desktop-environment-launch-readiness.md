# Desktop Environment Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep environment switching visibly pending until the target Desktop window is ready, while preserving and fulfilling focus requests received during target startup.

**Architecture:** Add a request-scoped, file-backed launch handshake under the shared Desktop user-data root. A small activation coordinator queues Electron `second-instance` requests until a BrowserWindow is ready; the source IPC resolves only after the target acknowledges readiness, fails, or reaches a bounded timeout.

**Tech Stack:** TypeScript, Electron 43, Node.js child processes and filesystem APIs, React, Vitest, Testing Library, pnpm.

---

## File Structure

**New files:**

- `packages/desktop/src/environment-launch.ts` — validated launch request IDs, atomic status files, readiness waiting, failure/timeout handling, and stale cleanup.
- `packages/desktop/src/environment-launch.test.ts` — deterministic status-store and timeout coverage.
- `packages/desktop/src/environment-activation.ts` — queues focus acknowledgements until a target window is ready.
- `packages/desktop/src/environment-activation.test.ts` — startup race, duplicate request, immediate focus, and failure coverage.

**Modified files:**

- `packages/desktop/src/environment-instance.ts` — carries an optional launch request ID in target process arguments.
- `packages/desktop/src/environment-instance.test.ts` — verifies launch request serialization and parsing.
- `packages/desktop/src/main.ts` — connects spawning, single-instance delivery, BrowserWindow readiness, and startup failure to the handshake.
- `packages/web/src/features/topbar/components/environment-switcher.test.tsx` — locks in persistent Loading, popover reopen, success, and retry behavior.

No production web component change is expected: its existing `openingId` state already remains pending for the lifetime of `api.openEnvironment()`.

## Task 1: File-backed launch request store

**Files:**

- Create: `packages/desktop/src/environment-launch.ts`
- Create: `packages/desktop/src/environment-launch.test.ts`

- [ ] **Step 1: Write failing launch-store tests**

Create `packages/desktop/src/environment-launch.test.ts`:

```ts
import { mkdtemp, readFile, rm, stat, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EnvironmentLaunchStore, isEnvironmentLaunchRequestId } from "./environment-launch.js";
import { createWslEnvironmentTarget } from "./environment-state.js";

const roots: string[] = [];

async function createStore() {
  const root = await mkdtemp(resolve(tmpdir(), "coder-studio-launch-test-"));
  roots.push(root);
  return { root, store: new EnvironmentLaunchStore(root) };
}

describe("EnvironmentLaunchStore", () => {
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
  });

  it("creates a validated pending request below the trusted root", async () => {
    const { root, store } = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu");

    const request = await store.create(target);

    expect(isEnvironmentLaunchRequestId(request.requestId)).toBe(true);
    expect(request).toMatchObject({ environmentId: target.id, status: "pending" });
    expect(store.getRequestPath(request.requestId).startsWith(resolve(root, "environment-launches"))).toBe(true);
    await expect(readFile(store.getRequestPath(request.requestId), "utf8")).resolves.toContain(target.id);
    expect(() => store.getRequestPath("../../outside")).toThrow("Invalid environment launch request id");
  });

  it("waits for target readiness instead of resolving after request creation", async () => {
    const { store } = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu");
    const request = await store.create(target);
    let settled = false;
    const waiting = store
      .waitForTerminal(request.requestId, target, { pollIntervalMs: 5, timeoutMs: 500 })
      .finally(() => {
        settled = true;
      });

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
    expect(settled).toBe(false);

    await store.markReady(request.requestId, target.id, 1234);
    await expect(waiting).resolves.toMatchObject({ status: "ready", pid: 1234 });
  });

  it("returns target startup failures", async () => {
    const { store } = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu");
    const request = await store.create(target);
    const waiting = store.waitForTerminal(request.requestId, target, {
      pollIntervalMs: 5,
      timeoutMs: 500,
    });

    await store.markFailed(request.requestId, target.id, "Backend failed to start");

    await expect(waiting).rejects.toThrow("Backend failed to start");
  });

  it("times out without terminating a late target", async () => {
    const { store } = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu");
    const request = await store.create(target);

    await expect(
      store.waitForTerminal(request.requestId, target, {
        pollIntervalMs: 5,
        timeoutMs: 25,
      })
    ).rejects.toThrow("Timed out waiting for WSL: Ubuntu to open");
    await expect(store.read(request.requestId)).resolves.toMatchObject({ status: "timed-out" });
    await expect(store.markReady(request.requestId, target.id, 1234)).resolves.toBe(false);
  });

  it("rejects target-mismatched acknowledgements", async () => {
    const { store } = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu");
    const request = await store.create(target);

    await expect(store.markReady(request.requestId, "native", 1234)).resolves.toBe(false);
    await expect(store.read(request.requestId)).resolves.toMatchObject({ status: "pending" });
  });

  it("removes stale requests and keeps current requests", async () => {
    const { store } = await createStore();
    const target = createWslEnvironmentTarget("Ubuntu");
    const stale = await store.create(target);
    const current = await store.create(target);
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000);
    await utimes(store.getRequestPath(stale.requestId), old, old);

    await store.cleanupStale(24 * 60 * 60 * 1000);

    await expect(stat(store.getRequestPath(stale.requestId))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(stat(store.getRequestPath(current.requestId))).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Run the tests and verify the module is missing**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-launch.test.ts
```

Expected: FAIL because `./environment-launch.js` does not exist.

- [ ] **Step 3: Implement the launch request store**

Create `packages/desktop/src/environment-launch.ts`:

```ts
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DesktopEnvironmentTarget } from "./protocol.js";

export const DEFAULT_ENVIRONMENT_LAUNCH_TIMEOUT_MS = 45_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const REQUEST_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EnvironmentLaunchStatusKind = "pending" | "ready" | "failed" | "timed-out";

export interface EnvironmentLaunchStatus {
  schemaVersion: 1;
  requestId: string;
  environmentId: string;
  status: EnvironmentLaunchStatusKind;
  pid?: number;
  message?: string;
  updatedAt: number;
}

interface WaitOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export function isEnvironmentLaunchRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

function isStatus(value: unknown): value is EnvironmentLaunchStatus {
  if (!value || typeof value !== "object") return false;
  const status = value as Partial<EnvironmentLaunchStatus>;
  return (
    status.schemaVersion === 1 &&
    isEnvironmentLaunchRequestId(status.requestId) &&
    typeof status.environmentId === "string" &&
    ["pending", "ready", "failed", "timed-out"].includes(status.status ?? "") &&
    typeof status.updatedAt === "number"
  );
}

async function renameWithRetry(source: string, destination: string): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (!code || !["EPERM", "EACCES", "EBUSY"].includes(code) || attempt === 5) throw error;
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 20 * 2 ** attempt));
    }
  }
}

export class EnvironmentLaunchStore {
  private readonly launchRoot: string;

  constructor(rootUserDataDir: string) {
    this.launchRoot = resolve(rootUserDataDir, "environment-launches");
  }

  getRequestPath(requestId: string): string {
    if (!isEnvironmentLaunchRequestId(requestId)) {
      throw new Error("Invalid environment launch request id");
    }
    return resolve(this.launchRoot, `${requestId}.json`);
  }

  async create(target: DesktopEnvironmentTarget): Promise<EnvironmentLaunchStatus> {
    const status: EnvironmentLaunchStatus = {
      schemaVersion: 1,
      requestId: randomUUID(),
      environmentId: target.id,
      status: "pending",
      updatedAt: Date.now(),
    };
    await this.write(status);
    return status;
  }

  async read(requestId: string): Promise<EnvironmentLaunchStatus | null> {
    try {
      const parsed: unknown = JSON.parse(await readFile(this.getRequestPath(requestId), "utf8"));
      return isStatus(parsed) ? parsed : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  markReady(requestId: string, environmentId: string, pid: number): Promise<boolean> {
    return this.finish(requestId, environmentId, { status: "ready", pid });
  }

  markFailed(requestId: string, environmentId: string, message: string): Promise<boolean> {
    return this.finish(requestId, environmentId, { status: "failed", message });
  }

  async waitForTerminal(
    requestId: string,
    target: DesktopEnvironmentTarget,
    options: WaitOptions = {}
  ): Promise<EnvironmentLaunchStatus> {
    const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const timeoutMs = options.timeoutMs ?? DEFAULT_ENVIRONMENT_LAUNCH_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const status = await this.read(requestId);
      if (!status) throw new Error(`Environment launch request disappeared: ${requestId}`);
      if (status.environmentId !== target.id) {
        throw new Error(`Environment launch request target mismatch: ${requestId}`);
      }
      if (status.status === "ready") return status;
      if (status.status === "failed" || status.status === "timed-out") {
        throw new Error(status.message ?? `Unable to open ${target.label}`);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, pollIntervalMs));
    }

    const message = `Timed out waiting for ${target.label} to open. It may still be starting; try again to focus it.`;
    await this.finish(requestId, target.id, { status: "timed-out", message });
    const latest = await this.read(requestId);
    if (latest?.status === "ready") return latest;
    throw new Error(latest?.message ?? message);
  }

  async cleanupStale(maxAgeMs: number, now = Date.now()): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(this.launchRoot, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const path = resolve(this.launchRoot, entry.name);
          const details = await stat(path);
          if (now - details.mtimeMs > maxAgeMs) await rm(path, { force: true });
        })
    );
  }

  private async finish(
    requestId: string,
    environmentId: string,
    result: Pick<EnvironmentLaunchStatus, "status"> &
      Partial<Pick<EnvironmentLaunchStatus, "message" | "pid">>
  ): Promise<boolean> {
    const current = await this.read(requestId);
    if (!current || current.environmentId !== environmentId || current.status !== "pending") {
      return false;
    }
    await this.write({ ...current, ...result, updatedAt: Date.now() });
    return true;
  }

  private async write(status: EnvironmentLaunchStatus): Promise<void> {
    const destination = this.getRequestPath(status.requestId);
    await mkdir(dirname(destination), { recursive: true });
    const temporaryPath = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(status, null, 2)}\n`, "utf8");
    try {
      await renameWithRetry(temporaryPath, destination);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }
}
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-launch.test.ts
```

Expected: 1 test file passed, 6 tests passed.

- [ ] **Step 5: Commit the store**

```bash
git add packages/desktop/src/environment-launch.ts packages/desktop/src/environment-launch.test.ts
git commit -m "feat(desktop): add environment launch readiness store"
```

## Task 2: Carry launch requests across process boundaries

**Files:**

- Modify: `packages/desktop/src/environment-instance.ts`
- Modify: `packages/desktop/src/environment-instance.test.ts`

- [ ] **Step 1: Add failing command-line tests**

Extend `packages/desktop/src/environment-instance.test.ts` imports with:

```ts
import {
  createEnvironmentInstanceArgs,
  ENVIRONMENT_INSTANCE_DISTRO_SWITCH,
  ENVIRONMENT_INSTANCE_ROOT_SWITCH,
  ENVIRONMENT_INSTANCE_TARGET_SWITCH,
  ENVIRONMENT_LAUNCH_REQUEST_SWITCH,
  getEnvironmentInstanceRoot,
  getEnvironmentInstanceUserDataDir,
  readEnvironmentInstanceTarget,
  readEnvironmentLaunchRequestId,
} from "./environment-instance.js";
```

Add this test inside the existing `describe` block:

```ts
it("carries a validated launch request to the target process", () => {
  const root = resolve("C:/Users/test/AppData/Roaming/Coder Studio");
  const target = createWslEnvironmentTarget("Ubuntu");
  const requestId = "123e4567-e89b-42d3-a456-426614174000";

  expect(createEnvironmentInstanceArgs(root, target, requestId)).toContain(
    `--${ENVIRONMENT_LAUNCH_REQUEST_SWITCH}=${requestId}`
  );
  expect(
    readEnvironmentLaunchRequestId(commandLine({ [ENVIRONMENT_LAUNCH_REQUEST_SWITCH]: requestId }))
  ).toBe(requestId);
  expect(
    readEnvironmentLaunchRequestId(commandLine({ [ENVIRONMENT_LAUNCH_REQUEST_SWITCH]: "../bad" }))
  ).toBeNull();
});
```

- [ ] **Step 2: Run the test and verify the new exports are absent**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-instance.test.ts
```

Expected: FAIL because the launch request switch and reader are not exported.

- [ ] **Step 3: Implement request argument serialization**

In `packages/desktop/src/environment-instance.ts`, import validation:

```ts
import { isEnvironmentLaunchRequestId } from "./environment-launch.js";
```

Add the switch constant beside the existing environment switches:

```ts
export const ENVIRONMENT_LAUNCH_REQUEST_SWITCH = "coder-studio-environment-launch-request";
```

Add the reader after `readEnvironmentInstanceTarget`:

```ts
export function readEnvironmentLaunchRequestId(
  commandLine: CommandLineSwitchReader
): string | null {
  const requestId = commandLine.getSwitchValue(ENVIRONMENT_LAUNCH_REQUEST_SWITCH).trim();
  return isEnvironmentLaunchRequestId(requestId) ? requestId : null;
}
```

Change `createEnvironmentInstanceArgs` to accept and append an optional validated request:

```ts
export function createEnvironmentInstanceArgs(
  rootUserDataDir: string,
  target: DesktopEnvironmentTarget,
  launchRequestId?: string
): string[] {
  const root = resolve(rootUserDataDir);
  const args = [
    `--user-data-dir=${getEnvironmentInstanceUserDataDir(root, target)}`,
    `--${ENVIRONMENT_INSTANCE_ROOT_SWITCH}=${root}`,
    `--${ENVIRONMENT_INSTANCE_TARGET_SWITCH}=${target.kind}`,
  ];
  if (target.kind === "wsl") {
    if (!target.distro) throw new Error("A WSL Desktop instance requires a distribution name");
    args.push(`--${ENVIRONMENT_INSTANCE_DISTRO_SWITCH}=${target.distro}`);
  }
  if (launchRequestId) {
    if (!isEnvironmentLaunchRequestId(launchRequestId)) {
      throw new Error("Invalid environment launch request id");
    }
    args.push(`--${ENVIRONMENT_LAUNCH_REQUEST_SWITCH}=${launchRequestId}`);
  }
  return args;
}
```

- [ ] **Step 4: Run command-line and store tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-instance.test.ts src/environment-launch.test.ts
```

Expected: 2 test files passed, 11 tests passed.

- [ ] **Step 5: Commit the process argument support**

```bash
git add packages/desktop/src/environment-instance.ts packages/desktop/src/environment-instance.test.ts
git commit -m "feat(desktop): pass environment launch request ids"
```

## Task 3: Queue activation until a window is ready

**Files:**

- Create: `packages/desktop/src/environment-activation.ts`
- Create: `packages/desktop/src/environment-activation.test.ts`

- [ ] **Step 1: Write failing activation coordinator tests**

Create `packages/desktop/src/environment-activation.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { EnvironmentActivationCoordinator } from "./environment-activation.js";

function createCoordinator() {
  const focusWindow = vi.fn(() => true);
  const markReady = vi.fn(async () => undefined);
  const markFailed = vi.fn(async () => undefined);
  return {
    coordinator: new EnvironmentActivationCoordinator({ focusWindow, markFailed, markReady }),
    focusWindow,
    markFailed,
    markReady,
  };
}

describe("EnvironmentActivationCoordinator", () => {
  it("queues a request received before window readiness", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();

    await coordinator.request("request-1");
    expect(focusWindow).not.toHaveBeenCalled();
    expect(markReady).not.toHaveBeenCalled();

    await coordinator.markWindowReady();
    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-1");
  });

  it("focuses and acknowledges immediately after readiness", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();
    await coordinator.markWindowReady();
    focusWindow.mockClear();

    await coordinator.request("request-2");

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).toHaveBeenCalledWith("request-2");
  });

  it("deduplicates repeated startup requests", async () => {
    const { coordinator, markReady } = createCoordinator();

    await coordinator.request("request-1");
    await coordinator.request("request-1");
    await coordinator.markWindowReady();

    expect(markReady).toHaveBeenCalledTimes(1);
  });

  it("queues ordinary focus requests that have no acknowledgement id", async () => {
    const { coordinator, focusWindow, markReady } = createCoordinator();

    await coordinator.request();
    await coordinator.markWindowReady();

    expect(focusWindow).toHaveBeenCalledOnce();
    expect(markReady).not.toHaveBeenCalled();
  });

  it("fails every pending launch request on startup failure", async () => {
    const { coordinator, markFailed, markReady } = createCoordinator();
    await coordinator.request("request-1");
    await coordinator.request("request-2");

    await coordinator.failPending("Target startup failed");

    expect(markFailed).toHaveBeenCalledTimes(2);
    expect(markFailed).toHaveBeenCalledWith("request-1", "Target startup failed");
    expect(markFailed).toHaveBeenCalledWith("request-2", "Target startup failed");
    expect(markReady).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test and verify the coordinator is missing**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-activation.test.ts
```

Expected: FAIL because `./environment-activation.js` does not exist.

- [ ] **Step 3: Implement the activation coordinator**

Create `packages/desktop/src/environment-activation.ts`:

```ts
export interface EnvironmentActivationOptions {
  focusWindow: () => boolean;
  markReady: (requestId: string) => Promise<void>;
  markFailed: (requestId: string, message: string) => Promise<void>;
}

export class EnvironmentActivationCoordinator {
  private readonly pendingRequestIds = new Set<string>();
  private focusRequested = false;
  private windowReady = false;
  private flushPromise: Promise<void> | null = null;

  constructor(private readonly options: EnvironmentActivationOptions) {}

  request(requestId?: string): Promise<void> {
    this.focusRequested = true;
    if (requestId) this.pendingRequestIds.add(requestId);
    return this.scheduleFlush();
  }

  markWindowReady(): Promise<void> {
    this.windowReady = true;
    this.focusRequested = true;
    return this.scheduleFlush();
  }

  markWindowUnavailable(): void {
    this.windowReady = false;
  }

  async failPending(message: string): Promise<void> {
    const requestIds = [...this.pendingRequestIds];
    this.pendingRequestIds.clear();
    this.focusRequested = false;
    await Promise.all(requestIds.map((requestId) => this.options.markFailed(requestId, message)));
  }

  private scheduleFlush(): Promise<void> {
    if (!this.windowReady || !this.focusRequested) return Promise.resolve();
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = this.flush().finally(() => {
      this.flushPromise = null;
      if (this.windowReady && this.focusRequested) void this.scheduleFlush();
    });
    return this.flushPromise;
  }

  private async flush(): Promise<void> {
    while (this.windowReady && this.focusRequested) {
      if (!this.options.focusWindow()) {
        this.windowReady = false;
        return;
      }
      this.focusRequested = false;
      const requestIds = [...this.pendingRequestIds];
      requestIds.forEach((requestId) => this.pendingRequestIds.delete(requestId));
      await Promise.all(requestIds.map((requestId) => this.options.markReady(requestId)));
    }
  }
}
```

- [ ] **Step 4: Run the activation tests**

Run:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-activation.test.ts
```

Expected: 1 test file passed, 5 tests passed.

- [ ] **Step 5: Commit the activation coordinator**

```bash
git add packages/desktop/src/environment-activation.ts packages/desktop/src/environment-activation.test.ts
git commit -m "feat(desktop): queue environment activation requests"
```

## Task 4: Wire readiness into the Electron main process

**Files:**

- Modify: `packages/desktop/src/main.ts`

- [ ] **Step 1: Establish the integration failure before editing**

Run the current focused suite:

```bash
pnpm --filter @coder-studio/desktop exec vitest run src/environment-launch.test.ts src/environment-instance.test.ts src/environment-activation.test.ts
```

Expected: PASS. This establishes that the isolated units work while `main.ts` still returns on the child `spawn` event.

- [ ] **Step 2: Add imports, shared state, and activation callbacks**

In `packages/desktop/src/main.ts`, add:

```ts
import { EnvironmentActivationCoordinator } from "./environment-activation.js";
import {
  EnvironmentLaunchStore,
  isEnvironmentLaunchRequestId,
} from "./environment-launch.js";
```

Add `readEnvironmentLaunchRequestId` to the existing `environment-instance.js` import.

Add these globals and helpers after the existing mutable Desktop state:

```ts
const ENVIRONMENT_LAUNCH_DATA_KEY = "environmentLaunchRequestId";
const ENVIRONMENT_LAUNCH_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let environmentLaunchStore: EnvironmentLaunchStore | null = null;

function readLaunchRequestAdditionalData(value: unknown): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const requestId = (value as Record<string, unknown>)[ENVIRONMENT_LAUNCH_DATA_KEY];
  return isEnvironmentLaunchRequestId(requestId) ? requestId : undefined;
}

const environmentActivation = new EnvironmentActivationCoordinator({
  focusWindow: () => {
    if (!mainWindow) return false;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    return true;
  },
  markReady: async (requestId) => {
    if (!environmentLaunchStore) return;
    await environmentLaunchStore.markReady(requestId, activeEnvironmentTarget.id, process.pid);
  },
  markFailed: async (requestId, message) => {
    if (!environmentLaunchStore) return;
    await environmentLaunchStore.markFailed(requestId, activeEnvironmentTarget.id, message);
  },
});
```

- [ ] **Step 3: Make target spawning wait for readiness**

Replace `openEnvironmentInstance` with:

```ts
async function openEnvironmentInstance(
  rootUserDataDir: string,
  target: DesktopEnvironmentTarget
): Promise<void> {
  if (!environmentLaunchStore) throw new Error("Environment launch store is not initialized");
  const request = await environmentLaunchStore.create(target);
  try {
    await new Promise<void>((resolveSpawned, rejectSpawned) => {
      const child = spawn(
        process.execPath,
        createEnvironmentInstanceArgs(rootUserDataDir, target, request.requestId),
        {
          detached: true,
          stdio: "ignore",
          windowsHide: true,
        }
      );
      child.once("error", rejectSpawned);
      child.once("spawn", () => {
        child.unref();
        resolveSpawned();
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await environmentLaunchStore.markFailed(request.requestId, target.id, message);
    throw error;
  }
  await environmentLaunchStore.waitForTerminal(request.requestId, target);
}
```

Keep `desktop:open-environment` unchanged around this function: its existing `environmentOpening`
guard and renderer promise now remain active until readiness, failure, or timeout.

- [ ] **Step 4: Initialize the store before asynchronous startup work**

At the beginning of `startApplication`, after resolving `rootUserDataDir`, add:

```ts
environmentLaunchStore = new EnvironmentLaunchStore(rootUserDataDir);
void environmentLaunchStore.cleanupStale(ENVIRONMENT_LAUNCH_MAX_AGE_MS).catch(() => undefined);
activeEnvironmentTarget = app.isPackaged
  ? readEnvironmentInstanceTarget(app.commandLine)
  : NATIVE_ENVIRONMENT;
```

Keep `registerIpcHandlers(rootUserDataDir)` after this initialization. Later in `startApplication`,
replace the existing reassignment of `activeEnvironmentTarget` with only:

```ts
environmentManager.setActiveTarget(activeEnvironmentTarget);
```

Reading the target before the first awaited Runtime-store operation ensures an early startup failure
is acknowledged against the correct environment ID instead of the default native target.

- [ ] **Step 5: Acknowledge only from a ready BrowserWindow**

Replace the existing `ready-to-show` listener in `createMainWindow` with:

```ts
if (!smokeResultPath) {
  window.once("ready-to-show", () => {
    void environmentActivation.markWindowReady().catch((error) => {
      console.error("Unable to acknowledge environment window readiness", error);
    });
  });
}
```

Extend the existing `closed` listener:

```ts
window.on("closed", () => {
  if (mainWindow === window) {
    mainWindow = null;
    environmentActivation.markWindowUnavailable();
  }
});
```

The coordinator's `focusWindow` callback owns `show()`, so do not retain a second direct
`window.show()` call in `ready-to-show`.

- [ ] **Step 6: Report target startup failures to waiting sources**

Move error serialization to the top of `handleStartupFailure` and fail queued launch requests
before either the smoke-test branch or the user dialog:

```ts
async function handleStartupFailure(error: unknown): Promise<void> {
  const details = error instanceof Error ? error.stack || error.message : String(error);
  await environmentActivation.failPending(details).catch(() => undefined);

  if (smokeResultPath) {
    await finishSmokeTest({ loaded: false, error: details }, 1);
    return;
  }

  if (activeEnvironmentTarget.kind !== "wsl" || !environmentManager) {
    dialog.showErrorBox("Unable to start Coder Studio", details);
    app.quit();
    return;
  }

  // Retain the existing WSL Retry / Open Local Windows / Quit dialog below this point.
```

Remove the later duplicate `details` declaration.

- [ ] **Step 7: Preserve requests through Electron's single-instance path**

Replace the current single-instance block with:

```ts
const initialEnvironmentLaunchRequestId = readEnvironmentLaunchRequestId(app.commandLine);
const hasSingleInstanceLock = app.requestSingleInstanceLock(
  initialEnvironmentLaunchRequestId
    ? { [ENVIRONMENT_LAUNCH_DATA_KEY]: initialEnvironmentLaunchRequestId }
    : undefined
);
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  if (initialEnvironmentLaunchRequestId) {
    void environmentActivation.request(initialEnvironmentLaunchRequestId);
  }
  app.on("second-instance", (_event, _argv, _workingDirectory, additionalData) => {
    const requestId = readLaunchRequestAdditionalData(additionalData);
    void environmentActivation.request(requestId).catch((error) => {
      console.error("Unable to activate Desktop environment window", error);
    });
  });

  app.whenReady().then(startApplication).catch(handleStartupFailure);
}
```

This retains ordinary shortcut behavior: a `second-instance` event without a request ID still
queues or performs a window focus, but does not write an acknowledgement.

- [ ] **Step 8: Run Desktop typechecking and focused tests**

Run:

```bash
pnpm --filter @coder-studio/desktop typecheck
pnpm --filter @coder-studio/desktop exec vitest run src/environment-launch.test.ts src/environment-instance.test.ts src/environment-activation.test.ts src/environment-manager.test.ts src/wsl-discovery.test.ts
```

Expected: typecheck exits 0; 5 test files pass.

- [ ] **Step 9: Commit the Electron integration**

```bash
git add packages/desktop/src/main.ts
git commit -m "fix(desktop): wait for environment window readiness"
```

## Task 5: Lock in the renderer Loading and retry behavior

**Files:**

- Modify: `packages/web/src/features/topbar/components/environment-switcher.test.tsx`

- [ ] **Step 1: Add a deferred Desktop API helper**

Add above `renderSwitcher` in `packages/web/src/features/topbar/components/environment-switcher.test.tsx`:

```ts
function deferred<T>() {
  let resolvePromise!: (value: T) => void;
  let rejectPromise!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });
  return { promise, reject: rejectPromise, resolve: resolvePromise };
}
```

- [ ] **Step 2: Add the pending/reopen/success test**

Add inside the existing `EnvironmentSwitcher` describe block:

```ts
it("keeps showing opening progress until the target window reports ready", async () => {
  const user = userEvent.setup();
  const { openEnvironment } = installDesktopApi();
  const opening = deferred<{ status: "opened" }>();
  openEnvironment.mockReturnValueOnce(opening.promise);
  renderSwitcher();

  await screen.findByText("Local: Windows");
  const trigger = screen.getByRole("button", { name: "Coder Studio environment" });
  await user.click(trigger);
  const wslButton = await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ });
  await user.click(wslButton);

  expect(wslButton).toBeDisabled();
  expect(screen.getByText("Preparing…")).toBeInTheDocument();

  await user.click(trigger);
  expect(screen.queryByText("Open another environment")).not.toBeInTheDocument();
  await user.click(trigger);
  expect(await screen.findByText("Preparing…")).toBeInTheDocument();

  opening.resolve({ status: "opened" });
  await waitFor(() =>
    expect(screen.queryByText("Open another environment")).not.toBeInTheDocument()
  );
});
```

- [ ] **Step 3: Add the timeout/retry test**

Add:

```ts
it("re-enables retry after a launch readiness timeout", async () => {
  const user = userEvent.setup();
  const { openEnvironment } = installDesktopApi();
  const opening = deferred<{ status: "opened" }>();
  openEnvironment.mockReturnValueOnce(opening.promise);
  renderSwitcher();

  await screen.findByText("Local: Windows");
  await user.click(screen.getByRole("button", { name: "Coder Studio environment" }));
  const wslButton = await screen.findByRole("button", { name: /WSL: Ubuntu-24\.04/ });
  await user.click(wslButton);

  opening.reject(new Error("Timed out waiting for WSL: Ubuntu-24.04 to open"));

  expect(await screen.findByRole("alert")).toHaveTextContent("Timed out waiting");
  expect(wslButton).toBeEnabled();
  await user.click(wslButton);
  expect(openEnvironment).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 4: Run the renderer tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/topbar/components/environment-switcher.test.tsx src/components/ui/popover/index.test.tsx
```

Expected: 2 test files passed. If the first test exposes that a manually closed popover cannot be
reopened while `openingId` is set, stop execution and return to the approved design because the
existing component contract no longer matches the inspected implementation.

- [ ] **Step 5: Commit the UI regression coverage**

```bash
git add packages/web/src/features/topbar/components/environment-switcher.test.tsx
git commit -m "test(web): cover environment opening readiness state"
```

## Task 6: Repository verification and packaged Windows acceptance

**Files:**

- Verify only; no planned source changes.

- [ ] **Step 1: Run all Desktop tests**

Run:

```bash
pnpm --filter @coder-studio/desktop test
```

Expected: all Desktop test files pass.

- [ ] **Step 2: Run repository-level verification**

Run:

```bash
pnpm ci:verify
pnpm ci:test
```

Expected: both commands exit 0. If an unrelated existing failure occurs, record its exact command,
test name, and output without modifying unrelated packages.

- [ ] **Step 3: Build the packaged Desktop application**

On Windows, run:

```bash
pnpm pack:desktop
```

Expected: the unpacked Desktop application is produced successfully.

- [ ] **Step 4: Validate cold-start readiness manually**

With Local running and WSL stopped:

1. Click the WSL environment once.
2. Confirm the source trigger and selected row show Loading continuously.
3. Confirm Loading ends only after the WSL window becomes visible.
4. Confirm the Local window remains usable throughout.

Expected: one click opens WSL and no false `opened` state appears.

- [ ] **Step 5: Validate existing-instance focus in both directions**

With both windows running:

1. From Local, select WSL and confirm WSL is focused by one click.
2. From WSL, select Local and confirm Local is focused by one click.
3. Minimize each target once and repeat, confirming it restores and focuses.

Expected: every activation succeeds on the first request.

- [ ] **Step 6: Validate startup-race queuing and retry**

1. Stop WSL, select it from Local, close and reopen the environment popover during startup.
2. Confirm the same target still shows Loading and duplicate rows remain disabled.
3. After the WSL window appears, select Local from WSL and confirm the queued activation focuses it.

Expected: startup requests are not lost and reopening the popover does not clear or duplicate the
pending launch.

- [ ] **Step 7: Review the final diff and status**

Run:

```bash
git diff --check
git status --short
git log --oneline -6
```

Expected: no whitespace errors; only intended files are changed or committed; unrelated user files
remain untouched.

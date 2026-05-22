import { describe, expect, it, vi } from "vitest";
import { type UpdateRuntimeConfig, UpdateService } from "./update-service.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function createDeps(overrides?: Partial<ConstructorParameters<typeof UpdateService>[0]>) {
  let state = {
    version: 1 as const,
    currentVersion: "0.4.0",
    latestVersion: null as string | null,
    availability: "unknown" as const,
    updateStatus: "idle" as const,
    lastCheckedAt: null as number | null,
    targetVersion: null as string | null,
    startedAt: null as number | null,
    finishedAt: null as number | null,
    requiresManualStep: false,
    manualCommand: null as string | null,
    errorSummary: null as string | null,
  };

  const runtime: UpdateRuntimeConfig = {
    supported: true,
    installKind: "global_npm",
    packageName: "@spencer-kit/coder-studio",
    currentVersion: "0.4.0",
    cliCommand: "coder-studio",
    workerEntryPath: "/tmp/update-worker.mjs",
  };

  return {
    settingsRepo: {
      get: vi.fn((key: string) => {
        if (key === "updates.autoCheckEnabled") return true;
        if (key === "updates.checkIntervalSec") return 21600;
        return undefined;
      }),
    },
    updateStateRepo: {
      getFilePath: vi.fn(() => "/tmp/update-state.json"),
      get: vi.fn(() => state),
      update: vi.fn((patch: unknown) => {
        const resolved =
          typeof patch === "function"
            ? (patch as (current: typeof state) => Partial<typeof state>)(state)
            : (patch as Partial<typeof state>);
        state = { ...state, ...resolved };
        return state;
      }),
    },
    broadcaster: {
      broadcast: vi.fn(),
    },
    runtime,
    updateWorkerLogFilePath: "/tmp/update-worker.log",
    countRunningTerminals: vi.fn(() => 0),
    countRunningSessions: vi.fn(() => 0),
    countActiveSupervisors: vi.fn(() => 0),
    runLatestVersionLookup: vi.fn(async () => "0.5.0"),
    spawnDetachedWorker: vi.fn(async () => {}),
    now: vi.fn(() => 1000),
    ...overrides,
  };
}

describe("UpdateService", () => {
  it("does not run an immediate startup check when auto checks are disabled", () => {
    const runLatestVersionLookup = vi.fn(async () => "0.5.0");
    const service = new UpdateService(
      createDeps({
        settingsRepo: {
          get: vi.fn((key: string) => {
            if (key === "updates.autoCheckEnabled") {
              return false;
            }
            return undefined;
          }),
        },
        runLatestVersionLookup,
      })
    );

    service.start();

    expect(runLatestVersionLookup).not.toHaveBeenCalled();
    service.stop();
  });

  it("maps a newer published version to update_available", async () => {
    const deps = createDeps();
    const service = new UpdateService(deps);

    const result = await service.checkForUpdates({ manual: true });

    expect(result.latestVersion).toBe("0.5.0");
    expect(result.availability).toBe("update_available");
    expect(result.updateStatus).toBe("idle");
  });

  it("keeps check failures in availability while returning to idle", async () => {
    const deps = createDeps({
      runLatestVersionLookup: vi.fn(async () => {
        throw new Error("registry down");
      }),
    });
    const service = new UpdateService(deps);

    const result = await service.checkForUpdates({ manual: true });

    expect(result.availability).toBe("check_failed");
    expect(result.updateStatus).toBe("idle");
    expect(result.errorSummary).toBe("registry down");
  });

  it("treats older published versions as up_to_date", async () => {
    const deps = createDeps({
      runLatestVersionLookup: vi.fn(async () => "0.3.9"),
    });
    const service = new UpdateService(deps);

    const result = await service.checkForUpdates({ manual: true });

    expect(result.availability).toBe("up_to_date");
    expect(result.updateStatus).toBe("idle");
  });

  it("rejects overlapping automatic checks while one is already in progress", async () => {
    const lookupDeferred = createDeferred<string>();
    let callCount = 0;
    const runLatestVersionLookup = vi.fn(() => {
      callCount += 1;
      if (callCount === 1) {
        return lookupDeferred.promise;
      }
      return Promise.resolve("0.5.0");
    });
    const service = new UpdateService(
      createDeps({
        runLatestVersionLookup,
      })
    );

    const firstCheck = service.checkForUpdates({ manual: false });

    expect(runLatestVersionLookup).toHaveBeenCalledTimes(1);
    await expect(service.checkForUpdates({ manual: false })).rejects.toMatchObject({
      code: "update_busy",
    });
    expect(runLatestVersionLookup).toHaveBeenCalledTimes(1);

    lookupDeferred.resolve("0.5.0");
    await firstCheck;
  });

  it("returns an activity summary for prepareInstall", () => {
    const deps = createDeps({
      countRunningTerminals: vi.fn(() => 2),
      countRunningSessions: vi.fn(() => 1),
      countActiveSupervisors: vi.fn(() => 3),
    });
    const service = new UpdateService(deps);

    const result = service.prepareInstall();

    expect(result.activity).toEqual({
      runningTerminalCount: 2,
      runningSessionCount: 1,
      runningSupervisorCount: 3,
      hasActiveWork: true,
    });
  });

  it("rejects update start when active work exists without force", async () => {
    const deps = createDeps({
      countRunningSessions: vi.fn(() => 1),
      updateStateRepo: {
        get: vi.fn(() => ({
          version: 1,
          currentVersion: "0.4.0",
          latestVersion: "0.5.0",
          availability: "update_available",
          updateStatus: "idle",
          lastCheckedAt: 5,
          targetVersion: null,
          startedAt: null,
          finishedAt: null,
          requiresManualStep: false,
          manualCommand: null,
          errorSummary: null,
        })),
        update: vi.fn(),
      },
    });
    const service = new UpdateService(deps);

    await expect(
      service.startInstall({ targetVersion: "0.5.0", force: false })
    ).rejects.toMatchObject({
      code: "update_active_work_confirmation_required",
    });
  });

  it("reconciles a completed target version to succeeded on startup", () => {
    const runtime: UpdateRuntimeConfig = {
      supported: true,
      installKind: "global_npm",
      packageName: "@spencer-kit/coder-studio",
      currentVersion: "0.5.0",
      cliCommand: "coder-studio",
      workerEntryPath: "/tmp/update-worker.mjs",
    };
    const deps = createDeps({
      runtime,
      updateStateRepo: {
        get: vi.fn(() => ({
          version: 1,
          currentVersion: "0.4.0",
          latestVersion: "0.5.0",
          availability: "update_available",
          updateStatus: "restarting",
          lastCheckedAt: 5,
          targetVersion: "0.5.0",
          startedAt: 1,
          finishedAt: null,
          requiresManualStep: false,
          manualCommand: null,
          errorSummary: null,
        })),
        update: vi.fn((patch: unknown) => ({
          version: 1,
          currentVersion: "0.5.0",
          latestVersion: "0.5.0",
          availability: "up_to_date",
          updateStatus: "succeeded",
          lastCheckedAt: 5,
          targetVersion: "0.5.0",
          startedAt: 1,
          finishedAt: 1000,
          requiresManualStep: false,
          manualCommand: null,
          errorSummary: null,
          ...(typeof patch === "function" ? patch({}) : patch),
        })),
      },
    });
    const service = new UpdateService(deps);

    const result = service.reconcileOnStartup();

    expect(result.updateStatus).toBe("succeeded");
    expect(result.availability).toBe("up_to_date");
    expect(result.errorSummary).toBeNull();
  });

  it("passes the update state file path into the detached worker contract", async () => {
    const spawnDetachedWorker = vi.fn(async () => {});
    const deps = createDeps({
      spawnDetachedWorker,
      updateStateRepo: {
        getFilePath: vi.fn(() => "/tmp/update-state.json"),
        get: vi.fn(() => ({
          version: 1,
          currentVersion: "0.4.0",
          latestVersion: "0.5.0",
          availability: "update_available",
          updateStatus: "idle",
          lastCheckedAt: 5,
          targetVersion: null,
          startedAt: null,
          finishedAt: null,
          requiresManualStep: false,
          manualCommand: null,
          errorSummary: null,
        })),
        update: vi.fn((patch: unknown) => ({
          version: 1,
          currentVersion: "0.4.0",
          latestVersion: "0.5.0",
          availability: "update_available",
          updateStatus: "installing",
          lastCheckedAt: 5,
          targetVersion: "0.5.0",
          startedAt: 1000,
          finishedAt: null,
          requiresManualStep: false,
          manualCommand: null,
          errorSummary: null,
          ...(typeof patch === "function" ? patch({}) : patch),
        })),
      },
    });
    const service = new UpdateService(deps);

    await service.startInstall({ targetVersion: "0.5.0", force: true });

    expect(spawnDetachedWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        stateFilePath: "/tmp/update-state.json",
      })
    );
  });
});

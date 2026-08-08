import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProductUpdateState } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import type { DesktopChannel } from "./desktop-channel.js";
import { DesktopUpdateCoordinator } from "./desktop-update-coordinator.js";
import { DesktopUpdateJournal } from "./desktop-update-journal.js";
import type { RuntimeUpdateMetadata } from "./runtime-update-manager.js";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

const channel: DesktopChannel = {
  schemaVersion: 1,
  channel: "stable",
  releaseTag: "v0.6.0",
  generatedAt: "2026-08-08T01:02:03.000Z",
  shell: {
    version: "0.3.0",
    publishedAt: "2026-08-08T01:02:03.000Z",
    updaterMetadata: "latest.yml",
    engineVersion: "2",
    nodeVersion: "24.19.0",
    runtimeHostApiVersion: 1,
    apiProtocolVersion: 1,
    dataSchemaVersion: 1,
  },
  runtimes: {
    "win32-x64": {
      version: "0.6.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      manifest: "runtime-win32-x64.manifest.json",
    },
    "linux-x64": {
      version: "0.6.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      manifest: "runtime-linux-x64.manifest.json",
    },
  },
  signature: { algorithm: "ed25519", value: "signed" },
};

function runtimeMetadata(): RuntimeUpdateMetadata {
  return {
    componentId: "runtime:win32-x64",
    manifestUrl: "https://releases.example/runtime-win32-x64.manifest.json",
    manifest: {
      schemaVersion: 2,
      publishedAt: "2026-08-08T01:02:03.000Z",
      runtimeVersion: "0.6.0",
      minShellVersion: "0.2.0",
      requiredEngineVersion: "2",
      requiredNodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      platform: "win32",
      arch: "x64",
      entrypoint: "server.mjs",
      packageFile: "runtime.tgz",
      files: [{ path: "server.mjs", sha256: "a".repeat(64), size: 1 }],
      signature: { algorithm: "ed25519", value: "signed" },
    },
    version: "0.6.0",
    publishedAt: "2026-08-08T01:02:03.000Z",
    plannedShellVersion: "0.3.0",
  };
}

function createHarness(
  options: {
    shellVersion?: string;
    runtimeVersion?: string;
    shellDownload?: Promise<void>;
    runtimeDownload?: Promise<unknown>;
    journalOverride?: unknown;
    planId?: string;
  } = {}
) {
  const shellVersion = options.shellVersion ?? "0.2.0";
  const runtimeVersion = options.runtimeVersion ?? "0.5.0";
  const shell = {
    checkMetadata: vi.fn(async () => ({
      componentId: "shell" as const,
      version: "0.3.0",
      publishedAt: "2026-08-08T01:02:03.000Z",
      updateNeeded: shellVersion !== "0.3.0",
    })),
    download: vi.fn(async () => options.shellDownload),
    cancelDownload: vi.fn(() => true),
    armInstallOnQuit: vi.fn(),
    disarmInstallOnQuit: vi.fn(),
    getDiagnostics: vi.fn((): { logLocations: string[]; recoveryAction: string | null } => ({
      logLocations: [],
      recoveryAction: null,
    })),
    quitAndInstall: vi.fn(),
  };
  const runtime = {
    checkMetadata: vi.fn(async () => runtimeMetadata()),
    downloadAndStage: vi.fn(async () => options.runtimeDownload),
    getCurrentVersion: vi.fn(async () => runtimeVersion),
    getPendingVersion: vi.fn(async () => null),
  };
  const journalRecord = { value: null as unknown };
  const journal = {
    read: vi.fn(async () => journalRecord.value),
    write: vi.fn(async (value) => {
      journalRecord.value = value;
    }),
    clear: vi.fn(async () => {
      journalRecord.value = null;
    }),
  };
  const settings = {
    get: vi.fn(async () => ({
      schemaVersion: 1 as const,
      autoCheckEnabled: true,
      checkIntervalSec: 21600 as const,
    })),
    set: vi.fn(async (patch) => ({
      schemaVersion: 1 as const,
      autoCheckEnabled: patch.autoCheckEnabled ?? true,
      checkIntervalSec: patch.checkIntervalSec ?? (21600 as const),
    })),
  };
  const states: ProductUpdateState[] = [];
  const coordinator = new DesktopUpdateCoordinator({
    runtimeContext: {
      environment: "desktop-native",
      authority: "desktop",
      supported: true,
      unsupportedReason: null,
    },
    currentProductVersion: () => runtimeVersion,
    currentProductPublishedAt: () => "2026-07-01T00:00:00.000Z",
    getBuildInfo: () => ({
      schemaVersion: 1,
      shellVersion,
      builtAt: "2026-07-01T00:00:00.000Z",
      publishedAt: "2026-07-01T00:00:00.000Z",
      engineVersion: "2",
      nodeVersion: "24.19.0",
      runtimeHostApiVersion: 1,
      apiProtocolVersion: 1,
      dataSchemaVersion: 1,
      metadataAvailable: true,
    }),
    loadChannel: async () => channel,
    shell: shell as never,
    getRuntimeAdapter: async () => runtime as never,
    initialRuntimeTarget: "win32-x64",
    initialEnvironmentId: "native",
    settings: settings as never,
    journal: (options.journalOverride ?? journal) as never,
    journalLocation: "C:\\Coder Studio\\desktop-update-plan.json",
    now: () => Date.parse("2026-08-08T02:00:00.000Z"),
    randomId: () => options.planId ?? "plan-1",
    onStateChanged: (state) => states.push(state),
    relaunch: vi.fn(),
    quit: vi.fn(),
  });
  return { coordinator, shell, runtime, journal, settings, states };
}

describe("DesktopUpdateCoordinator", () => {
  it("includes the durable update journal in diagnostics", () => {
    const { coordinator } = createHarness();

    expect(coordinator.getState().diagnostics.logLocations).toContain(
      "C:\\Coder Studio\\desktop-update-plan.json"
    );
  });

  it.each([
    ["no update", "0.3.0", "0.6.0", [], "idle"],
    ["Shell only", "0.2.0", "0.6.0", ["shell"], "available"],
    ["Runtime only", "0.3.0", "0.5.0", ["runtime:win32-x64"], "available"],
    ["combined", "0.2.0", "0.5.0", ["shell", "runtime:win32-x64"], "available"],
  ])("creates a %s plan", async (_name, shellVersion, runtimeVersion, ids, status) => {
    const { coordinator } = createHarness({ shellVersion, runtimeVersion });
    const state = await coordinator.check({ manual: true });
    expect(state.status).toBe(status);
    expect(state.components.map((component) => component.id)).toEqual(ids);
    expect(state.components.every((component) => component.targetPublishedAt !== null)).toBe(true);
  });

  it("starts Shell and Runtime downloads concurrently and journals one ready plan", async () => {
    const shellDownload = deferred<void>();
    const runtimeDownload = deferred<unknown>();
    const { coordinator, shell, runtime, journal } = createHarness({
      shellDownload: shellDownload.promise,
      runtimeDownload: runtimeDownload.promise,
    });
    await coordinator.check({ manual: true });
    const downloading = coordinator.download();
    await vi.waitFor(() => {
      expect(shell.download).toHaveBeenCalledTimes(1);
      expect(runtime.downloadAndStage).toHaveBeenCalledTimes(1);
    });
    shellDownload.resolve();
    runtimeDownload.resolve(undefined);

    await expect(downloading).resolves.toMatchObject({ status: "ready", restartRequired: true });
    expect(journal.write).toHaveBeenCalled();
    expect(
      (journal.write.mock.calls.at(-1)?.[0] as { components: { verified: boolean }[] }).components
    ).toEqual(expect.arrayContaining([expect.objectContaining({ verified: true })]));
  });

  it("journals the downloading transition before pending component downloads finish", async () => {
    const shellDownload = deferred<void>();
    const runtimeDownload = deferred<unknown>();
    const { coordinator, journal } = createHarness({
      shellDownload: shellDownload.promise,
      runtimeDownload: runtimeDownload.promise,
    });
    await coordinator.check({ manual: true });

    const downloading = coordinator.download();

    await vi.waitFor(() => {
      expect(journal.write).toHaveBeenCalledWith(
        expect.objectContaining({ status: "downloading" }),
        expect.any(Object)
      );
    });
    shellDownload.resolve();
    runtimeDownload.resolve(undefined);
    await downloading;
  });

  it("restores the available plan when the downloading transition cannot be journaled", async () => {
    const { coordinator, shell, runtime, journal } = createHarness();
    await coordinator.check({ manual: true });
    journal.write.mockRejectedValueOnce(new Error("journal unavailable"));

    await expect(coordinator.download()).rejects.toThrow("journal unavailable");

    expect(shell.download).not.toHaveBeenCalled();
    expect(runtime.downloadAndStage).not.toHaveBeenCalled();
    expect(coordinator.getState()).toMatchObject({ status: "available" });
    await expect(coordinator.check({ manual: true })).resolves.toBeDefined();
  });

  it("journals a verified component while another component is still downloading", async () => {
    const shellDownload = deferred<void>();
    const runtimeDownload = deferred<unknown>();
    const { coordinator, journal } = createHarness({
      shellDownload: shellDownload.promise,
      runtimeDownload: runtimeDownload.promise,
    });
    await coordinator.check({ manual: true });
    const downloading = coordinator.download();
    await vi.waitFor(() => {
      expect(journal.write).toHaveBeenCalledWith(
        expect.objectContaining({ status: "downloading" }),
        expect.any(Object)
      );
    });

    shellDownload.resolve();

    await vi.waitFor(() => {
      expect(
        journal.write.mock.calls.some(([record]) => {
          const components = (record as { components: Array<{ id: string; verified: boolean }> })
            .components;
          return (
            components.find((component) => component.id === "shell")?.verified === true &&
            components.find((component) => component.id === "runtime:win32-x64")?.verified === false
          );
        })
      ).toBe(true);
    });
    runtimeDownload.resolve(undefined);
    await downloading;
  });

  it("serializes component journal writes so an older snapshot cannot finish last", async () => {
    const shellDownload = deferred<void>();
    const runtimeDownload = deferred<unknown>();
    const delayedWrite = deferred<void>();
    const { coordinator, journal } = createHarness({
      shellDownload: shellDownload.promise,
      runtimeDownload: runtimeDownload.promise,
    });
    await coordinator.check({ manual: true });
    const downloading = coordinator.download();
    await vi.waitFor(() => {
      expect(journal.write).toHaveBeenCalledWith(
        expect.objectContaining({ status: "downloading" }),
        expect.any(Object)
      );
    });
    const completedWrites = journal.write.mock.calls.length;
    journal.write.mockImplementationOnce(async () => delayedWrite.promise);

    shellDownload.resolve();
    await vi.waitFor(() => {
      expect(journal.write).toHaveBeenCalledTimes(completedWrites + 1);
    });
    runtimeDownload.resolve(undefined);
    await vi.waitFor(() => {
      expect(
        coordinator.getState().components.find((component) => component.id === "runtime:win32-x64")
          ?.verified
      ).toBe(true);
    });

    expect(journal.write).toHaveBeenCalledTimes(completedWrites + 1);
    delayedWrite.resolve();
    await downloading;
    expect(journal.write.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "ready",
      components: [
        expect.objectContaining({ id: "shell", verified: true }),
        expect.objectContaining({ id: "runtime:win32-x64", verified: true }),
      ],
    });
  });

  it("prevents two coordinators from replacing one shared update plan", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-coordinator-"));
    try {
      const filePath = join(root, "desktop-update-plan.json");
      const firstJournal = new DesktopUpdateJournal({ filePath });
      const secondJournal = new DesktopUpdateJournal({ filePath });
      const first = createHarness({
        shellVersion: "0.3.0",
        planId: "plan-first",
        journalOverride: firstJournal,
      });
      const second = createHarness({
        shellVersion: "0.3.0",
        planId: "plan-second",
        journalOverride: secondJournal,
      });

      const results = await Promise.allSettled([
        first.coordinator.check({ manual: true }),
        second.coordinator.check({ manual: true }),
      ]);

      expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
      const persisted = await firstJournal.read();
      expect(persisted).toMatchObject({
        planId: expect.stringMatching(/^plan-(first|second)$/),
        environmentId: "native",
      });
      await firstJournal.clear({
        expectedPlanId: persisted?.planId ?? null,
        environmentId: "native",
      });
      const rejectedIndex = results.findIndex((result) => result.status === "rejected");
      const rejectedCoordinator = [first.coordinator, second.coordinator][rejectedIndex];
      await expect(rejectedCoordinator?.retryFailed()).resolves.toMatchObject({
        status: "ready",
        restartRequired: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("retains a verified component and explicitly retries only the failed component", async () => {
    const { coordinator, shell, runtime } = createHarness();
    runtime.downloadAndStage.mockRejectedValueOnce(new Error("hash mismatch"));
    await coordinator.check({ manual: true });
    await expect(coordinator.download()).resolves.toMatchObject({ status: "failed" });
    expect(shell.download).toHaveBeenCalledTimes(1);
    expect(runtime.downloadAndStage).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ version: "0.6.0" }),
      expect.objectContaining({ explicitRetry: false })
    );

    runtime.downloadAndStage.mockResolvedValueOnce(undefined);
    await expect(coordinator.retryFailed()).resolves.toMatchObject({ status: "ready" });
    expect(shell.download).toHaveBeenCalledTimes(1);
    expect(runtime.downloadAndStage).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ version: "0.6.0" }),
      expect.objectContaining({ explicitRetry: true })
    );
  });

  it("blocks an incompatible Runtime and never starts a download", async () => {
    const { coordinator, runtime } = createHarness();
    const incompatible = runtimeMetadata();
    incompatible.manifest.requiredNodeVersion = "99.0.0";
    runtime.checkMetadata.mockResolvedValueOnce(incompatible);

    await expect(coordinator.check({ manual: true })).resolves.toMatchObject({
      status: "failed",
      compatibility: { compatible: false, code: "runtime_host_incompatible" },
    });
    await expect(coordinator.download()).rejects.toMatchObject({
      code: "update_incompatible",
    });
    expect(runtime.downloadAndStage).not.toHaveBeenCalled();
  });

  it("prepares a stale target environment even when the active environment is current", async () => {
    const { coordinator, runtime } = createHarness({ runtimeVersion: "0.6.0" });
    runtime.getCurrentVersion.mockResolvedValueOnce("0.5.0");
    const linuxMetadata = runtimeMetadata();
    linuxMetadata.componentId = "runtime:linux-x64";
    linuxMetadata.manifest.platform = "linux";
    runtime.checkMetadata.mockResolvedValueOnce(linuxMetadata);

    await coordinator.prepareEnvironmentTarget("linux-x64", "wsl:ubuntu");

    expect(runtime.getCurrentVersion).toHaveBeenCalledTimes(1);
    expect(runtime.downloadAndStage).toHaveBeenCalledWith(
      expect.objectContaining({ componentId: "runtime:linux-x64", version: "0.6.0" }),
      expect.any(Object)
    );
  });

  it("creates one durable restart intent and hands Shell installation off once", async () => {
    const { coordinator, shell, journal } = createHarness();
    await coordinator.check({ manual: true });
    await coordinator.download();

    await expect(coordinator.prepareRestart()).resolves.toMatchObject({
      status: "restarting",
    });
    expect(shell.armInstallOnQuit).toHaveBeenCalledTimes(1);
    expect(journal.write.mock.calls.at(-1)?.[0]).toMatchObject({ restartIntent: true });
    await expect(coordinator.restartAndInstall()).resolves.toBe(true);
    expect(shell.quitAndInstall).toHaveBeenCalledTimes(1);
    await expect(coordinator.restartAndInstall()).resolves.toBe(false);
  });

  it("does not arm Shell installation when restart intent persistence fails", async () => {
    const { coordinator, shell, journal } = createHarness();
    await coordinator.check({ manual: true });
    await coordinator.download();
    journal.write.mockRejectedValueOnce(new Error("journal unavailable"));

    await expect(coordinator.prepareRestart()).rejects.toThrow("journal unavailable");

    expect(shell.armInstallOnQuit).not.toHaveBeenCalled();
    expect(shell.disarmInstallOnQuit).toHaveBeenCalledTimes(1);
    expect(coordinator.getState()).toMatchObject({ status: "ready", restartRequired: true });
    await expect(coordinator.restartAndInstall()).resolves.toBe(false);
  });

  it("reconciles actual installed component versions as the source of truth", async () => {
    const { coordinator } = createHarness();
    await coordinator.check({ manual: true });
    await coordinator.download();
    await coordinator.prepareRestart();

    await expect(
      coordinator.reconcileOnStartup({
        shellVersion: "0.3.0",
        runtimeVersion: "0.6.0",
        pendingRuntimeVersion: null,
      })
    ).resolves.toMatchObject({
      status: "succeeded",
      productVersion: "0.6.0",
      productPublishedAt: "2026-08-08T01:02:03.000Z",
    });
  });

  it("recovers a fully verified interrupted download journal as ready", async () => {
    const { coordinator, journal } = createHarness();
    await coordinator.check({ manual: true });
    await coordinator.download();
    const readyRecord = journal.write.mock.calls.at(-1)?.[0] as Record<string, unknown>;
    journal.read.mockResolvedValueOnce({
      ...readyRecord,
      status: "downloading",
      restartIntent: false,
    });

    await expect(
      coordinator.reconcileOnStartup({
        shellVersion: "0.2.0",
        runtimeVersion: "0.5.0",
        pendingRuntimeVersion: "0.6.0",
      })
    ).resolves.toMatchObject({
      status: "ready",
      restartRequired: true,
      errorSummary: null,
    });
    expect(journal.write.mock.calls.at(-1)?.[0]).toMatchObject({ status: "ready" });
  });

  it("persists a partially downloaded startup journal as a retryable failure", async () => {
    const { coordinator, journal } = createHarness();
    await coordinator.check({ manual: true });
    const availableRecord = journal.write.mock.calls.at(-1)?.[0] as {
      components: Array<{ id: string }>;
    } & Record<string, unknown>;
    journal.read.mockResolvedValueOnce({
      ...availableRecord,
      status: "downloading",
      restartIntent: false,
      components: availableRecord.components.map((component) => ({
        ...component,
        downloaded: component.id === "shell",
        verified: component.id === "shell",
      })),
    });

    await expect(
      coordinator.reconcileOnStartup({
        shellVersion: "0.2.0",
        runtimeVersion: "0.5.0",
        pendingRuntimeVersion: null,
      })
    ).resolves.toMatchObject({
      status: "failed",
      restartRequired: false,
      diagnostics: {
        failedComponentId: "runtime:win32-x64",
        failedPhase: "downloading",
      },
    });
    expect(journal.write.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "failed",
      restartIntent: false,
      components: [
        expect.objectContaining({ id: "shell", verified: true }),
        expect.objectContaining({
          id: "runtime:win32-x64",
          verified: false,
          errorSummary: "The previous Desktop update did not complete",
        }),
      ],
    });
  });

  it("rejects a verified Runtime plan when the pending artifact is missing", async () => {
    const { coordinator, journal } = createHarness({ shellVersion: "0.3.0" });
    await coordinator.check({ manual: true });
    await coordinator.download();

    await expect(
      coordinator.reconcileOnStartup({
        shellVersion: "0.3.0",
        runtimeVersion: "0.5.0",
        pendingRuntimeVersion: null,
      })
    ).resolves.toMatchObject({
      status: "failed",
      restartRequired: false,
      errorSummary: "The staged Desktop Runtime is no longer available",
      components: [
        expect.objectContaining({
          id: "runtime:win32-x64",
          status: "failed",
          downloaded: false,
          verified: false,
        }),
      ],
      diagnostics: {
        failedComponentId: "runtime:win32-x64",
        failedPhase: "verifying",
        recoveryAction: "Check for updates again to download the Runtime update.",
      },
    });
    expect(journal.write.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "failed",
      restartIntent: false,
      components: [
        expect.objectContaining({
          id: "runtime:win32-x64",
          downloaded: false,
          verified: false,
        }),
      ],
    });
  });

  it("rechecks metadata before retrying a recovered Runtime whose artifact is missing", async () => {
    const first = createHarness({ shellVersion: "0.3.0" });
    await first.coordinator.check({ manual: true });
    await first.coordinator.download();
    const restarted = createHarness({
      shellVersion: "0.3.0",
      journalOverride: first.journal,
    });
    await restarted.coordinator.reconcileOnStartup({
      shellVersion: "0.3.0",
      runtimeVersion: "0.5.0",
      pendingRuntimeVersion: null,
    });

    await expect(restarted.coordinator.retryFailed()).resolves.toMatchObject({
      status: "ready",
      restartRequired: true,
    });
    expect(restarted.runtime.checkMetadata).toHaveBeenCalledTimes(1);
    expect(restarted.runtime.downloadAndStage).toHaveBeenCalledTimes(1);
  });

  it("reports Shell installer recovery details for a Shell-only restart failure", async () => {
    const { coordinator, shell } = createHarness({ runtimeVersion: "0.6.0" });
    shell.getDiagnostics.mockReturnValue({
      logLocations: ["updater.log"],
      recoveryAction: "https://releases.example/manual-installer",
    });
    await coordinator.check({ manual: true });
    await coordinator.download();
    await coordinator.prepareRestart();

    await expect(
      coordinator.reconcileOnStartup({
        shellVersion: "0.2.0",
        runtimeVersion: "0.6.0",
        pendingRuntimeVersion: null,
      })
    ).resolves.toMatchObject({
      status: "failed",
      diagnostics: {
        failedComponentId: "shell",
        failedPhase: "installing",
        recoveryAction: "https://releases.example/manual-installer",
      },
    });
    expect(shell.disarmInstallOnQuit).toHaveBeenCalledTimes(1);

    await coordinator.start();
    expect(coordinator.getState()).toMatchObject({
      status: "failed",
      errorSummary: "Desktop Shell installation did not reach the planned version",
      diagnostics: {
        failedComponentId: "shell",
        failedPhase: "installing",
        recoveryAction: "https://releases.example/manual-installer",
      },
    });
    coordinator.stop();
  });

  it("persists a failed Runtime activation before startup scheduling rereads the journal", async () => {
    const { coordinator, shell, journal } = createHarness();
    await coordinator.check({ manual: true });
    await coordinator.download();
    await coordinator.prepareRestart();

    await expect(
      coordinator.reconcileOnStartup({
        shellVersion: "0.3.0",
        runtimeVersion: "0.5.0",
        pendingRuntimeVersion: null,
      })
    ).resolves.toMatchObject({
      status: "failed",
      diagnostics: {
        failedComponentId: "runtime:win32-x64",
        failedPhase: "activating",
      },
    });
    expect(journal.write.mock.calls.at(-1)?.[0]).toMatchObject({
      status: "failed",
      restartIntent: false,
      components: [
        expect.objectContaining({ id: "shell", installed: true }),
        expect.objectContaining({
          id: "runtime:win32-x64",
          downloaded: false,
          verified: false,
          installed: false,
        }),
      ],
    });
    expect(shell.disarmInstallOnQuit).toHaveBeenCalledTimes(1);

    await coordinator.start();
    expect(coordinator.getState()).toMatchObject({
      status: "failed",
      diagnostics: {
        failedComponentId: "runtime:win32-x64",
        failedPhase: "activating",
      },
    });
    expect(shell.armInstallOnQuit).toHaveBeenCalledTimes(1);
    coordinator.stop();
  });
});

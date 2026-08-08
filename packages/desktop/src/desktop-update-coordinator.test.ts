import type { ProductUpdateState } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import type { DesktopChannel } from "./desktop-channel.js";
import { DesktopUpdateCoordinator } from "./desktop-update-coordinator.js";
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
    getDiagnostics: vi.fn(() => ({ logLocations: [], recoveryAction: null })),
    quitAndInstall: vi.fn(),
  };
  const runtime = {
    checkMetadata: vi.fn(async () => runtimeMetadata()),
    downloadAndStage: vi.fn(async () => options.runtimeDownload),
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
    journal: journal as never,
    now: () => Date.parse("2026-08-08T02:00:00.000Z"),
    randomId: () => "plan-1",
    onStateChanged: (state) => states.push(state),
    relaunch: vi.fn(),
    quit: vi.fn(),
  });
  return { coordinator, shell, runtime, journal, settings, states };
}

describe("DesktopUpdateCoordinator", () => {
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
});

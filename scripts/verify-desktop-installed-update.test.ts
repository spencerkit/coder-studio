import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type InstalledDesktopScenario,
  toSidecarWebSocketUrl,
  type VerifyInstalledDesktopDeps,
  verifyInstalledDesktopScenario,
} from "./verify-desktop-installed-update.js";

const combinedScenario: InstalledDesktopScenario = {
  name: "combined",
  expectedComponentIds: ["shell", "runtime:win32-x64"],
  previousShellVersion: "0.2.0",
  previousRuntimeVersion: "0.5.0",
  targetShellVersion: "0.3.0",
  targetRuntimeVersion: "0.6.0",
};

function state(status: "available" | "ready" | "succeeded") {
  return {
    status,
    components: [
      {
        id: "shell",
        kind: "shell",
        currentVersion: status === "succeeded" ? "0.3.0" : "0.2.0",
        targetVersion: "0.3.0",
      },
      {
        id: "runtime:win32-x64",
        kind: "runtime",
        currentVersion: status === "succeeded" ? "0.6.0" : "0.5.0",
        targetVersion: "0.6.0",
      },
    ],
  };
}

function createDeps(
  overrides: Partial<VerifyInstalledDesktopDeps> = {}
): VerifyInstalledDesktopDeps {
  return {
    invoke: vi.fn(async (method) => {
      if (method === "checkForUpdates") return state("available");
      if (method === "downloadUpdate") return state("ready");
      if (method === "prepareUpdateRestart") return state("ready");
      if (method === "restartAndInstallUpdate") return true;
      if (method === "getUpdateState") return state("succeeded");
      throw new Error(`Unexpected method: ${method}`);
    }),
    waitForState: vi.fn(async () => state("ready")),
    prepareActivity: vi.fn(async () => ({ hasActiveWork: true })),
    interruptAtPhase: vi.fn(async () => undefined),
    verifyExternalSidecar: vi.fn(async () => ({
      preloadAvailable: false,
      updateOperations: [],
    })),
    reconnectAfterRestart: vi.fn(async () => undefined),
    readEvidence: vi.fn(async () => ({
      actualShellVersion: "0.3.0",
      actualRuntimeVersion: "0.6.0",
      wslRuntimeVersion: null,
      wslNpmMarkerExists: false,
      journalRecovered: true,
    })),
    ...overrides,
  };
}

describe("verify-desktop-installed-update", () => {
  it("preserves installed logs beside the report before deleting acceptance-owned paths", async () => {
    const runner = await readFile(
      resolve(import.meta.dirname, "verify-desktop-installed-update.ps1"),
      "utf8"
    );
    const desktopMain = await readFile(
      resolve(import.meta.dirname, "../packages/desktop/src/main.ts"),
      "utf8"
    );

    expect(runner).toContain("function Preserve-AcceptanceEvidence");
    expect(runner).toContain("[string]$ExpectedComponents = ''");
    expect(runner).toContain("if ($ExpectedComponents)");
    expect(runner).toContain("$initialScenario");
    expect(runner).toContain("'runtime:win32-x64'");
    expect(runner).toContain("CODER_STUDIO_FACTORY_RELEASE_BASE_URL");
    expect(runner).toContain("[string]$ProductChannelUrl = ''");
    expect(runner).toContain("CODER_STUDIO_PRODUCT_CHANNEL_URL");
    expect(runner).toContain("Join-Path $factoryRuntime 'manifest.json'");
    expect(runner).not.toContain("Join-Path $factoryRuntime 'runtime.manifest.json'");
    expect(runner).toContain("$driverProcess.Handle | Out-Null");
    expect(runner.indexOf("$driverProcess.Handle | Out-Null")).toBeLessThan(
      runner.indexOf("while (-not $driverProcess.HasExited)")
    );
    expect(runner).toContain("$driverProcess.WaitForExit()");
    expect(runner.indexOf("$driverProcess.WaitForExit()")).toBeLessThan(
      runner.indexOf("if ($driverProcess.ExitCode -ne 0)")
    );
    expect(runner).toContain("$_.Name -in @('main.log', 'backend.log')");
    expect(runner).toContain("'acceptance.failure.log'");
    expect(runner).toContain("$failureDetails | Set-Content");
    expect(runner).toContain("'desktop.stdout.log'");
    expect(runner).toContain("'desktop.stderr.log'");
    expect(runner).toContain("-RedirectStandardOutput $StandardOut");
    expect(runner).toContain("$startupTimeoutSeconds = if ($isWslScenario) { 300 } else { 90 }");
    expect(runner).toContain("Wait-Cdp $cdpPort $startupTimeoutSeconds");
    expect(desktopMain).toContain('console.error("Unable to start Coder Studio", details)');
    expect(desktopMain).toContain("[desktop-acceptance:environment]");
    expect(desktopMain).toContain(
      'probeUserShell: process.env.CODER_STUDIO_DESKTOP_ACCEPTANCE !== "1"'
    );
    expect(runner).toContain("$Scenario -eq 'wsl-combined'");
    expect(runner).toContain("'legacy-wsl-current'");
    expect(runner).toContain("[switch]$SkipAuthenticode");
    expect(runner).toContain("if (-not $SkipAuthenticode)");
    expect(runner).toContain("[switch]$PinLegacyShellUpdaterToChannel");
    expect(runner).toContain("function Set-LegacyShellUpdaterFeed");
    expect(runner).toContain("provider: generic");
    expect(runner).toContain("channel: latest");
    expect(runner).toContain("Set-LegacyShellUpdaterFeed $installDirectory $ChannelUrl");
    expect(runner).toContain("$report.logPaths = @($preservedPaths)");
    expect(runner.indexOf("Preserve-AcceptanceEvidence")).toBeLessThan(
      runner.lastIndexOf("Remove-Item -LiteralPath $runRoot -Recurse")
    );
  });

  it("normalizes sidecar websocket urls for browser-issued commands", () => {
    expect(toSidecarWebSocketUrl("http://127.0.0.1:4173")).toBe("ws://127.0.0.1:4173/ws");
    expect(toSidecarWebSocketUrl("https://example.com/app/")).toBe("wss://example.com/app/ws");
    expect(() => toSidecarWebSocketUrl("file:///tmp/coder-studio")).toThrow("Unsupported");
  });

  it("drives one confirmation and validates actual component versions", async () => {
    const deps = createDeps();

    const report = await verifyInstalledDesktopScenario(combinedScenario, deps);

    expect(deps.invoke).toHaveBeenCalledWith("checkForUpdates");
    expect(deps.invoke).toHaveBeenCalledWith("downloadUpdate");
    expect(deps.invoke).toHaveBeenCalledWith("prepareUpdateRestart");
    expect(deps.invoke).toHaveBeenCalledWith("restartAndInstallUpdate");
    expect(report).toMatchObject({
      scenario: "combined",
      confirmationCount: 1,
      restartCount: 1,
      actualShellVersion: "0.3.0",
      actualRuntimeVersion: "0.6.0",
    });
  });

  it("validates a fresh native install without invoking update operations", async () => {
    const deps = createDeps();
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "fresh-native",
      expectedComponentIds: [],
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(deps.readEvidence).toHaveBeenCalledOnce();
    expect(deps.invoke).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      scenario: "fresh-native",
      confirmationCount: 0,
      restartCount: 0,
      actualShellVersion: "0.3.0",
      actualRuntimeVersion: "0.6.0",
    });
  });

  it("requires the candidate Runtime to bootstrap in a fresh WSL install", async () => {
    const deps = createDeps({
      readEvidence: vi.fn(async () => ({
        actualShellVersion: "0.3.0",
        actualRuntimeVersion: "0.6.0",
        wslRuntimeVersion: "0.6.0",
        wslNpmMarkerExists: false,
        journalRecovered: false,
      })),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "fresh-wsl",
      expectedComponentIds: [],
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(report).toMatchObject({
      scenario: "fresh-wsl",
      wslRuntimeVersion: "0.6.0",
      wslNpmMarkerExists: false,
    });
    expect(deps.invoke).not.toHaveBeenCalled();
  });

  it("keeps a frozen legacy installation current without downloading or restarting", async () => {
    const deps = createDeps({
      invoke: vi.fn(async (method) => {
        if (method === "checkForUpdates") return { status: "idle", components: [] };
        if (method === "getUpdateState") return { status: "idle", components: [] };
        throw new Error(`Unexpected method: ${method}`);
      }),
      readEvidence: vi.fn(async () => ({
        actualShellVersion: "0.2.0",
        actualRuntimeVersion: "0.5.0",
        wslRuntimeVersion: null,
        wslNpmMarkerExists: false,
        journalRecovered: false,
      })),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "legacy-current",
      expectedComponentIds: [],
      targetShellVersion: "0.2.0",
      targetRuntimeVersion: "0.5.0",
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(deps.invoke).toHaveBeenCalledOnce();
    expect(deps.invoke).toHaveBeenCalledWith("checkForUpdates");
    expect(report).toMatchObject({
      scenario: "legacy-current",
      confirmationCount: 0,
      restartCount: 0,
      actualShellVersion: "0.2.0",
      actualRuntimeVersion: "0.5.0",
    });
  });

  it("keeps a frozen legacy WSL Runtime current", async () => {
    const deps = createDeps({
      invoke: vi.fn(async (method) => {
        if (method === "checkForUpdates") return { status: "idle", components: [] };
        if (method === "getUpdateState") return { status: "idle", components: [] };
        throw new Error(`Unexpected method: ${method}`);
      }),
      readEvidence: vi.fn(async () => ({
        actualShellVersion: "0.2.0",
        actualRuntimeVersion: "0.5.0",
        wslRuntimeVersion: "0.5.0",
        wslNpmMarkerExists: false,
        journalRecovered: false,
      })),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "legacy-wsl-current",
      expectedComponentIds: [],
      targetShellVersion: "0.2.0",
      targetRuntimeVersion: "0.5.0",
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(report.wslRuntimeVersion).toBe("0.5.0");
    expect(report.wslNpmMarkerExists).toBe(false);
  });

  it("keeps an external sidecar browser read-only without invoking Desktop mutation methods", async () => {
    const deps = createDeps();
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "external-sidecar-browser",
      expectedComponentIds: [],
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(deps.verifyExternalSidecar).toHaveBeenCalledOnce();
    expect(deps.invoke).not.toHaveBeenCalled();
    expect(report).toMatchObject({
      confirmationCount: 0,
      restartCount: 0,
      externalSidecarReadOnly: true,
    });
  });

  it("relaunches and resumes after an interrupted download before installing once", async () => {
    let downloadAttempts = 0;
    let firstDownloadSettled = false;
    let rejectFirstDownload: ((reason?: unknown) => void) | undefined;
    const deps = createDeps({
      invoke: vi.fn(async (method) => {
        if (method === "checkForUpdates") return state("available");
        if (method === "downloadUpdate") {
          downloadAttempts += 1;
          if (downloadAttempts === 1) {
            return await new Promise<never>((_resolve, reject) => {
              rejectFirstDownload = reject;
            }).finally(() => {
              firstDownloadSettled = true;
            });
          }
          return state("ready");
        }
        if (method === "prepareUpdateRestart") return state("ready");
        if (method === "restartAndInstallUpdate") return true;
        if (method === "getUpdateState") return state("succeeded");
        throw new Error(`Unexpected method: ${method}`);
      }),
      waitForState: vi.fn(async (status) => {
        if (status === "downloading") {
          return { ...state("available"), status: "downloading" };
        }
        return state("ready");
      }),
      interruptAtPhase: vi.fn(async (phase) => {
        expect(phase).toBe("downloading");
        expect(firstDownloadSettled).toBe(false);
        rejectFirstDownload?.(new Error("Desktop stopped during download"));
        await Promise.resolve();
      }),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "interrupted-download",
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps, {
      downloadTimeoutMs: 100,
    });

    expect(deps.waitForState).toHaveBeenCalledWith("downloading");
    expect(deps.interruptAtPhase).toHaveBeenCalledWith("downloading");
    expect(deps.reconnectAfterRestart).toHaveBeenCalledTimes(2);
    expect(downloadAttempts).toBe(2);
    expect(report.restartCount).toBe(1);
  });

  it("requires health-failure rollback evidence to name the previous trusted Runtime", async () => {
    const deps = createDeps({
      readEvidence: vi.fn(async () => ({
        actualShellVersion: "0.3.0",
        actualRuntimeVersion: "0.5.0",
        wslRuntimeVersion: null,
        wslNpmMarkerExists: false,
        journalRecovered: true,
        rollbackRuntimeVersion: "0.5.0",
        externalSidecarReadOnly: false,
        logPaths: ["C:\\acceptance\\desktop-update.log"],
      })),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "runtime-health-rollback",
      expectedRuntimeAfterRestart: "0.5.0",
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(report.rollbackRuntimeVersion).toBe("0.5.0");
  });

  it("updates shared Web before following it with the WSL Runtime", async () => {
    const deps = createDeps({
      invoke: vi.fn(async (method) => {
        if (method === "checkForUpdates") {
          return { status: "available", components: [{ id: "runtime:win32-x64" }] };
        }
        if (method === "restartAndInstallUpdate") return true;
        return state(method === "getUpdateState" ? "succeeded" : "ready");
      }),
      readEvidence: vi.fn(async () => ({
        actualShellVersion: "0.3.0",
        actualRuntimeVersion: "0.6.0",
        wslRuntimeVersion: "0.6.0",
        wslNpmMarkerExists: false,
        journalRecovered: true,
      })),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "wsl",
      expectedComponentIds: ["runtime:win32-x64"],
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(report.wslRuntimeVersion).toBe("0.6.0");
    expect(report.wslNpmMarkerExists).toBe(false);
    expect(deps.interruptAtPhase).toHaveBeenCalledWith("wsl-follow");
    expect(deps.reconnectAfterRestart).toHaveBeenCalledTimes(2);
  });

  it("installs the candidate Shell before exercising factory WSL bootstrap", async () => {
    const deps = createDeps({
      readEvidence: vi.fn(async () => ({
        actualShellVersion: "0.3.0",
        actualRuntimeVersion: "0.6.0",
        wslRuntimeVersion: "0.6.0",
        wslNpmMarkerExists: false,
        journalRecovered: true,
      })),
    });
    const scenario: InstalledDesktopScenario = {
      ...combinedScenario,
      name: "wsl-combined",
    };

    const report = await verifyInstalledDesktopScenario(scenario, deps);

    expect(report).toMatchObject({
      scenario: "wsl-combined",
      actualShellVersion: "0.3.0",
      actualRuntimeVersion: "0.6.0",
      wslRuntimeVersion: "0.6.0",
    });
    expect(deps.interruptAtPhase).toHaveBeenCalledWith("wsl-follow");
    expect(deps.reconnectAfterRestart).toHaveBeenCalledTimes(2);
  });

  it("rejects a plan whose component identities do not match the requested scenario", async () => {
    const deps = createDeps({
      invoke: vi.fn(async (method) =>
        method === "checkForUpdates"
          ? { status: "available", components: [{ id: "runtime:win32-x64" }] }
          : state("ready")
      ),
    });

    await expect(verifyInstalledDesktopScenario(combinedScenario, deps)).rejects.toThrow(
      "component"
    );
  });

  it("fails a stalled download internally so the runner can preserve diagnostics", async () => {
    const deps = createDeps({
      invoke: vi.fn(async (method) => {
        if (method === "checkForUpdates") return state("available");
        if (method === "downloadUpdate") return new Promise(() => undefined);
        throw new Error(`Unexpected method: ${method}`);
      }),
    });

    await expect(
      verifyInstalledDesktopScenario(combinedScenario, deps, { downloadTimeoutMs: 0 })
    ).rejects.toThrow("downloadUpdate timed out");
  });
});

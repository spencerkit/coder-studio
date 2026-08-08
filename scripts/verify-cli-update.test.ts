import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { type VerifyCliUpdateDeps, verifyCliUpdate } from "./verify-cli-update.js";

function createDeps(): VerifyCliUpdateDeps {
  return {
    command: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
    startServer: vi.fn(async () => ({
      apiUrl: "http://127.0.0.1:43123",
      stop: vi.fn(async () => undefined),
    })),
    callWs: vi.fn(async ({ op }) => {
      if (op === "updates.getState") {
        return {
          version: 2,
          currentVersion: "0.5.0",
          latestVersion: null,
          updateStatus: "idle",
        };
      }
      if (op === "updates.check") {
        return {
          version: 2,
          currentVersion: "0.5.0",
          latestVersion: "0.6.0",
          latestPublishedAt: "2026-08-08T01:02:03.000Z",
          availability: "update_available",
          updateStatus: "idle",
        };
      }
      if (op === "updates.prepareInstall") {
        return {
          activity: {
            hasActiveWork: false,
            runningTerminalCount: 0,
            runningSessionCount: 0,
            runningSupervisorCount: 0,
          },
        };
      }
      if (op === "updates.startInstall") {
        return {
          version: 2,
          currentVersion: "0.5.0",
          targetVersion: "0.6.0",
          updateStatus: "restarting",
        };
      }
      throw new Error(`Unexpected operation: ${op}`);
    }),
    waitForReconcile: vi.fn(async () => ({
      version: 2,
      currentVersion: "0.6.0",
      currentPublishedAt: "2026-08-08T01:02:03.000Z",
      latestVersion: "0.6.0",
      latestPublishedAt: "2026-08-08T01:02:03.000Z",
      targetVersion: "0.6.0",
      updateStatus: "succeeded",
    })),
    runFailureScenario: vi.fn(async ({ scenario, prefix }) => ({
      name: scenario,
      updateStatus: scenario === "permission" ? "manual_required" : "failed",
      manualCommand:
        scenario === "permission"
          ? "npm install -g @spencer-kit/coder-studio@0.6.0\ncoder-studio serve --restart"
          : scenario === "restart"
            ? "coder-studio serve --restart"
            : null,
      logVerified: true,
      workerLog: `${scenario} deterministic failure`,
      paths: [`${prefix}/${scenario}/state/update-state.json`],
    })),
    removePrefix: vi.fn(async () => undefined),
    writeReport: vi.fn(async () => undefined),
  };
}

describe("verify-cli-update", () => {
  it("upgrades a packaged CLI inside one isolated npm prefix", async () => {
    const deps = createDeps();
    const prefix = resolve("/tmp/coder-studio-cli-acceptance-42");

    const report = await verifyCliUpdate(
      {
        packageName: "@spencer-kit/coder-studio",
        previousVersion: "0.5.0",
        candidateVersion: "0.6.0",
        registryUrl: "https://registry.npmjs.org/",
        distTag: "coder-studio-accept-42",
        commitSha: "0123456789abcdef",
        prefix,
      },
      deps
    );

    expect(deps.command).toHaveBeenNthCalledWith(
      1,
      "npm",
      ["install", "--global", "--prefix", prefix, "@spencer-kit/coder-studio@0.5.0"],
      expect.objectContaining({
        env: expect.objectContaining({
          npm_config_prefix: prefix,
          CODER_STUDIO_UPDATE_DIST_TAG: "coder-studio-accept-42",
        }),
      })
    );
    expect(deps.callWs).toHaveBeenCalledWith(
      expect.objectContaining({ op: "updates.prepareInstall", args: {} })
    );
    expect(deps.callWs).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "updates.startInstall",
        args: { targetVersion: "0.6.0", force: false },
      })
    );
    expect(report).toMatchObject({
      schemaVersion: 1,
      commitSha: "0123456789abcdef",
      previousVersion: "0.5.0",
      candidateVersion: "0.6.0",
      candidatePublishedAt: "2026-08-08T01:02:03.000Z",
      prefix,
      exactInstallObserved: true,
      restartObserved: true,
      reconciledStatus: "succeeded",
      scenarios: [
        { name: "permission", updateStatus: "manual_required", logVerified: true },
        { name: "install", updateStatus: "failed", logVerified: true },
        { name: "restart", updateStatus: "failed", logVerified: true },
      ],
    });
    expect(deps.runFailureScenario).toHaveBeenCalledTimes(3);
    expect(deps.removePrefix).toHaveBeenCalledWith(prefix);
  });

  it("rejects an acceptance prefix that reports active work", async () => {
    const deps = createDeps();
    vi.mocked(deps.callWs).mockImplementation(async ({ op }) => {
      if (op === "updates.getState") {
        return { version: 2, currentVersion: "0.5.0", updateStatus: "idle" };
      }
      if (op === "updates.check") {
        return {
          version: 2,
          currentVersion: "0.5.0",
          latestVersion: "0.6.0",
          latestPublishedAt: "2026-08-08T01:02:03.000Z",
        };
      }
      if (op === "updates.prepareInstall") {
        return {
          activity: {
            hasActiveWork: true,
            runningTerminalCount: 1,
            runningSessionCount: 0,
            runningSupervisorCount: 0,
          },
        };
      }
      if (op === "updates.startInstall") {
        throw new Error("startInstall must not run while acceptance has active work");
      }
      throw new Error(`Unexpected operation: ${op}`);
    });

    await expect(
      verifyCliUpdate(
        {
          packageName: "@spencer-kit/coder-studio",
          previousVersion: "0.5.0",
          candidateVersion: "0.6.0",
          registryUrl: "https://registry.npmjs.org/",
          distTag: "candidate",
          prefix: resolve("/tmp/coder-studio-cli-acceptance-active"),
        },
        deps
      )
    ).rejects.toThrow("active work");
    expect(deps.callWs).not.toHaveBeenCalledWith(
      expect.objectContaining({ op: "updates.startInstall" })
    );
  });

  it("rejects failure evidence that escapes the validated acceptance prefix", async () => {
    const deps = createDeps();
    vi.mocked(deps.runFailureScenario).mockResolvedValueOnce({
      name: "permission",
      updateStatus: "manual_required",
      manualCommand: "npm install -g @spencer-kit/coder-studio@0.6.0",
      logVerified: true,
      workerLog: "permission EACCES",
      paths: [resolve("/tmp/outside-update-state.json")],
    });

    await expect(
      verifyCliUpdate(
        {
          packageName: "@spencer-kit/coder-studio",
          previousVersion: "0.5.0",
          candidateVersion: "0.6.0",
          registryUrl: "https://registry.npmjs.org/",
          distTag: "candidate",
          prefix: resolve("/tmp/coder-studio-cli-acceptance-boundary"),
        },
        deps
      )
    ).rejects.toThrow("outside");
  });

  it("rejects a caller-supplied prefix outside the acceptance namespace", async () => {
    await expect(
      verifyCliUpdate(
        {
          packageName: "@spencer-kit/coder-studio",
          previousVersion: "0.5.0",
          candidateVersion: "0.6.0",
          registryUrl: "https://registry.npmjs.org/",
          distTag: "candidate",
          prefix: resolve("/tmp/arbitrary-prefix"),
        },
        createDeps()
      )
    ).rejects.toThrow("coder-studio-cli-acceptance-");
  });

  it("blocks promotion when the selected dist-tag does not resolve the exact candidate", async () => {
    const deps = createDeps();
    vi.mocked(deps.callWs).mockImplementation(async ({ op }) => {
      if (op === "updates.getState") return { version: 2, currentVersion: "0.5.0" };
      if (op === "updates.check") {
        return {
          version: 2,
          currentVersion: "0.5.0",
          latestVersion: "0.6.1",
          latestPublishedAt: "2026-08-08T01:02:03.000Z",
        };
      }
      throw new Error(`Unexpected operation: ${op}`);
    });

    await expect(
      verifyCliUpdate(
        {
          packageName: "@spencer-kit/coder-studio",
          previousVersion: "0.5.0",
          candidateVersion: "0.6.0",
          registryUrl: "https://registry.npmjs.org/",
          distTag: "candidate",
          prefix: resolve("/tmp/coder-studio-cli-acceptance-mismatch"),
        },
        deps
      )
    ).rejects.toThrow("0.6.0");
  });
});

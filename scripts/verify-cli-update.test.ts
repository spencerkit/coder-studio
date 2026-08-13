import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  type AcceptanceWebSocket,
  callActivatedCoderStudioWsCommand,
  parseVerifyCliUpdateArgs,
  startCandidateRegistryProxy,
  type VerifyCliUpdateDeps,
  verifyCliUpdate,
} from "./verify-cli-update.js";

function createDeps(): VerifyCliUpdateDeps {
  return {
    command: vi.fn(async () => ({ stdout: "ok", stderr: "" })),
    startServer: vi.fn(async () => ({
      apiUrl: "http://127.0.0.1:43123",
      stop: vi.fn(async () => undefined),
    })),
    lookupReleaseMetadata: vi.fn(async () => ({
      version: "0.6.0",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      latestPublishedAt: "2026-08-08T01:02:03.000Z",
    })),
    wait: vi.fn(async () => undefined),
    startRegistryProxy: vi.fn(async ({ registryUrl }) => ({
      registryUrl,
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
      availability: "up_to_date",
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
  it("serves a loopback npm registry view with the candidate mapped to latest", async () => {
    const clientFetch = globalThis.fetch;
    const upstreamFetch = vi.fn(async () =>
      Response.json({
        name: "@spencer-kit/coder-studio",
        "dist-tags": {
          latest: "0.5.6",
          "coder-studio-accept-42": "0.5.7",
        },
        versions: { "0.5.6": {}, "0.5.7": {} },
      })
    );
    vi.stubGlobal("fetch", upstreamFetch);
    const proxy = await startCandidateRegistryProxy({
      registryUrl: "https://registry.npmjs.org/",
      packageName: "@spencer-kit/coder-studio",
      candidateVersion: "0.5.7",
    });

    try {
      const response = await clientFetch(
        new URL("%40spencer-kit%2Fcoder-studio", proxy.registryUrl)
      );
      await expect(response.json()).resolves.toMatchObject({
        "dist-tags": {
          latest: "0.5.7",
          "coder-studio-accept-42": "0.5.7",
        },
      });
      expect(upstreamFetch).toHaveBeenCalledWith(expect.any(URL), { cache: "no-store" });
      expect(String(upstreamFetch.mock.calls[0]?.[0])).toBe(
        new URL("%40spencer-kit%2Fcoder-studio", "https://registry.npmjs.org/").toString()
      );
    } finally {
      await proxy.stop();
      vi.unstubAllGlobals();
    }
  });

  it("claims activation and runs the update command on the same websocket", async () => {
    const sent: Array<Record<string, unknown>> = [];
    let socket: AcceptanceWebSocket | undefined;
    const command = callActivatedCoderStudioWsCommand<{ currentVersion: string }>(
      {
        apiUrl: "http://127.0.0.1:43123",
        op: "updates.getState",
        args: {},
      },
      () => {
        socket = {
          onopen: null,
          onmessage: null,
          onerror: null,
          onclose: null,
          send: (data) => sent.push(JSON.parse(data) as Record<string, unknown>),
          close: vi.fn(),
        };
        queueMicrotask(() => socket?.onopen?.());
        return socket;
      }
    );

    await vi.waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toMatchObject({ op: "activation.claim" });
    socket?.onmessage?.({
      data: JSON.stringify({ kind: "result", id: sent[0].id, ok: true, data: { active: true } }),
    });
    await vi.waitFor(() => expect(sent).toHaveLength(2));
    expect(sent[1]).toMatchObject({ op: "updates.getState", args: {} });
    socket?.onmessage?.({
      data: JSON.stringify({
        kind: "result",
        id: sent[1].id,
        ok: true,
        data: { currentVersion: "0.5.7" },
      }),
    });

    await expect(command).resolves.toEqual({ currentVersion: "0.5.7" });
    expect(socket?.close).toHaveBeenCalledOnce();
  });

  it("accepts pnpm's argument separator before workflow options", () => {
    expect(
      parseVerifyCliUpdateArgs([
        "--",
        "--package-name",
        "@spencer-kit/coder-studio",
        "--previous-version",
        "0.5.6",
        "--candidate-version",
        "0.5.7",
        "--registry-url",
        "https://registry.npmjs.org/",
        "--dist-tag",
        "coder-studio-accept-42",
        "--commit-sha",
        "0123456789abcdef",
        "--report",
        "release/report.json",
      ])
    ).toEqual({
      packageName: "@spencer-kit/coder-studio",
      previousVersion: "0.5.6",
      candidateVersion: "0.5.7",
      registryUrl: "https://registry.npmjs.org/",
      distTag: "coder-studio-accept-42",
      commitSha: "0123456789abcdef",
      prefix: undefined,
      reportPath: "release/report.json",
    });
  });

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

  it("bootstraps an exact candidate from a legacy v1 update state", async () => {
    const deps = createDeps();
    vi.mocked(deps.callWs).mockImplementation(async ({ op }) => {
      if (op === "updates.getState") {
        return { version: 1, currentVersion: "0.5.6", updateStatus: "idle" };
      }
      if (op === "updates.prepareInstall") {
        return { activity: { hasActiveWork: false } };
      }
      if (op === "updates.startInstall") {
        return {
          version: 1,
          currentVersion: "0.5.6",
          targetVersion: "0.5.7",
          updateStatus: "installing",
        };
      }
      throw new Error(`Legacy server must not receive ${op}`);
    });
    vi.mocked(deps.lookupReleaseMetadata).mockResolvedValue({
      version: "0.5.7",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      latestPublishedAt: "2026-08-12T01:02:03.000Z",
    });
    vi.mocked(deps.waitForReconcile).mockResolvedValue({
      version: 2,
      currentVersion: "0.5.7",
      currentPublishedAt: "2026-08-12T01:02:03.000Z",
      latestVersion: "0.5.7",
      latestPublishedAt: "2026-08-12T01:02:03.000Z",
      availability: "up_to_date",
      updateStatus: "idle",
    });

    await expect(
      verifyCliUpdate(
        {
          packageName: "@spencer-kit/coder-studio",
          previousVersion: "0.5.6",
          candidateVersion: "0.5.7",
          registryUrl: "https://registry.npmjs.org/",
          distTag: "coder-studio-accept-42",
          prefix: resolve("/tmp/coder-studio-cli-acceptance-legacy"),
        },
        deps
      )
    ).resolves.toMatchObject({
      previousVersion: "0.5.6",
      candidateVersion: "0.5.7",
      candidatePublishedAt: "2026-08-12T01:02:03.000Z",
      reconciledStatus: "succeeded",
    });
    expect(deps.callWs).not.toHaveBeenCalledWith(expect.objectContaining({ op: "updates.check" }));
    expect(deps.callWs).toHaveBeenCalledWith(
      expect.objectContaining({
        op: "updates.startInstall",
        args: { targetVersion: "0.5.7", force: false },
      })
    );
  });

  it("waits for a just-written candidate dist-tag to propagate", async () => {
    const deps = createDeps();
    vi.mocked(deps.lookupReleaseMetadata)
      .mockRejectedValueOnce(
        new Error("npm registry did not return dist-tag coder-studio-accept-42")
      )
      .mockResolvedValue({
        version: "0.6.0",
        currentPublishedAt: "2026-07-01T00:00:00.000Z",
        latestPublishedAt: "2026-08-08T01:02:03.000Z",
      });

    await verifyCliUpdate(
      {
        packageName: "@spencer-kit/coder-studio",
        previousVersion: "0.5.0",
        candidateVersion: "0.6.0",
        registryUrl: "https://registry.npmjs.org/",
        distTag: "coder-studio-accept-42",
        prefix: resolve("/tmp/coder-studio-cli-acceptance-propagation"),
      },
      deps
    );

    expect(deps.lookupReleaseMetadata).toHaveBeenCalledTimes(2);
    expect(deps.wait).toHaveBeenCalledWith(500);
  });

  it("rejects a propagated candidate dist-tag that points at the wrong version", async () => {
    const deps = createDeps();
    vi.mocked(deps.lookupReleaseMetadata).mockResolvedValue({
      version: "0.6.1",
      currentPublishedAt: "2026-07-01T00:00:00.000Z",
      latestPublishedAt: "2026-08-09T01:02:03.000Z",
    });

    await expect(
      verifyCliUpdate(
        {
          packageName: "@spencer-kit/coder-studio",
          previousVersion: "0.5.0",
          candidateVersion: "0.6.0",
          registryUrl: "https://registry.npmjs.org/",
          distTag: "coder-studio-accept-42",
          prefix: resolve("/tmp/coder-studio-cli-acceptance-wrong-tag"),
        },
        deps
      )
    ).rejects.toThrow("resolved 0.6.1, expected exact candidate 0.6.0");
    expect(deps.wait).not.toHaveBeenCalled();
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

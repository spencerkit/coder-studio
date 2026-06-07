import { createDefaultMonitoringSettings } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { buildMonitoringSnapshot } from "../../monitoring/aggregation.js";

describe("buildMonitoringSnapshot", () => {
  it("aggregates managed roots into runtime, workspace, session, and subprocess views", () => {
    const response = buildMonitoringSnapshot({
      settings: {
        ...createDefaultMonitoringSettings(),
        enabled: true,
        subprocessDrilldownEnabled: true,
      },
      sampledAt: 100,
      host: {
        cpuPercent: 80,
        memoryUsedBytes: 800,
        memoryTotalBytes: 1000,
        memoryAvailableBytes: 200,
        loadAverage: [1, 1, 1],
        uptimeSec: 300,
        pressure: "elevated",
      },
      roots: [
        {
          ownerId: "server:1",
          rootPid: 1,
          kind: "server",
          label: "Coder Studio server",
          startedAt: 1,
        },
        {
          ownerId: "terminal:term-1",
          rootPid: 100,
          kind: "terminal",
          label: "Claude",
          workspaceId: "ws-1",
          sessionId: "sess-1",
          terminalId: "term-1",
          providerId: "claude",
          startedAt: 2,
        },
      ],
      workspaceLabels: {
        "ws-1": "coder-studio",
      },
      processRows: [
        {
          pid: 1,
          ppid: 0,
          cpuPercent: 10,
          rssBytes: 100,
          elapsedSec: 400,
          command: "node server.js",
        },
        {
          pid: 100,
          ppid: 1,
          cpuPercent: 20,
          rssBytes: 200,
          elapsedSec: 90,
          command: "claude",
        },
        {
          pid: 101,
          ppid: 100,
          cpuPercent: 5,
          rssBytes: 50,
          elapsedSec: 30,
          command: "python tool.py",
        },
      ],
      previousSnapshot: null,
    });

    expect(response.snapshot.runtime?.totalManagedCpuPercent).toBe(35);
    expect(response.snapshot.runtime?.managedProcessCount).toBe(3);
    expect(response.snapshot.workspaces[0]).toEqual(
      expect.objectContaining({
        id: "workspace:ws-1",
        label: "coder-studio",
        cpuPercent: 25,
        memoryBytes: 250,
      })
    );
    expect(response.snapshot.sessions[0]).toEqual(
      expect.objectContaining({
        id: "session:sess-1",
        cpuPercent: 25,
        processCount: 2,
      })
    );
    expect(response.snapshot.subprocessGroups[0]?.parentId).toBe("session:sess-1");
  });

  it("falls back to the workspace id when no readable label is available", () => {
    const response = buildMonitoringSnapshot({
      settings: {
        ...createDefaultMonitoringSettings(),
        enabled: true,
      },
      sampledAt: 100,
      host: null,
      roots: [
        {
          ownerId: "terminal:term-1",
          rootPid: 100,
          kind: "terminal",
          label: "Codex",
          workspaceId: "ws_1779980247607_u2lfvdjf",
          sessionId: "sess-1",
          terminalId: "term-1",
          providerId: "codex",
          startedAt: 2,
        },
      ],
      processRows: [
        {
          pid: 100,
          ppid: 1,
          cpuPercent: 20,
          rssBytes: 200,
          elapsedSec: 90,
          command: "codex",
        },
      ],
      previousSnapshot: null,
    });

    expect(response.snapshot.workspaces[0]?.label).toBe("ws_1779980247607_u2lfvdjf");
  });

  it("keeps workspace-scoped background roots under the workspace attribution tree", () => {
    const response = buildMonitoringSnapshot({
      settings: {
        ...createDefaultMonitoringSettings(),
        enabled: true,
      },
      sampledAt: 100,
      host: null,
      roots: [
        {
          ownerId: "lsp:ws-1:typescript",
          rootPid: 200,
          kind: "lsp",
          label: "TypeScript language server",
          workspaceId: "ws-1",
          startedAt: 2,
        },
      ],
      workspaceLabels: {
        "ws-1": "coder-studio",
      },
      processRows: [
        {
          pid: 200,
          ppid: 1,
          cpuPercent: 7,
          rssBytes: 150,
          elapsedSec: 45,
          command: "typescript-language-server",
        },
      ],
      previousSnapshot: null,
    });

    expect(response.snapshot.workspaces).toEqual([
      expect.objectContaining({
        id: "workspace:ws-1",
        kind: "workspace",
        label: "coder-studio",
        cpuPercent: 7,
        memoryBytes: 150,
        processCount: 1,
      }),
    ]);
    expect(response.snapshot.backgroundGroups).toEqual([
      expect.objectContaining({
        id: "background:lsp:ws-1:typescript",
        kind: "background_group",
        parentId: "workspace:ws-1",
        workspaceId: "ws-1",
        label: "TypeScript language server",
        cpuPercent: 7,
        memoryBytes: 150,
        processCount: 1,
      }),
    ]);
  });

  it("keeps host data when process collection fails", () => {
    const response = buildMonitoringSnapshot({
      settings: {
        ...createDefaultMonitoringSettings(),
        enabled: true,
      },
      sampledAt: 100,
      host: {
        cpuPercent: 50,
        memoryUsedBytes: 400,
        memoryTotalBytes: 1000,
        memoryAvailableBytes: 600,
        loadAverage: [0.5, 0.4, 0.3],
        uptimeSec: 300,
        pressure: "normal",
      },
      roots: [],
      processRows: null,
      previousSnapshot: null,
      failureReason: "ps failed",
    });

    expect(response.snapshot.host?.cpuPercent).toBe(50);
    expect(response.snapshot.runtime).toBeNull();
    expect(response.telemetry?.degraded).toBe(true);
  });
});

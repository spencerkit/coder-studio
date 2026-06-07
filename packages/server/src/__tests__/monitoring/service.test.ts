import {
  createDefaultMonitoringSettings,
  type Session,
  type Terminal,
  Topics,
} from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { ManagedProcessRegistry } from "../../monitoring/managed-process-registry.js";
import { MonitoringService } from "../../monitoring/service.js";

interface ActiveTerminalLike {
  toDTO(): Terminal;
}

describe("MonitoringService", () => {
  it("does not schedule sampling when monitoring is disabled", () => {
    const broadcaster = { broadcast: vi.fn() };
    const setIntervalSpy = vi.fn();

    const service = new MonitoringService({
      broadcaster,
      settingsRepo: {
        get: (key: string) => (key === "monitoring.enabled" ? false : undefined),
      },
      registry: new ManagedProcessRegistry({ now: () => 1 }),
      sessionMgr: { getAll: () => [], findSessionIdByTerminal: () => undefined },
      terminalMgr: { getAll: () => [] },
      hostCollector: { collect: vi.fn() },
      processCollector: { collect: vi.fn() },
      setInterval: setIntervalSpy,
      clearInterval: vi.fn(),
      now: () => 1,
    });

    service.start();

    expect(setIntervalSpy).not.toHaveBeenCalled();
    expect(service.getResponse().settings.enabled).toBe(false);
  });

  it("reloads the schedule and broadcasts snapshots when monitoring is enabled", async () => {
    const broadcaster = { broadcast: vi.fn() };
    const setIntervalSpy = vi.fn(() => ({ unref: vi.fn() }));

    const service = new MonitoringService({
      broadcaster,
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": true,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": false,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry: new ManagedProcessRegistry({ now: () => 10 }),
      sessionMgr: {
        getAll: () =>
          [
            {
              id: "sess-1",
              workspaceId: "ws-1",
              terminalId: "term-1",
              providerId: "claude",
              state: "idle",
              capability: "full",
              startedAt: 1,
              lastActiveAt: 1,
            },
          ] satisfies Session[],
        findSessionIdByTerminal: () => "sess-1",
      },
      terminalMgr: {
        getAll: () => [
          {
            spec: { workspaceId: "ws-1", kind: "agent", title: "Claude" as string | undefined },
            toDTO: () =>
              ({
                id: "term-1",
                workspaceId: "ws-1",
                kind: "agent",
                title: "Claude",
                cwd: "/tmp",
                argv: ["claude"],
                cols: 120,
                rows: 30,
                pid: 100,
                alive: true,
                createdAt: 1,
              }) satisfies Terminal,
          },
        ],
      },
      hostCollector: {
        collect: () => ({
          cpuPercent: 40,
          memoryUsedBytes: 400,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 600,
          loadAverage: [0.2, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: {
        collect: async () => [
          { pid: 100, ppid: 1, cpuPercent: 10, rssBytes: 100, elapsedSec: 5, command: "claude" },
        ],
      },
      setInterval: setIntervalSpy,
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    await service.recheck();

    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 2000);
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.monitoringSnapshotUpdated,
      expect.objectContaining({
        snapshot: expect.objectContaining({
          mode: "standard",
        }),
      })
    );
  });

  it("clears history when monitoring is turned off", async () => {
    let enabled = true;
    const service = new MonitoringService({
      broadcaster: { broadcast: vi.fn() },
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": enabled,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": true,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry: new ManagedProcessRegistry({ now: () => 10 }),
      sessionMgr: { getAll: () => [], findSessionIdByTerminal: () => undefined },
      terminalMgr: { getAll: () => [] },
      hostCollector: {
        collect: () => ({
          cpuPercent: 30,
          memoryUsedBytes: 300,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 700,
          loadAverage: [0.3, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: { collect: async () => [] },
      setInterval: vi.fn(() => ({ unref: vi.fn() })),
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    await service.recheck();
    enabled = false;
    service.reloadFromSettings();

    expect(service.getResponse().history.host.points).toEqual([]);
    expect(service.getResponse().snapshot.mode).toBe("disabled");
  });

  it("returns a host-only degraded snapshot when process collection fails", async () => {
    const broadcaster = { broadcast: vi.fn() };
    const service = new MonitoringService({
      broadcaster,
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": true,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": false,
            "monitoring.sampleIntervalMs": createDefaultMonitoringSettings().sampleIntervalMs,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry: new ManagedProcessRegistry({ now: () => 5 }),
      sessionMgr: { getAll: () => [], findSessionIdByTerminal: () => undefined },
      terminalMgr: { getAll: () => [] },
      hostCollector: {
        collect: () => ({
          cpuPercent: 55,
          memoryUsedBytes: 550,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 450,
          loadAverage: [0.4, 0.3, 0.2],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: {
        collect: async () => {
          throw new Error("ps failed");
        },
      },
      setInterval: vi.fn(() => ({ unref: vi.fn() })),
      clearInterval: vi.fn(),
      now: () => 5,
    });

    service.start();
    const response = await service.recheck();

    expect(response.snapshot.host?.cpuPercent).toBe(55);
    expect(response.snapshot.runtime).toBeNull();
    expect(response.telemetry?.degraded).toBe(true);
    expect(response.telemetry?.failureReason).toBe("ps failed");
    expect(broadcaster.broadcast).toHaveBeenCalledWith(
      Topics.monitoringSnapshotUpdated,
      expect.objectContaining({
        snapshot: expect.objectContaining({
          host: expect.objectContaining({ cpuPercent: 55 }),
          runtime: null,
        }),
        telemetry: expect.objectContaining({
          degraded: true,
          failureReason: "ps failed",
        }),
      })
    );
  });

  it("syncs managed terminal roots from terminal and session managers before sampling", async () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });
    const service = new MonitoringService({
      broadcaster: { broadcast: vi.fn() },
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": true,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": false,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry,
      sessionMgr: {
        getAll: () =>
          [
            {
              id: "sess-1",
              workspaceId: "ws-1",
              terminalId: "term-1",
              providerId: "claude",
              state: "idle",
              capability: "full",
              startedAt: 1,
              lastActiveAt: 1,
              title: "Claude Session",
            },
          ] satisfies Session[],
        findSessionIdByTerminal: () => "sess-1",
      },
      terminalMgr: {
        getAll: () => [
          {
            spec: { workspaceId: "ws-1", kind: "agent", title: "Claude" as string | undefined },
            toDTO: () =>
              ({
                id: "term-1",
                workspaceId: "ws-1",
                kind: "agent",
                title: "Claude",
                cwd: "/tmp",
                argv: ["claude"],
                cols: 120,
                rows: 30,
                pid: 100,
                alive: true,
                createdAt: 1,
              }) satisfies Terminal,
          },
        ],
      },
      hostCollector: {
        collect: () => ({
          cpuPercent: 40,
          memoryUsedBytes: 400,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 600,
          loadAverage: [0.2, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: {
        collect: async () => [
          { pid: 100, ppid: 1, cpuPercent: 10, rssBytes: 100, elapsedSec: 5, command: "claude" },
        ],
      },
      setInterval: vi.fn(() => ({ unref: vi.fn() })),
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    await service.recheck();

    expect(registry.listRoots()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ownerId: "terminal:term-1",
          rootPid: 100,
          workspaceId: "ws-1",
          terminalId: "term-1",
          sessionId: "sess-1",
          providerId: "claude",
          label: "Claude Session",
        }),
      ])
    );
  });

  it("labels workspace attribution rows with readable workspace names", async () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });
    const service = new MonitoringService({
      broadcaster: { broadcast: vi.fn() },
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": true,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": false,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry,
      sessionMgr: {
        getAll: () =>
          [
            {
              id: "sess-1",
              workspaceId: "ws_1779980247607_u2lfvdjf",
              terminalId: "term-1",
              providerId: "codex",
              state: "idle",
              capability: "full",
              startedAt: 1,
              lastActiveAt: 1,
              title: "Codex",
            },
          ] satisfies Session[],
        findSessionIdByTerminal: () => "sess-1",
      },
      workspaceMgr: {
        get: (workspaceId: string) =>
          workspaceId === "ws_1779980247607_u2lfvdjf"
            ? {
                id: workspaceId,
                path: "/home/spencer/workspace/coder-studio",
              }
            : undefined,
      },
      terminalMgr: {
        getAll: () => [
          {
            toDTO: () =>
              ({
                id: "term-1",
                workspaceId: "ws_1779980247607_u2lfvdjf",
                kind: "agent",
                title: "Codex",
                cwd: "/home/spencer/workspace/coder-studio",
                argv: ["codex"],
                cols: 120,
                rows: 30,
                pid: 100,
                alive: true,
                createdAt: 1,
              }) satisfies Terminal,
          },
        ],
      },
      hostCollector: {
        collect: () => ({
          cpuPercent: 40,
          memoryUsedBytes: 400,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 600,
          loadAverage: [0.2, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: {
        collect: async () => [
          { pid: 100, ppid: 1, cpuPercent: 10, rssBytes: 100, elapsedSec: 5, command: "codex" },
        ],
      },
      setInterval: vi.fn(() => ({ unref: vi.fn() })),
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    const response = await service.recheck();

    expect(response.snapshot.workspaces[0]).toEqual(
      expect.objectContaining({
        id: "workspace:ws_1779980247607_u2lfvdjf",
        label: "coder-studio",
      })
    );
    expect(response.snapshot.sessions[0]).toEqual(
      expect.objectContaining({
        parentId: "workspace:ws_1779980247607_u2lfvdjf",
        label: "Codex",
      })
    );
  });

  it("unregisters terminal roots that are no longer active", async () => {
    const registry = new ManagedProcessRegistry({ now: () => 10 });
    let sessions: Session[] = [
      {
        id: "sess-1",
        workspaceId: "ws-1",
        terminalId: "term-1",
        providerId: "claude",
        state: "idle",
        capability: "full",
        startedAt: 1,
        lastActiveAt: 1,
      },
    ];
    let terminals: ActiveTerminalLike[] = [
      {
        toDTO: () =>
          ({
            id: "term-1",
            workspaceId: "ws-1",
            kind: "agent",
            title: "Claude",
            cwd: "/tmp",
            argv: ["claude"],
            cols: 120,
            rows: 30,
            pid: 100,
            alive: true,
            createdAt: 1,
          }) satisfies Terminal,
      },
    ];

    const service = new MonitoringService({
      broadcaster: { broadcast: vi.fn() },
      settingsRepo: {
        get: (key: string) => {
          const settings = {
            "monitoring.enabled": true,
            "monitoring.hostMetricsEnabled": true,
            "monitoring.runtimeSummaryEnabled": true,
            "monitoring.workspaceAttributionEnabled": true,
            "monitoring.subprocessDrilldownEnabled": true,
            "monitoring.sampleIntervalMs": 2000,
          } as Record<string, unknown>;
          return settings[key];
        },
      },
      registry,
      sessionMgr: {
        getAll: () => sessions,
        findSessionIdByTerminal: () => sessions[0]?.id,
      },
      terminalMgr: {
        getAll: () => terminals,
      },
      hostCollector: {
        collect: () => ({
          cpuPercent: 30,
          memoryUsedBytes: 300,
          memoryTotalBytes: 1000,
          memoryAvailableBytes: 700,
          loadAverage: [0.3, 0.2, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        }),
      },
      processCollector: { collect: async () => [] },
      setInterval: vi.fn(() => ({ unref: vi.fn() })),
      clearInterval: vi.fn(),
      now: () => 10,
    });

    service.start();
    await service.recheck();

    expect(registry.listRoots().map((root) => root.ownerId)).toContain("terminal:term-1");

    sessions = [];
    terminals = [];
    await service.recheck();

    expect(registry.listRoots().map((root) => root.ownerId)).not.toContain("terminal:term-1");
  });
});

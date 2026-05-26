import type { MonitoringSnapshot } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import { MonitoringHistoryStore } from "../../monitoring/history-store.js";

function createSnapshot(
  sampledAt: number,
  overrides: Partial<MonitoringSnapshot>
): MonitoringSnapshot {
  return {
    sampledAt,
    mode: "standard",
    host: null,
    runtime: null,
    workspaces: [],
    sessions: [],
    subprocessGroups: [],
    backgroundGroups: [],
    ...overrides,
  };
}

describe("MonitoringHistoryStore", () => {
  it("clears host history when host metrics are unavailable for a sample", () => {
    const store = new MonitoringHistoryStore();

    store.record(
      createSnapshot(1_000, {
        host: {
          cpuPercent: 10,
          memoryUsedBytes: 100,
          memoryTotalBytes: 1_000,
          memoryAvailableBytes: 900,
          loadAverage: [0.1, 0.1, 0.1],
          uptimeSec: 10,
          pressure: "normal",
        },
      })
    );

    store.record(createSnapshot(2_000, { host: null }));

    expect(store.snapshot().host.points).toEqual([]);
  });

  it("drops workspace and session history for entities that no longer exist", () => {
    const store = new MonitoringHistoryStore();

    store.record(
      createSnapshot(1_000, {
        workspaces: [
          {
            id: "workspace:ws-1",
            kind: "workspace",
            label: "ws-1",
            cpuPercent: 10,
            memoryBytes: 100,
            processCount: 1,
            uptimeSec: 10,
            trend: "steady",
          },
        ],
        sessions: [
          {
            id: "session:sess-1",
            parentId: "workspace:ws-1",
            kind: "session",
            label: "sess-1",
            cpuPercent: 6,
            memoryBytes: 60,
            processCount: 1,
            uptimeSec: 8,
            trend: "steady",
          },
        ],
      })
    );

    store.record(createSnapshot(2_000, {}));

    expect(store.snapshot().workspaces).toEqual({});
    expect(store.snapshot().sessions).toEqual({});
  });
});

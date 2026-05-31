import { afterEach, describe, expect, it, vi } from "vitest";
import { Topics } from "../protocol/topics";
import {
  createDefaultMonitoringSettings,
  createEmptyMonitoringResponse,
  deriveMonitoringMode,
  isMonitoringSampleIntervalMs,
  MONITORING_SAMPLE_INTERVAL_OPTIONS,
  resolveMonitoringSettings,
} from "./monitoring";

describe("monitoring domain helpers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates the default monitoring settings shape", () => {
    expect(createDefaultMonitoringSettings()).toEqual({
      enabled: false,
      hostMetricsEnabled: true,
      runtimeSummaryEnabled: true,
      workspaceAttributionEnabled: true,
      subprocessDrilldownEnabled: false,
      sampleIntervalMs: 2000,
    });
  });

  it("exposes the supported sample intervals", () => {
    expect(MONITORING_SAMPLE_INTERVAL_OPTIONS).toEqual([1000, 2000, 5000, 10000]);
    expect(isMonitoringSampleIntervalMs(2000)).toBe(true);
    expect(isMonitoringSampleIntervalMs(3000)).toBe(false);
  });

  it("derives mode labels after applying dependency normalization", () => {
    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": false,
        })
      )
    ).toBe("disabled");

    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": false,
          "monitoring.workspaceAttributionEnabled": false,
          "monitoring.subprocessDrilldownEnabled": false,
        })
      )
    ).toBe("light");

    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": true,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": false,
        })
      )
    ).toBe("standard");

    expect(
      deriveMonitoringMode(
        resolveMonitoringSettings({
          "monitoring.enabled": true,
          "monitoring.hostMetricsEnabled": true,
          "monitoring.runtimeSummaryEnabled": true,
          "monitoring.workspaceAttributionEnabled": true,
          "monitoring.subprocessDrilldownEnabled": true,
        })
      )
    ).toBe("deep");
  });

  it("creates the exact empty monitoring response shape", () => {
    expect(createEmptyMonitoringResponse()).toEqual({
      settings: {
        enabled: false,
        hostMetricsEnabled: true,
        runtimeSummaryEnabled: true,
        workspaceAttributionEnabled: true,
        subprocessDrilldownEnabled: false,
        sampleIntervalMs: 2000,
      },
      snapshot: {
        sampledAt: 0,
        mode: "disabled",
        host: null,
        runtime: null,
        workspaces: [],
        sessions: [],
        subprocessGroups: [],
        backgroundGroups: [],
      },
      history: {
        host: { points: [] },
        runtime: null,
        workspaces: {},
        sessions: {},
        subprocessGroups: {},
      },
      capabilities: {
        loadAverageAvailable: process.platform !== "win32",
        processMetricsAvailable: false,
        subprocessHistoryLimited: false,
      },
      telemetry: null,
    });
  });

  it("creates an empty monitoring response without a Node process global", () => {
    vi.stubGlobal("process", undefined);

    expect(createEmptyMonitoringResponse().capabilities.loadAverageAvailable).toBe(true);
  });

  it("defines the websocket topic for monitoring snapshot broadcasts", () => {
    expect(Topics.monitoringSnapshotUpdated).toBe("monitoring.snapshot.updated");
  });
});

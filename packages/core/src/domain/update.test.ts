import { describe, expect, it } from "vitest";
import { Topics } from "../protocol/topics";
import {
  createDefaultUpdateSettings,
  createDefaultUpdateState,
  UPDATE_CHECK_INTERVAL_OPTIONS,
} from "./update";

describe("update domain helpers", () => {
  it("creates the default persisted update state shape", () => {
    expect(createDefaultUpdateState("0.4.0")).toEqual({
      version: 1,
      currentVersion: "0.4.0",
      latestVersion: null,
      availability: "unknown",
      updateStatus: "idle",
      lastCheckedAt: null,
      targetVersion: null,
      startedAt: null,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    });
  });

  it("creates the default update settings shape", () => {
    expect(createDefaultUpdateSettings()).toEqual({
      autoCheckEnabled: true,
      checkIntervalSec: 21600,
    });
  });

  it("exposes the fixed auto-check interval options", () => {
    expect(UPDATE_CHECK_INTERVAL_OPTIONS).toEqual([3600, 21600, 43200, 86400]);
  });

  it("defines the websocket topic for update state broadcasts", () => {
    expect(Topics.updateStateChanged).toBe("update.state.changed");
  });
});

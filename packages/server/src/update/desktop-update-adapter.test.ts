import { describe, expect, it } from "vitest";
import { normalizeDesktopUpdateStatePatch } from "./desktop-update-adapter.js";

describe("desktop-update-adapter", () => {
  it("accepts a valid desktop update state patch", () => {
    expect(
      normalizeDesktopUpdateStatePatch({
        currentVersion: "0.5.4",
        latestVersion: "0.5.5",
        availability: "update_available",
        updateStatus: "installing",
        targetVersion: "0.5.5",
        startedAt: 1000,
        finishedAt: null,
        requiresManualStep: false,
        manualCommand: null,
        errorSummary: null,
      })
    ).toEqual({
      currentVersion: "0.5.4",
      latestVersion: "0.5.5",
      availability: "update_available",
      updateStatus: "installing",
      targetVersion: "0.5.5",
      startedAt: 1000,
      finishedAt: null,
      requiresManualStep: false,
      manualCommand: null,
      errorSummary: null,
    });
  });

  it("rejects invalid desktop update state patch values", () => {
    expect(() =>
      normalizeDesktopUpdateStatePatch({
        updateStatus: "bogus",
      })
    ).toThrow(/updateStatus/i);
  });
});

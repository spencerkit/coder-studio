import { describe, expect, it } from "vitest";
import {
  createEmptyWorkspaceExtensionStateView,
  WORKSPACE_LOG_LEVELS,
  WORKSPACE_STATUS_PILL_STATES,
} from "./extension-state.js";

describe("workspace extension state", () => {
  it("declares the supported status pill states and log levels", () => {
    expect(WORKSPACE_STATUS_PILL_STATES).toEqual([
      "idle",
      "running",
      "success",
      "warning",
      "error",
    ]);
    expect(WORKSPACE_LOG_LEVELS).toEqual(["info", "warning", "error"]);
  });

  it("creates an empty workspace extension state view", () => {
    expect(
      createEmptyWorkspaceExtensionStateView("ws-1", {
        now: () => 1234,
      })
    ).toEqual({
      workspaceId: "ws-1",
      statusPills: [],
      progress: [],
      logs: [],
      quickActions: [],
      updatedAt: 1234,
    });
  });
});

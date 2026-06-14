import type { UiActionEvent } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { createUiActionRegistry, isAllowedFrontendUiCommand } from "./registry";

describe("ui action registry", () => {
  it("routes events to the registered executor by intent type", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const registry = createUiActionRegistry();
    registry.register("panel.show", run);

    const event: UiActionEvent = {
      requestId: "req-1",
      workspaceId: "ws-1",
      intent: { type: "panel.show", panel: "terminal" },
      dispatchedAt: 1,
    };

    await registry.execute(event);

    expect(run).toHaveBeenCalledWith(event);
  });

  it("throws when no executor is registered", async () => {
    const registry = createUiActionRegistry();

    await expect(
      registry.execute({
        requestId: "req-1",
        workspaceId: "ws-1",
        intent: { type: "panel.show", panel: "terminal" },
        dispatchedAt: 1,
      })
    ).rejects.toThrow("No UI action executor registered");
  });

  it("keeps the frontend command allowlist explicit", () => {
    expect(isAllowedFrontendUiCommand("quickOpen.open")).toBe(true);
    expect(isAllowedFrontendUiCommand("workspace.deleteAll")).toBe(false);
  });
});

import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";
import "./updates.js";

function createContext(): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {} as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: {} as never,
    lspMgr: {} as never,
    updateService: {
      getStateView: vi.fn(() => ({ currentVersion: "0.4.0" })),
      checkForUpdates: vi.fn(async () => ({ availability: "up_to_date" })),
      prepareInstall: vi.fn(() => ({ canStartInstall: false })),
      startInstall: vi.fn(async () => ({ updateStatus: "installing" })),
    } as never,
  };
}

describe("updates commands", () => {
  it("dispatches updates.getState", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "updates-get-state",
        op: "updates.getState",
        args: {},
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ currentVersion: "0.4.0" });
  });

  it("dispatches updates.check", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "updates-check",
        op: "updates.check",
        args: {},
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ availability: "up_to_date" });
  });

  it("dispatches updates.prepareInstall", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "updates-prepare-install",
        op: "updates.prepareInstall",
        args: {},
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ canStartInstall: false });
  });

  it("dispatches updates.startInstall", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "updates-start-install",
        op: "updates.startInstall",
        args: {
          targetVersion: "0.5.0",
          force: true,
        },
      },
      createContext()
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ updateStatus: "installing" });
  });
});

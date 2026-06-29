import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerShellUpdateIpc } from "./shell-update-ipc.js";
import type { ShellUpdateState } from "./shell-update-types.js";

class MockShellUpdateService extends EventEmitter {
  readonly getState = vi.fn(
    () =>
      ({
        supported: true,
        currentVersion: "1.2.3",
        latestVersion: null,
        availability: "unknown",
        status: "idle",
        lastCheckedAt: null,
        errorSummary: null,
        releaseNotes: null,
      }) satisfies ShellUpdateState
  );

  readonly checkForUpdates = vi.fn(async () => ({
    ...this.getState(),
    latestVersion: "1.2.4",
    availability: "update_available" as const,
  }));

  readonly downloadUpdate = vi.fn(async () => ({
    ...this.getState(),
    latestVersion: "1.2.4",
    availability: "downloaded" as const,
    status: "ready_to_restart" as const,
  }));

  readonly quitAndInstall = vi.fn(async () => {});
}

describe("registerShellUpdateIpc", () => {
  it("registers shell update handlers and broadcasts state changes", async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, listener: (...args: unknown[]) => Promise<unknown> | unknown) => {
          handlers.set(channel, listener);
        }
      ),
    };
    const sendFirst = vi.fn();
    const sendSecond = vi.fn();
    const service = new MockShellUpdateService();

    registerShellUpdateIpc({
      ipcMain,
      getWindows: () =>
        [{ webContents: { send: sendFirst } }, { webContents: { send: sendSecond } }] as const,
      shellUpdateService: service,
    });

    expect(ipcMain.handle).toHaveBeenCalledTimes(4);
    expect(handlers.has("desktop:shell-update:get-state")).toBe(true);
    expect(handlers.has("desktop:shell-update:check")).toBe(true);
    expect(handlers.has("desktop:shell-update:install")).toBe(true);
    expect(handlers.has("desktop:shell-update:restart-to-apply")).toBe(true);

    expect(handlers.get("desktop:shell-update:get-state")?.()).toMatchObject({
      currentVersion: "1.2.3",
    });
    await expect(handlers.get("desktop:shell-update:check")?.()).resolves.toMatchObject({
      latestVersion: "1.2.4",
      availability: "update_available",
    });
    await expect(handlers.get("desktop:shell-update:install")?.()).resolves.toMatchObject({
      status: "ready_to_restart",
    });

    await handlers.get("desktop:shell-update:restart-to-apply")?.();
    expect(service.quitAndInstall).toHaveBeenCalledTimes(1);

    const nextState: ShellUpdateState = {
      supported: true,
      currentVersion: "1.2.3",
      latestVersion: "1.2.4",
      availability: "downloaded",
      status: "ready_to_restart",
      lastCheckedAt: 123,
      errorSummary: null,
      releaseNotes: null,
    };
    service.emit("state-changed", nextState);

    expect(sendFirst).toHaveBeenCalledWith("desktop:shell-update:state-changed", nextState);
    expect(sendSecond).toHaveBeenCalledWith("desktop:shell-update:state-changed", nextState);
  });

  it("runs the pre-restart hook before quitAndInstall", async () => {
    const handlers = new Map<string, (...args: unknown[]) => Promise<unknown> | unknown>();
    const ipcMain = {
      handle: vi.fn(
        (channel: string, listener: (...args: unknown[]) => Promise<unknown> | unknown) => {
          handlers.set(channel, listener);
        }
      ),
    };
    const service = new MockShellUpdateService();
    const sequence: string[] = [];
    const beforeRestartToApply = vi.fn(async () => {
      sequence.push("before");
    });
    service.quitAndInstall.mockImplementation(async () => {
      sequence.push("quit");
    });

    registerShellUpdateIpc({
      ipcMain,
      getWindows: () => [],
      shellUpdateService: service,
      beforeRestartToApply,
    });

    await handlers.get("desktop:shell-update:restart-to-apply")?.();

    expect(beforeRestartToApply).toHaveBeenCalledTimes(1);
    expect(service.quitAndInstall).toHaveBeenCalledTimes(1);
    expect(sequence).toEqual(["before", "quit"]);
  });
});

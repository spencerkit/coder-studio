import type { IpcMain } from "electron";
import type { ShellUpdateState } from "./shell-update-types.js";

interface ShellUpdateWindowLike {
  webContents: {
    send(channel: string, ...args: unknown[]): void;
  };
}

interface ShellUpdateServiceLike {
  getState(): ShellUpdateState;
  checkForUpdates(): Promise<ShellUpdateState>;
  downloadUpdate(): Promise<ShellUpdateState>;
  quitAndInstall(): Promise<void>;
  on(event: "state-changed", listener: (state: ShellUpdateState) => void): this;
}

export function registerShellUpdateIpc(input: {
  ipcMain: Pick<IpcMain, "handle">;
  getWindows: () => ReadonlyArray<ShellUpdateWindowLike>;
  shellUpdateService: ShellUpdateServiceLike;
  beforeRestartToApply?: () => Promise<void> | void;
}): void {
  input.ipcMain.handle("desktop:shell-update:get-state", () => input.shellUpdateService.getState());
  input.ipcMain.handle("desktop:shell-update:check", () =>
    input.shellUpdateService.checkForUpdates()
  );
  input.ipcMain.handle("desktop:shell-update:install", () =>
    input.shellUpdateService.downloadUpdate()
  );
  input.ipcMain.handle("desktop:shell-update:restart-to-apply", async () => {
    await input.beforeRestartToApply?.();
    await input.shellUpdateService.quitAndInstall();
  });

  input.shellUpdateService.on("state-changed", (state) => {
    for (const window of input.getWindows()) {
      window.webContents.send("desktop:shell-update:state-changed", state);
    }
  });
}

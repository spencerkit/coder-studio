import { BrowserWindow } from "electron";

export function createMainWindow(preloadPath: string): BrowserWindow {
  return new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1024,
    minHeight: 720,
    show: false,
    backgroundColor: "#08111a",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
}

export async function loadDesktopUrl(window: BrowserWindow, url: string): Promise<void> {
  await window.loadURL(url);
  window.show();
}

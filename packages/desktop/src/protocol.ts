export const DESKTOP_READY_PREFIX = "CODER_STUDIO_DESKTOP_READY ";
export const DESKTOP_SHUTDOWN_MESSAGE = "CODER_STUDIO_DESKTOP_SHUTDOWN";

export interface DesktopReadyMessage {
  type: "ready";
  host: string;
  port: number;
  pid: number;
}

export interface DesktopBackendStatus {
  source: "managed" | "external";
  url: string;
  pid: number | null;
}

export interface DesktopApi {
  platform: NodeJS.Platform;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  getBackendStatus(): Promise<DesktopBackendStatus | null>;
}

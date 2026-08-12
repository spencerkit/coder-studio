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

export interface DesktopWindowActivityState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
}

export type DesktopEnvironmentKind = "native" | "wsl";
export type DesktopEnvironmentStatus =
  | "ready"
  | "not-installed"
  | "preparing"
  | "unavailable"
  | "error";

export interface DesktopEnvironmentTarget {
  id: string;
  kind: DesktopEnvironmentKind;
  label: string;
  distro?: string;
}

export interface DesktopEnvironmentSummary extends DesktopEnvironmentTarget {
  active: boolean;
  status: DesktopEnvironmentStatus;
  platform: "win32" | "linux";
  arch?: string;
  engineVersion?: string;
  runtimeVersion?: string;
  message?: string;
}

export interface DesktopEnvironmentProgress {
  environmentId: string;
  phase: "checking" | "downloading" | "installing" | "verifying" | "launching";
  message: string;
  percent?: number;
}

export interface DesktopEnvironmentOpenResult {
  status: "unchanged" | "opened";
}

export type DesktopRuntimeUpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "current"
  | "ready"
  | "quarantined"
  | "error";

export interface DesktopRuntimeUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  pendingVersion: string | null;
  lastCheckedAt: number | null;
  status: DesktopRuntimeUpdateStatus;
  errorSummary: string | null;
  unsupportedReason: string | null;
}

export interface DesktopApi {
  platform: NodeJS.Platform;
  updateApiVersion: 1;
  getAppVersion(): Promise<string>;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  getBackendStatus(): Promise<DesktopBackendStatus | null>;
  getWindowActivityState(): Promise<DesktopWindowActivityState>;
  onWindowActivityStateChanged(listener: (state: DesktopWindowActivityState) => void): () => void;
  listEnvironments(): Promise<DesktopEnvironmentSummary[]>;
  getActiveEnvironment(): Promise<DesktopEnvironmentSummary>;
  openEnvironment(environmentId: string): Promise<DesktopEnvironmentOpenResult>;
  onEnvironmentProgress(listener: (event: DesktopEnvironmentProgress) => void): () => void;
  getUpdateState(): Promise<ProductUpdateState>;
  checkForUpdates(): Promise<ProductUpdateState>;
  downloadUpdate(): Promise<ProductUpdateState>;
  retryUpdate(): Promise<ProductUpdateState>;
  cancelUpdateDownload(): Promise<ProductUpdateState>;
  prepareUpdateRestart(): Promise<ProductUpdateState>;
  restartAndInstallUpdate(): Promise<boolean>;
  getUpdateSettings(): Promise<DesktopUpdateSettings>;
  setUpdateSettings(
    patch: Pick<DesktopUpdateSettings, "autoCheckEnabled" | "checkIntervalSec">
  ): Promise<DesktopUpdateSettings>;
  onUpdateStateChanged(listener: (state: ProductUpdateState) => void): () => void;
  getRuntimeUpdateState(): Promise<DesktopRuntimeUpdateState>;
  checkRuntimeUpdate(): Promise<DesktopRuntimeUpdateState>;
  restartForRuntimeUpdate(): Promise<boolean>;
  onRuntimeUpdateStateChanged(listener: (state: DesktopRuntimeUpdateState) => void): () => void;
}

import type { DesktopUpdateSettings, ProductUpdateState } from "@coder-studio/core";

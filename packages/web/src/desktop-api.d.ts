interface CoderStudioDesktopApi {
  platform: string;
  updateApiVersion: 1;
  getAppVersion(): Promise<string>;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  getBackendStatus(): Promise<{
    source: "managed" | "external";
    url: string;
    pid: number | null;
  } | null>;
  listEnvironments(): Promise<DesktopEnvironmentSummary[]>;
  getActiveEnvironment(): Promise<DesktopEnvironmentSummary>;
  openEnvironment(environmentId: string): Promise<{ status: "unchanged" | "opened" }>;
  onEnvironmentProgress(listener: (event: DesktopEnvironmentProgress) => void): () => void;
  getUpdateState(): Promise<import("@coder-studio/core").ProductUpdateState>;
  checkForUpdates(): Promise<import("@coder-studio/core").ProductUpdateState>;
  downloadUpdate(): Promise<import("@coder-studio/core").ProductUpdateState>;
  retryUpdate(): Promise<import("@coder-studio/core").ProductUpdateState>;
  cancelUpdateDownload(): Promise<import("@coder-studio/core").ProductUpdateState>;
  prepareUpdateRestart(): Promise<import("@coder-studio/core").ProductUpdateState>;
  restartAndInstallUpdate(): Promise<boolean>;
  getUpdateSettings(): Promise<import("@coder-studio/core").DesktopUpdateSettings>;
  setUpdateSettings(
    patch: Pick<
      import("@coder-studio/core").DesktopUpdateSettings,
      "autoCheckEnabled" | "checkIntervalSec"
    >
  ): Promise<import("@coder-studio/core").DesktopUpdateSettings>;
  onUpdateStateChanged(
    listener: (state: import("@coder-studio/core").ProductUpdateState) => void
  ): () => void;
  // Runtime-only members remain temporarily for compatibility with older Web bundles.
  getRuntimeUpdateState(): Promise<DesktopRuntimeUpdateState>;
  checkRuntimeUpdate(): Promise<DesktopRuntimeUpdateState>;
  restartForRuntimeUpdate(): Promise<boolean>;
  onRuntimeUpdateStateChanged(listener: (state: DesktopRuntimeUpdateState) => void): () => void;
}

interface DesktopRuntimeUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  pendingVersion: string | null;
  lastCheckedAt: number | null;
  status: "disabled" | "idle" | "checking" | "current" | "ready" | "quarantined" | "error";
  errorSummary: string | null;
  unsupportedReason: string | null;
}

interface DesktopEnvironmentSummary {
  id: string;
  kind: "native" | "wsl";
  label: string;
  distro?: string;
  active: boolean;
  status: "ready" | "not-installed" | "preparing" | "unavailable" | "error";
  platform: "win32" | "linux";
  arch?: string;
  engineVersion?: string;
  runtimeVersion?: string;
  message?: string;
}

interface DesktopEnvironmentProgress {
  environmentId: string;
  phase: "checking" | "downloading" | "installing" | "verifying" | "launching";
  message: string;
  percent?: number;
}

interface Window {
  coderStudioDesktop?: CoderStudioDesktopApi;
}

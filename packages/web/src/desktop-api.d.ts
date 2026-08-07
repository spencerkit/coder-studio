interface CoderStudioDesktopApi {
  platform: string;
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

interface CoderStudioDesktopApi {
  platform: string;
  // Optional while newer Web bundles can still be paired with an older Desktop shell.
  desktopPreferencesApiVersion?: 1;
  updateApiVersion: 1;
  getAppVersion(): Promise<string>;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  getBackendStatus(): Promise<{
    source: "managed" | "external";
    url: string;
    pid: number | null;
  } | null>;
  // Optional while newer Web bundles can still be paired with an older Desktop shell.
  recoverAuthentication?(): Promise<boolean>;
  onAuthenticationRecovered?(listener: () => void): () => void;
  // Optional while newer Web bundles can still be paired with an older Desktop shell.
  getWindowActivityState?(): Promise<DesktopWindowActivityState>;
  onWindowActivityStateChanged?(listener: (state: DesktopWindowActivityState) => void): () => void;
  // Optional while newer Web bundles can still be paired with an older Desktop shell.
  getNotificationSupport?(): Promise<boolean>;
  showNotification?(request: DesktopNotificationRequest): Promise<DesktopNotificationResult>;
  onNotificationClicked?(listener: (target: DesktopNotificationTarget) => void): () => void;
  listEnvironments(): Promise<DesktopEnvironmentSummary[]>;
  getActiveEnvironment(): Promise<DesktopEnvironmentSummary>;
  openEnvironment(environmentId: string): Promise<{ status: "unchanged" | "opened" }>;
  onEnvironmentProgress(listener: (event: DesktopEnvironmentProgress) => void): () => void;
  getDesktopPreferences?(): Promise<import("@coder-studio/core").DesktopPreferencesSnapshot>;
  initializeDesktopTheme?(
    themeId: string
  ): Promise<import("@coder-studio/core").DesktopPreferencesSnapshot>;
  updateDesktopPreferences?(
    patch: import("@coder-studio/core").DesktopPreferencesPatch
  ): Promise<import("@coder-studio/core").DesktopPreferencesSnapshot>;
  onDesktopPreferencesChanged?(
    listener: (snapshot: import("@coder-studio/core").DesktopPreferencesSnapshot) => void
  ): () => void;
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

interface DesktopNotificationRequest {
  title: string;
  body: string;
  tag: string;
  workspaceId: string;
  sessionId: string;
}

interface DesktopNotificationTarget {
  workspaceId: string;
  sessionId: string;
}

type DesktopNotificationResult =
  | { status: "shown" }
  | { status: "unsupported" }
  | { status: "failed" };

interface DesktopWindowActivityState {
  focused: boolean;
  visible: boolean;
  minimized: boolean;
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

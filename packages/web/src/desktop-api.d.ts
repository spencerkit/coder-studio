interface CoderStudioDesktopApi {
  platform: string;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  getBackendStatus(): Promise<{
    source: "managed" | "external";
    url: string;
    pid: number | null;
  } | null>;
  listEnvironments(): Promise<DesktopEnvironmentSummary[]>;
  getActiveEnvironment(): Promise<DesktopEnvironmentSummary>;
  switchEnvironment(environmentId: string): Promise<{ status: "unchanged" | "relaunching" }>;
  onEnvironmentProgress(listener: (event: DesktopEnvironmentProgress) => void): () => void;
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
  phase: "checking" | "downloading" | "installing" | "verifying" | "relaunching";
  message: string;
  percent?: number;
}

interface Window {
  coderStudioDesktop?: CoderStudioDesktopApi;
}

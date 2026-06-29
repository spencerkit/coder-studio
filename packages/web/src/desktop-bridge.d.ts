export interface DesktopShellUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  availability: "unknown" | "up_to_date" | "update_available" | "downloaded" | "error";
  status: "idle" | "checking" | "downloading" | "ready_to_restart" | "installing" | "failed";
  lastCheckedAt: number | null;
  errorSummary: string | null;
  releaseNotes: string | null;
}

export interface DesktopBridge {
  retryStartup(): void;
  quit(): void;
  shellUpdate?: {
    getState(): Promise<DesktopShellUpdateState>;
    check(): Promise<DesktopShellUpdateState>;
    install(): Promise<DesktopShellUpdateState>;
    restartToApply(): Promise<void>;
    subscribe(listener: (state: DesktopShellUpdateState) => void): () => void;
  };
}

declare global {
  interface Window {
    coderStudioDesktop?: DesktopBridge;
  }
}

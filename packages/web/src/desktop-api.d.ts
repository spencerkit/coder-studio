interface CoderStudioDesktopApi {
  platform: string;
  selectWorkspaceDirectory(): Promise<string | null>;
  openExternal(url: string): Promise<boolean>;
  getBackendStatus(): Promise<{
    source: "managed" | "external";
    url: string;
    pid: number | null;
  } | null>;
}

interface Window {
  coderStudioDesktop?: CoderStudioDesktopApi;
}

import type { BrowserWindow } from "electron";
import { type DesktopErrorPageModel, renderDesktopErrorPage } from "./error-page.js";

interface WindowLike {
  loadURL(url: string): Promise<unknown>;
  focus(): void;
  show(): void;
}

interface StartedSidecarLike {
  browserUrl: string;
  getLogExcerpt(): string;
  send(message: unknown): void;
  stop(timeoutMs?: number): Promise<void>;
  on(
    event: "exit",
    listener: (payload: { code: number | null; signal: NodeJS.Signals | null }) => void
  ): void;
  on(event: "message", listener: (message: unknown) => void): void;
}

interface DesktopUpdateBridgeLike {
  handleSidecarMessage(message: unknown): Promise<void>;
}

export class DesktopAppController {
  private window: WindowLike | null = null;
  private sidecar: StartedSidecarLike | null = null;
  private ignoreSidecarExit = false;
  private readonly updateBridge: DesktopUpdateBridgeLike | null;

  constructor(
    private readonly deps: {
      createWindow: () => WindowLike;
      prepareRuntime?: () => Promise<void>;
      startSidecar: () => Promise<StartedSidecarLike>;
      loadDesktopUrl: (window: WindowLike, url: string) => Promise<void>;
      showErrorPage: (window: WindowLike, model: DesktopErrorPageModel) => Promise<void>;
      createUpdateBridge?: (input: {
        getSidecar: () => StartedSidecarLike | null;
        restartSidecar: () => Promise<void>;
      }) => DesktopUpdateBridgeLike;
    }
  ) {
    this.updateBridge =
      this.deps.createUpdateBridge?.({
        getSidecar: () => this.sidecar,
        restartSidecar: async () => {
          await this.restartSidecar();
        },
      }) ?? null;
  }

  async launch(): Promise<void> {
    this.window ??= this.deps.createWindow();
    this.ignoreSidecarExit = false;

    try {
      await this.deps.prepareRuntime?.();
      await this.startAndLoadSidecar();
    } catch (error) {
      const logExcerpt =
        typeof (error as { logExcerpt?: unknown }).logExcerpt === "string"
          ? ((error as { logExcerpt: string }).logExcerpt ?? undefined)
          : undefined;
      const phase =
        typeof (error as { phase?: unknown }).phase === "string"
          ? ((error as { phase: string }).phase ?? undefined)
          : undefined;
      const releaseSource =
        typeof (error as { releaseSource?: unknown }).releaseSource === "string"
          ? ((error as { releaseSource: string }).releaseSource ?? undefined)
          : undefined;
      await this.deps.showErrorPage(this.window, {
        title:
          phase === "resolve_release" || phase === "install_release"
            ? "Coder Studio runtime bootstrap failed"
            : "Coder Studio runtime failed to start",
        detail: error instanceof Error ? error.message : String(error),
        canRetry: true,
        logExcerpt,
        ...(releaseSource
          ? {
              diagnosticLabel: "Bootstrap source",
              diagnosticValue: releaseSource,
            }
          : {}),
      });
    }
  }

  async retry(): Promise<void> {
    await this.shutdown();
    await this.launch();
  }

  focus(): void {
    this.window?.focus();
  }

  async shutdown(): Promise<void> {
    await this.stopActiveSidecar();
  }

  private async startAndLoadSidecar(): Promise<void> {
    if (!this.window) {
      throw new Error("Desktop window is not available");
    }

    const sidecar = await this.deps.startSidecar();
    this.attachSidecar(sidecar);
    await this.deps.loadDesktopUrl(this.window, sidecar.browserUrl);
  }

  private attachSidecar(sidecar: StartedSidecarLike): void {
    this.sidecar = sidecar;
    sidecar.on("exit", async () => {
      if (this.ignoreSidecarExit || !this.window) {
        return;
      }

      this.sidecar = null;
      await this.deps.showErrorPage(this.window, {
        title: "Coder Studio server stopped unexpectedly",
        detail: "The local runtime exited while the desktop app was open.",
        canRetry: true,
        logExcerpt: sidecar.getLogExcerpt() || undefined,
      });
    });
    sidecar.on("message", (message) => {
      void this.updateBridge?.handleSidecarMessage(message);
    });
  }

  private async restartSidecar(): Promise<void> {
    await this.stopActiveSidecar();
    await this.startAndLoadSidecar();
  }

  private async stopActiveSidecar(): Promise<void> {
    if (!this.sidecar) {
      return;
    }

    const active = this.sidecar;
    this.sidecar = null;
    this.ignoreSidecarExit = true;

    try {
      await active.stop();
    } finally {
      this.ignoreSidecarExit = false;
    }
  }
}

export async function showDesktopErrorPage(
  window: BrowserWindow,
  model: DesktopErrorPageModel
): Promise<void> {
  const html = renderDesktopErrorPage(model);
  await window.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(html)}`);
  window.show();
}

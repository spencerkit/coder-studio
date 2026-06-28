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
  stop(timeoutMs?: number): Promise<void>;
  on(
    event: "exit",
    listener: (payload: { code: number | null; signal: NodeJS.Signals | null }) => void
  ): void;
}

export class DesktopAppController {
  private window: WindowLike | null = null;
  private sidecar: StartedSidecarLike | null = null;
  private ignoreSidecarExit = false;

  constructor(
    private readonly deps: {
      createWindow: () => WindowLike;
      startSidecar: () => Promise<StartedSidecarLike>;
      loadDesktopUrl: (window: WindowLike, url: string) => Promise<void>;
      showErrorPage: (window: WindowLike, model: DesktopErrorPageModel) => Promise<void>;
    }
  ) {}

  async launch(): Promise<void> {
    this.window ??= this.deps.createWindow();
    this.ignoreSidecarExit = false;

    try {
      const sidecar = await this.deps.startSidecar();
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

      await this.deps.loadDesktopUrl(this.window, sidecar.browserUrl);
    } catch (error) {
      const logExcerpt =
        typeof (error as { logExcerpt?: unknown }).logExcerpt === "string"
          ? ((error as { logExcerpt: string }).logExcerpt ?? undefined)
          : undefined;
      await this.deps.showErrorPage(this.window, {
        title: "Coder Studio failed to start",
        detail: error instanceof Error ? error.message : String(error),
        canRetry: true,
        logExcerpt,
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

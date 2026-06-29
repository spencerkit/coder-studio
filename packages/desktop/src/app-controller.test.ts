import { describe, expect, it, vi } from "vitest";
import { DesktopAppController } from "./app-controller.js";

describe("DesktopAppController", () => {
  it("loads the sidecar browser url on successful startup", async () => {
    const loadDesktopUrl = vi.fn();
    const showErrorPage = vi.fn();
    const controller = new DesktopAppController({
      createWindow: () => ({ loadURL: vi.fn(), focus: vi.fn(), show: vi.fn() }),
      startSidecar: vi.fn(async () => ({
        browserUrl: "http://127.0.0.1:4173",
        getLogExcerpt: vi.fn(() => ""),
        send: vi.fn(),
        stop: vi.fn(),
        on: vi.fn(),
      })),
      loadDesktopUrl,
      showErrorPage,
    });

    await controller.launch();

    expect(loadDesktopUrl).toHaveBeenCalledWith(expect.anything(), "http://127.0.0.1:4173");
    expect(showErrorPage).not.toHaveBeenCalled();
  });

  it("shows the startup error page when the sidecar fails to start", async () => {
    const loadDesktopUrl = vi.fn();
    const showErrorPage = vi.fn();
    const startupError = Object.assign(new Error("state directory already in use"), {
      logExcerpt: "stderr: Runtime state directory is already in use by pid 5003",
    });
    const controller = new DesktopAppController({
      createWindow: () => ({ loadURL: vi.fn(), focus: vi.fn(), show: vi.fn() }),
      startSidecar: vi.fn(async () => {
        throw startupError;
      }),
      loadDesktopUrl,
      showErrorPage,
    });

    await controller.launch();

    expect(showErrorPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Coder Studio runtime failed to start",
        detail: "state directory already in use",
        logExcerpt: "stderr: Runtime state directory is already in use by pid 5003",
      })
    );
  });

  it("shows a bootstrap-specific error page when runtime preparation fails", async () => {
    const showErrorPage = vi.fn();
    const controller = new DesktopAppController({
      createWindow: () => ({ loadURL: vi.fn(), focus: vi.fn(), show: vi.fn() }),
      prepareRuntime: vi.fn(async () => {
        throw Object.assign(new Error("release index unavailable"), {
          phase: "resolve_release",
          releaseSource: "github-release",
        });
      }),
      startSidecar: vi.fn(async () => ({
        browserUrl: "http://127.0.0.1:4173",
        getLogExcerpt: vi.fn(() => ""),
        send: vi.fn(),
        stop: vi.fn(),
        on: vi.fn(),
      })),
      loadDesktopUrl: vi.fn(),
      showErrorPage,
    });

    await controller.launch();

    expect(showErrorPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        title: "Coder Studio runtime bootstrap failed",
        detail: "release index unavailable",
        diagnosticLabel: "Bootstrap source",
        diagnosticValue: "github-release",
      })
    );
  });

  it("stops the sidecar during shutdown", async () => {
    const stop = vi.fn(async () => {});
    const controller = new DesktopAppController({
      createWindow: () => ({ loadURL: vi.fn(), focus: vi.fn(), show: vi.fn() }),
      startSidecar: vi.fn(async () => ({
        browserUrl: "http://127.0.0.1:4173",
        getLogExcerpt: vi.fn(() => ""),
        send: vi.fn(),
        stop,
        on: vi.fn(),
      })),
      loadDesktopUrl: vi.fn(),
      showErrorPage: vi.fn(),
    });

    await controller.launch();
    await controller.shutdown();

    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("does not show the crash page when the app intentionally stops the sidecar", async () => {
    let onExit: ((payload: { code: number | null; signal: NodeJS.Signals | null }) => void) | null =
      null;
    const stop = vi.fn(async () => {
      onExit?.({ code: 0, signal: "SIGTERM" });
    });
    const showErrorPage = vi.fn();
    const controller = new DesktopAppController({
      createWindow: () => ({ loadURL: vi.fn(), focus: vi.fn(), show: vi.fn() }),
      startSidecar: vi.fn(async () => ({
        browserUrl: "http://127.0.0.1:4173",
        getLogExcerpt: vi.fn(() => ""),
        send: vi.fn(),
        stop,
        on: vi.fn((event, listener) => {
          if (event === "exit") {
            onExit = listener;
          }
        }),
      })),
      loadDesktopUrl: vi.fn(),
      showErrorPage,
    });

    await controller.launch();
    await controller.shutdown();

    expect(showErrorPage).not.toHaveBeenCalled();
  });
});

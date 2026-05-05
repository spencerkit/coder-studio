import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkspaceFullscreen } from "./use-workspace-fullscreen";

function installFullscreenApi() {
  let fullscreenElement: Element | null = null;

  const requestFullscreen = vi.fn().mockImplementation(function (this: HTMLElement) {
    fullscreenElement = this;
    document.dispatchEvent(new Event("fullscreenchange"));
    return Promise.resolve();
  });

  const exitFullscreen = vi.fn().mockImplementation(async () => {
    fullscreenElement = null;
    document.dispatchEvent(new Event("fullscreenchange"));
  });

  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: true,
  });

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => fullscreenElement,
  });

  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreen,
  });

  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: requestFullscreen,
  });

  return {
    requestFullscreen,
    exitFullscreen,
    setFullscreenElement(next: Element | null) {
      fullscreenElement = next;
      document.dispatchEvent(new Event("fullscreenchange"));
    },
  };
}

function clearFullscreenApi() {
  Object.defineProperty(document, "fullscreenEnabled", {
    configurable: true,
    value: false,
  });

  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => null,
  });

  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: undefined,
  });

  Object.defineProperty(HTMLElement.prototype, "requestFullscreen", {
    configurable: true,
    value: undefined,
  });
}

function HookHarness() {
  const targetRef = useRef<HTMLDivElement>(null);
  const controller = useWorkspaceFullscreen(targetRef);

  return (
    <div>
      <div ref={targetRef} data-testid="fullscreen-target" />
      <output data-testid="supported">{String(controller.supported)}</output>
      <output data-testid="fullscreen">{String(controller.isFullscreen)}</output>
      <button
        type="button"
        onClick={() => {
          void controller.enterFullscreen();
        }}
      >
        enter
      </button>
      <button
        type="button"
        onClick={() => {
          void controller.exitFullscreen();
        }}
      >
        exit
      </button>
      <button
        type="button"
        onClick={() => {
          void controller.toggleFullscreen();
        }}
      >
        toggle
      </button>
    </div>
  );
}

describe("useWorkspaceFullscreen", () => {
  afterEach(() => {
    clearFullscreenApi();
    vi.restoreAllMocks();
  });

  it("reports unsupported when the browser fullscreen api is unavailable", async () => {
    clearFullscreenApi();

    render(<HookHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("supported")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
  });

  it("enters and exits fullscreen against the target element", async () => {
    const api = installFullscreenApi();

    render(<HookHarness />);

    await waitFor(() => {
      expect(screen.getByTestId("supported")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "enter" }));

    await waitFor(() => {
      expect(api.requestFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("fullscreen")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "exit" }));

    await waitFor(() => {
      expect(api.exitFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
    });
  });

  it("tracks fullscreenchange even when the browser exits fullscreen outside the button", async () => {
    const api = installFullscreenApi();

    render(<HookHarness />);

    const target = await screen.findByTestId("fullscreen-target");

    act(() => {
      api.setFullscreenElement(target);
    });

    expect(screen.getByTestId("fullscreen")).toHaveTextContent("true");

    act(() => {
      api.setFullscreenElement(null);
    });

    expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
  });

  it("leaves the state in enter mode when requestFullscreen rejects", async () => {
    installFullscreenApi();
    const requestError = new Error("fullscreen denied");
    const requestSpy = vi
      .spyOn(HTMLElement.prototype, "requestFullscreen")
      .mockRejectedValue(requestError);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    render(<HookHarness />);

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("Failed to enter fullscreen", requestError);
    });

    expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
  });
});

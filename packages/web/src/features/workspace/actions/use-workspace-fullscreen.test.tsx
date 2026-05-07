import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { toastsAtom } from "../../notifications/atoms";
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

  Object.defineProperty(document, "webkitFullscreenEnabled", {
    configurable: true,
    value: undefined,
  });

  Object.defineProperty(document, "webkitCurrentFullScreenElement", {
    configurable: true,
    get: () => undefined,
  });

  Object.defineProperty(document, "webkitExitFullscreen", {
    configurable: true,
    value: undefined,
  });

  Object.defineProperty(document, "webkitCancelFullScreen", {
    configurable: true,
    value: undefined,
  });

  Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
    configurable: true,
    value: undefined,
  });

  Object.defineProperty(HTMLElement.prototype, "webkitRequestFullScreen", {
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

function renderHarness() {
  const store = createStore();
  store.set(localeAtom, "en");

  render(
    <Provider store={store}>
      <HookHarness />
    </Provider>
  );

  return store;
}

describe("useWorkspaceFullscreen", () => {
  afterEach(() => {
    clearFullscreenApi();
    vi.restoreAllMocks();
  });

  it("reports unsupported when the browser fullscreen api is unavailable", async () => {
    clearFullscreenApi();

    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("supported")).toHaveTextContent("false");
    });
    expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
  });

  it("enters and exits fullscreen against the target element", async () => {
    const api = installFullscreenApi();

    renderHarness();

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

    renderHarness();

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

    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    await waitFor(() => {
      expect(requestSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalledWith("Failed to enter fullscreen", requestError);
    });

    expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
  });

  it("shows a friendly toast when fullscreen is unavailable instead of throwing", async () => {
    clearFullscreenApi();
    const store = renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "toggle" }));

    await waitFor(() => {
      expect(store.get(toastsAtom)).toHaveLength(1);
    });

    expect(store.get(toastsAtom)[0]).toMatchObject({
      kind: "info",
      title: "Fullscreen unavailable",
      body: "Fullscreen is not available in this browser.",
    });
  });

  it("treats webkit fullscreen support as supported even when fullscreenEnabled is false", async () => {
    let webkitFullscreenElement: Element | null = null;
    const webkitRequestFullscreen = vi.fn().mockImplementation(function (this: HTMLElement) {
      webkitFullscreenElement = this;
      document.dispatchEvent(new Event("webkitfullscreenchange"));
      return Promise.resolve();
    });
    const webkitExitFullscreen = vi.fn().mockImplementation(async () => {
      webkitFullscreenElement = null;
      document.dispatchEvent(new Event("webkitfullscreenchange"));
    });

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
    Object.defineProperty(document, "webkitCurrentFullScreenElement", {
      configurable: true,
      get: () => webkitFullscreenElement,
    });
    Object.defineProperty(document, "webkitExitFullscreen", {
      configurable: true,
      value: webkitExitFullscreen,
    });
    Object.defineProperty(HTMLElement.prototype, "webkitRequestFullscreen", {
      configurable: true,
      value: webkitRequestFullscreen,
    });

    renderHarness();

    await waitFor(() => {
      expect(screen.getByTestId("supported")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "enter" }));

    await waitFor(() => {
      expect(webkitRequestFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("fullscreen")).toHaveTextContent("true");
    });

    fireEvent.click(screen.getByRole("button", { name: "exit" }));

    await waitFor(() => {
      expect(webkitExitFullscreen).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId("fullscreen")).toHaveTextContent("false");
    });
  });
});

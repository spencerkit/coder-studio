import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { workspacesAtom } from "../../atoms/workspaces";
import {
  activeEditorTabAtomFamily,
  openEditorTabsAtomFamily,
  type WorkspaceBrowserEditorTab,
} from "../workspace/atoms";
import { currentDevBrowserUrlAtomFamily, pendingDevBrowserUrlAtomFamily } from "./atoms";
import { DevBrowserSurface } from "./dev-browser-surface";

vi.mock("../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      "dev_browser.title": "Browser",
      "dev_browser.url_label": "Local URL",
      "dev_browser.url_placeholder": "localhost:8000",
      "dev_browser.device_label": "Device",
      "dev_browser.device_desktop": "Desktop",
      "dev_browser.device_iphone_14": "iPhone 14",
      "dev_browser.device_pixel_7": "Pixel 7",
      "dev_browser.device_custom": "Custom",
      "dev_browser.viewport_width_label": "Viewport width",
      "dev_browser.viewport_height_label": "Viewport height",
      "dev_browser.rotate": "Rotate",
      "dev_browser.apply_device": "Apply device",
      "dev_browser.viewport_preview_label": "Viewport preview",
      "dev_browser.invalid_viewport": "Enter a width and height between 1 and 4096.",
      "dev_browser.open": "Open",
      "dev_browser.loading": "Opening local preview",
      "dev_browser.unsupported": "Service workers are unavailable",
      "dev_browser.error": "Could not open local preview",
      dev_browser_invalid_viewport: "Enter a width and height between 1 and 4096.",
    };
    return translations[key] ?? key;
  },
}));

vi.mock("./api", () => ({
  createDevBrowserSession: vi.fn(async (url: string) => {
    const displayUrl = new URL(/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(url) ? url : `http://${url}`)
      .href;
    return {
      id: "dev_1",
      browserUrl: "/dev-browser/session/dev_1/",
      browserProxyBase: "/dev-browser/session/dev_1/proxy",
      displayUrl,
      targetOrigin: new URL(displayUrl).origin,
    };
  }),
  deleteDevBrowserSession: vi.fn(async () => undefined),
}));

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function browserTab(
  id: string,
  url: string | null,
  overrides: Partial<WorkspaceBrowserEditorTab> = {}
): WorkspaceBrowserEditorTab {
  return {
    kind: "browser",
    id,
    url,
    devicePreset: "desktop",
    viewportWidth: null,
    viewportHeight: null,
    orientation: "portrait",
    userAgentMode: "desktop",
    ...overrides,
  };
}

function createWorkspaceStore(
  tabs: Array<ReturnType<typeof browserTab>>,
  activeTab: ReturnType<typeof browserTab>,
  workspaceId = "ws-test"
) {
  const store = createStore();
  store.set(workspacesAtom, {
    [workspaceId]: {
      id: workspaceId,
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 240,
        bottomPanelHeight: 180,
        focusMode: false,
      },
    },
  } as never);
  store.set(openEditorTabsAtomFamily(workspaceId), tabs);
  store.set(activeEditorTabAtomFamily(workspaceId), activeTab);
  return store;
}

describe("DevBrowserSurface", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  function enableServiceWorkerSupport() {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: true });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: {},
    });
  }

  async function selectDevicePreset(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(screen.getByRole("button", { name: /^Device\b/ }));
    await user.click(screen.getByRole("option", { name: label }));
  }

  async function submitLocalUrl(_user: ReturnType<typeof userEvent.setup>, value: string) {
    const input = screen.getByLabelText("Local URL");
    fireEvent.change(input, {
      target: { value },
    });
    fireEvent.keyDown(input, {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });
  }

  function getBrowserFrame() {
    return screen.getByTitle("Browser");
  }

  it("creates a session and renders the iframe", async () => {
    enableServiceWorkerSupport();
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await submitLocalUrl(user, "localhost:8000");

    await screen.findByLabelText("Viewport preview");
    const frame = getBrowserFrame();
    expect(frame).toHaveAttribute("src", "/dev-browser/session/dev_1/");
  });

  it("opens and clears pending workspace URLs", async () => {
    enableServiceWorkerSupport();
    const api = await import("./api");
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab, "ws-1");
    store.set(pendingDevBrowserUrlAtomFamily("ws-1"), "http://127.0.0.1:5173/");

    render(
      <Provider store={store}>
        <DevBrowserSurface workspaceId="ws-1" browserTab={activeTab} />
      </Provider>
    );

    await waitFor(() =>
      expect(api.createDevBrowserSession).toHaveBeenCalledWith("http://127.0.0.1:5173/", {
        userAgent: undefined,
      })
    );
    expect(screen.getByLabelText("Local URL")).toHaveValue("http://127.0.0.1:5173/");
    expect(store.get(pendingDevBrowserUrlAtomFamily("ws-1"))).toBeNull();
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-1"))).toBe("http://127.0.0.1:5173/");
  });

  it("tracks the current workspace URL after a manual open and clears it on unmount", async () => {
    enableServiceWorkerSupport();
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab, "ws-1");

    const { unmount } = render(
      <Provider store={store}>
        <DevBrowserSurface workspaceId="ws-1" browserTab={activeTab} />
      </Provider>
    );

    await submitLocalUrl(user, "localhost:8000");

    await screen.findByLabelText("Viewport preview");
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-1"))).toBe("http://localhost:8000/");

    unmount();

    expect(store.get(currentDevBrowserUrlAtomFamily("ws-1"))).toBeNull();
  });

  it("shows unsupported state when service workers are unavailable", () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    expect(screen.getByText("Service workers are unavailable")).toBeInTheDocument();
  });

  it("falls back to proxy mode when service workers are unavailable", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    const api = await import("./api");
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const user = userEvent.setup();
    await submitLocalUrl(user, "localhost:8000");

    await waitFor(() =>
      expect(api.createDevBrowserSession).toHaveBeenCalledWith("localhost:8000", {
        userAgent: undefined,
      })
    );
    await screen.findByLabelText("Viewport preview");
    expect(getBrowserFrame()).toHaveAttribute("src", "/dev-browser/session/dev_1/");
  });

  it("recreates the dev browser session from the active browser tab url without service workers", async () => {
    Object.defineProperty(window, "isSecureContext", { configurable: true, value: false });
    Object.defineProperty(window.navigator, "serviceWorker", {
      configurable: true,
      value: undefined,
    });
    const activeTab = browserTab("browser-1", "localhost:8001");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");
    const frame = getBrowserFrame();
    expect(frame).toHaveAttribute("src", "/dev-browser/session/dev_1/");

    const api = await import("./api");
    await waitFor(() =>
      expect(api.createDevBrowserSession).toHaveBeenCalledWith("localhost:8001", {
        userAgent: undefined,
      })
    );
  });

  it("deletes the active session on unmount", async () => {
    enableServiceWorkerSupport();
    const api = await import("./api");
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    const { unmount } = render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });
    await submitLocalUrl(user, "localhost:8000");
    await screen.findByLabelText("Viewport preview");

    unmount();

    await waitFor(() => expect(api.deleteDevBrowserSession).toHaveBeenCalledWith("dev_1"));
  });

  it("recreates the dev browser session from the active browser tab url on mount", async () => {
    enableServiceWorkerSupport();
    const activeTab = browserTab("browser-1", "localhost:8001");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");
    const frame = getBrowserFrame();
    expect(frame).toHaveAttribute("src", "/dev-browser/session/dev_1/");

    const api = await import("./api");
    await waitFor(() =>
      expect(api.createDevBrowserSession).toHaveBeenCalledWith("localhost:8001", {
        userAgent: undefined,
      })
    );
  });

  it("replaces the current browser tab url instead of writing devBrowserTargetUrl", async () => {
    enableServiceWorkerSupport();

    const activeTab = browserTab("browser-1", null);
    const otherTab = browserTab("browser-2", "localhost:8002");
    const store = createWorkspaceStore([activeTab, otherTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const user = userEvent.setup();
    await submitLocalUrl(user, "localhost:8000");

    await screen.findByLabelText("Viewport preview");

    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      browserTab("browser-1", "localhost:8000"),
      browserTab("browser-2", "localhost:8002"),
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
      browserTab("browser-1", "localhost:8000")
    );
    expect(store.get(workspacesAtom)["ws-test"]?.uiState).toMatchObject({
      openEditorTabs: [
        browserTab("browser-1", "localhost:8000"),
        browserTab("browser-2", "localhost:8002"),
      ],
      activeEditorTab: browserTab("browser-1", "localhost:8000"),
    });
    expect(store.get(workspacesAtom)["ws-test"]?.uiState).not.toHaveProperty("devBrowserTargetUrl");
  });

  it("stays idle for browser tabs with no url until user opens one", async () => {
    enableServiceWorkerSupport();

    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);
    const api = await import("./api");

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    expect(api.createDevBrowserSession).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Browser")).not.toBeInTheDocument();

    const user = userEvent.setup();
    await submitLocalUrl(user, "localhost:8003");

    await waitFor(() =>
      expect(api.createDevBrowserSession).toHaveBeenCalledWith("localhost:8003", {
        userAgent: undefined,
      })
    );
    await screen.findByLabelText("Viewport preview");
    expect(getBrowserFrame()).toHaveAttribute("src", "/dev-browser/session/dev_1/");
  });

  it("uses fill mode for desktop sessions and hides device-only controls", async () => {
    enableServiceWorkerSupport();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const viewport = await screen.findByLabelText("Viewport preview");
    const frame = getBrowserFrame();

    expect(screen.queryByText("Local URL")).not.toBeInTheDocument();
    expect(screen.queryByText("Device")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Viewport width")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Viewport height")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate" })).not.toBeInTheDocument();
    expect(viewport).not.toHaveClass("dev-browser-frame-viewport--device");
    expect(viewport).not.toHaveAttribute("style");
    expect(frame).not.toHaveAttribute("style");
  });

  it("reopens the session immediately when selecting a non-custom mobile preset", async () => {
    enableServiceWorkerSupport();
    const user = userEvent.setup();
    const api = await import("./api");
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");
    expect(api.createDevBrowserSession).toHaveBeenCalledTimes(1);
    expect(api.createDevBrowserSession).toHaveBeenLastCalledWith("http://127.0.0.1:5173/", {
      userAgent: undefined,
    });

    await selectDevicePreset(user, "iPhone 14");
    await waitFor(() => expect(api.createDevBrowserSession).toHaveBeenCalledTimes(2));
    expect(api.createDevBrowserSession).toHaveBeenLastCalledWith("http://127.0.0.1:5173/", {
      userAgent: expect.stringContaining("iPhone"),
    });
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
      browserTab("browser-1", "http://127.0.0.1:5173/", {
        devicePreset: "iphone-14",
        viewportWidth: 390,
        viewportHeight: 844,
        orientation: "portrait",
        userAgentMode: "mobile",
      })
    );
  });

  it("returns to desktop fill mode immediately when selecting desktop", async () => {
    enableServiceWorkerSupport();
    const user = userEvent.setup();
    const api = await import("./api");
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "pixel-7",
      viewportWidth: 412,
      viewportHeight: 915,
      orientation: "portrait",
      userAgentMode: "mobile",
    });
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");

    await selectDevicePreset(user, "Desktop");

    await waitFor(() => expect(api.createDevBrowserSession).toHaveBeenCalledTimes(2));
    expect(api.createDevBrowserSession).toHaveBeenLastCalledWith("http://127.0.0.1:5173/", {
      userAgent: undefined,
    });
    await waitFor(() =>
      expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
        browserTab("browser-1", "http://127.0.0.1:5173/", {
          devicePreset: "desktop",
          viewportWidth: null,
          viewportHeight: null,
          orientation: "portrait",
          userAgentMode: "desktop",
        })
      )
    );

    const viewport = screen.getByLabelText("Viewport preview");
    const frame = getBrowserFrame();
    expect(screen.queryByLabelText("Viewport width")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Viewport height")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate" })).not.toBeInTheDocument();
    expect(viewport).not.toHaveClass("dev-browser-frame-viewport--device");
    expect(viewport.style.width).toBe("");
    expect(viewport.style.height).toBe("");
    expect(frame.style.width).toBe("");
    expect(frame.style.height).toBe("");
  });

  it("applies rotation immediately for fixed device presets", async () => {
    enableServiceWorkerSupport();
    const api = await import("./api");
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "iphone-14",
      viewportWidth: 390,
      viewportHeight: 844,
      orientation: "portrait",
      userAgentMode: "mobile",
    });
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");

    fireEvent.click(screen.getByRole("button", { name: "Rotate" }));

    await waitFor(() => expect(api.createDevBrowserSession).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
        browserTab("browser-1", "http://127.0.0.1:5173/", {
          devicePreset: "iphone-14",
          viewportWidth: 844,
          viewportHeight: 390,
          orientation: "landscape",
          userAgentMode: "mobile",
        })
      )
    );
  });

  it("renders device sessions inside a fixed logical viewport", async () => {
    enableServiceWorkerSupport();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "pixel-7",
      viewportWidth: 412,
      viewportHeight: 915,
      orientation: "portrait",
      userAgentMode: "mobile",
    });
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const viewport = await screen.findByLabelText("Viewport preview");
    const frame = await screen.findByTitle("Browser");
    expect(viewport).toHaveStyle({ width: "412px", height: "915px", transform: "scale(1)" });
    expect(frame).toHaveStyle({ width: "412px", height: "915px" });
  });

  it("scales the logical viewport down to fit the shell", async () => {
    enableServiceWorkerSupport();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "iphone-14",
      viewportWidth: 390,
      viewportHeight: 844,
      orientation: "portrait",
      userAgentMode: "mobile",
    });
    const store = createWorkspaceStore([activeTab], activeTab);

    const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
      if ((this as HTMLElement).classList.contains("dev-browser-frame-shell")) {
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: 332,
          bottom: 632,
          width: 332,
          height: 632,
          toJSON: () => undefined,
        };
      }

      return originalGetBoundingClientRect.call(this);
    });

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const viewport = await screen.findByLabelText("Viewport preview");
    expect(viewport).toHaveStyle({ transform: "scale(0.711)" });
  });

  it("keeps custom viewport edits local until open is submitted", async () => {
    enableServiceWorkerSupport();
    const user = userEvent.setup();
    const api = await import("./api");
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "pixel-7",
      viewportWidth: 412,
      viewportHeight: 915,
      orientation: "portrait",
      userAgentMode: "mobile",
    });
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const initialViewport = await screen.findByLabelText("Viewport preview");
    expect(initialViewport).toHaveStyle({ width: "412px", height: "915px" });

    await selectDevicePreset(user, "Custom");

    fireEvent.change(screen.getByLabelText("Viewport width"), {
      target: { value: "500" },
    });
    fireEvent.change(screen.getByLabelText("Viewport height"), {
      target: { value: "700" },
    });

    expect(api.createDevBrowserSession).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Viewport preview")).toHaveStyle({
      width: "412px",
      height: "915px",
    });

    fireEvent.keyDown(screen.getByLabelText("Local URL"), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() => expect(api.createDevBrowserSession).toHaveBeenCalledTimes(2));
    expect(api.createDevBrowserSession).toHaveBeenLastCalledWith("http://127.0.0.1:5173/", {
      userAgent: expect.stringContaining("iPhone"),
    });
    await waitFor(() =>
      expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
        browserTab("browser-1", "http://127.0.0.1:5173/", {
          devicePreset: "custom",
          viewportWidth: 500,
          viewportHeight: 700,
          orientation: "portrait",
          userAgentMode: "mobile",
        })
      )
    );
    expect(screen.getByLabelText("Viewport preview")).toHaveStyle({
      width: "500px",
      height: "700px",
    });
  });

  it("blocks open and shows an error when custom viewport dimensions are invalid", async () => {
    enableServiceWorkerSupport();
    const user = userEvent.setup();
    const api = await import("./api");
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");
    expect(api.createDevBrowserSession).toHaveBeenCalledTimes(1);

    await selectDevicePreset(user, "Custom");
    fireEvent.change(screen.getByLabelText("Viewport width"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Viewport height"), {
      target: { value: "99999" },
    });
    await submitLocalUrl(user, "http://127.0.0.1:5173/");

    expect(await screen.findByText("Enter a width and height between 1 and 4096.")).toBeVisible();
    expect(api.createDevBrowserSession).toHaveBeenCalledTimes(1);
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(activeTab);
  });
});

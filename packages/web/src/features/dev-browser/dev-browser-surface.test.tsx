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
      "dev_browser.viewport_preview_label": "Viewport preview",
      "dev_browser.error": "Could not open local preview",
      "dev_browser.invalid_viewport": "Enter a width and height between 1 and 4096.",
      "dev_browser.embed_limitations":
        "Some local apps block iframe previews. If the page stays blank, open the URL in your browser or relax frame restrictions for local development.",
      dev_browser_invalid_viewport: "Enter a width and height between 1 and 4096.",
    };
    return translations[key] ?? key;
  },
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

async function selectDevicePreset(user: ReturnType<typeof userEvent.setup>, label: string) {
  await user.click(screen.getByRole("button", { name: /^Device\b/ }));
  await user.click(screen.getByRole("option", { name: label }));
}

async function submitLocalUrl(value: string) {
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

describe("DevBrowserSurface", () => {
  const originalServiceWorker = navigator.serviceWorker;

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: originalServiceWorker,
    });
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("opens a direct iframe preview without creating a proxy session", async () => {
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await submitLocalUrl("localhost:8000");

    await screen.findByLabelText("Viewport preview");
    expect(getBrowserFrame()).toHaveAttribute("src", "http://localhost:8000/");
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-test"))).toBe("http://localhost:8000/");
  });

  it("shows an embed limitation notice for direct iframe previews", () => {
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    expect(
      screen.getByText(
        "Some local apps block iframe previews. If the page stays blank, open the URL in your browser or relax frame restrictions for local development."
      )
    ).toBeVisible();
  });

  it("opens and clears pending workspace URLs directly", async () => {
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab, "ws-1");
    store.set(pendingDevBrowserUrlAtomFamily("ws-1"), "http://127.0.0.1:5173/");

    render(
      <Provider store={store}>
        <DevBrowserSurface workspaceId="ws-1" browserTab={activeTab} />
      </Provider>
    );

    await waitFor(() =>
      expect(store.get(currentDevBrowserUrlAtomFamily("ws-1"))).toBe("http://127.0.0.1:5173/")
    );
    expect(screen.getByLabelText("Local URL")).toHaveValue("http://127.0.0.1:5173/");
    expect(store.get(pendingDevBrowserUrlAtomFamily("ws-1"))).toBeNull();
    expect(getBrowserFrame()).toHaveAttribute("src", "http://127.0.0.1:5173/");
  });

  it("keeps invalid pending workspace URLs pending when they cannot be opened", async () => {
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab, "ws-1");
    store.set(pendingDevBrowserUrlAtomFamily("ws-1"), "https://example.com/app");

    render(
      <Provider store={store}>
        <DevBrowserSurface workspaceId="ws-1" browserTab={activeTab} />
      </Provider>
    );

    expect(await screen.findByText("Could not open local preview")).toBeVisible();
    expect(store.get(pendingDevBrowserUrlAtomFamily("ws-1"))).toBe("https://example.com/app");
    expect(screen.queryByTitle("Browser")).not.toBeInTheDocument();
  });

  it("unregisters legacy dev-browser service workers on mount", async () => {
    const legacyRegistration = {
      scope: "http://localhost/dev-browser/",
      unregister: vi.fn(async () => true),
    };
    const unrelatedRegistration = {
      scope: "http://localhost/preview/",
      unregister: vi.fn(async () => true),
    };
    Object.defineProperty(navigator, "serviceWorker", {
      configurable: true,
      value: {
        getRegistrations: vi.fn(async () => [legacyRegistration, unrelatedRegistration]),
      },
    });
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await waitFor(() => expect(legacyRegistration.unregister).toHaveBeenCalled());
    expect(unrelatedRegistration.unregister).not.toHaveBeenCalled();
  });

  it("reopens directly from the active browser tab url on mount", async () => {
    const activeTab = browserTab("browser-1", "localhost:8001");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");
    expect(getBrowserFrame()).toHaveAttribute("src", "http://localhost:8001/");
  });

  it("does not render invalid persisted browser tab URLs", () => {
    const activeTab = browserTab("browser-1", "https://example.com/app");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    expect(screen.queryByTitle("Browser")).not.toBeInTheDocument();
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-test"))).toBeNull();
  });

  it("replaces the current browser tab url instead of writing devBrowserTargetUrl", async () => {
    const activeTab = browserTab("browser-1", null);
    const otherTab = browserTab("browser-2", "localhost:8002");
    const store = createWorkspaceStore([activeTab, otherTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await submitLocalUrl("localhost:8000");

    await screen.findByLabelText("Viewport preview");

    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      browserTab("browser-1", "http://localhost:8000/"),
      browserTab("browser-2", "localhost:8002"),
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
      browserTab("browser-1", "http://localhost:8000/")
    );
    expect(store.get(workspacesAtom)["ws-test"]?.uiState).toMatchObject({
      openEditorTabs: [
        browserTab("browser-1", "http://localhost:8000/"),
        browserTab("browser-2", "localhost:8002"),
      ],
      activeEditorTab: browserTab("browser-1", "http://localhost:8000/"),
    });
    expect(store.get(workspacesAtom)["ws-test"]?.uiState).not.toHaveProperty("devBrowserTargetUrl");
  });

  it("stays idle for browser tabs with no url until user opens one", async () => {
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    expect(screen.queryByTitle("Browser")).not.toBeInTheDocument();

    await submitLocalUrl("localhost:8003");

    await screen.findByLabelText("Viewport preview");
    expect(getBrowserFrame()).toHaveAttribute("src", "http://localhost:8003/");
  });

  it("rejects non-local manual URLs", async () => {
    const activeTab = browserTab("browser-1", null);
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await submitLocalUrl("https://example.com/app");

    expect(await screen.findByText("Could not open local preview")).toBeVisible();
    expect(screen.queryByTitle("Browser")).not.toBeInTheDocument();
    expect(store.get(currentDevBrowserUrlAtomFamily("ws-test"))).toBeNull();
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(activeTab);
  });

  it("uses fill mode for desktop sessions and hides device-only controls", async () => {
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    const viewport = await screen.findByLabelText("Viewport preview");
    const frame = getBrowserFrame();

    expect(screen.queryByLabelText("Viewport width")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Viewport height")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Rotate" })).not.toBeInTheDocument();
    expect(viewport).not.toHaveClass("dev-browser-frame-viewport--device");
    expect(viewport).not.toHaveAttribute("style");
    expect(frame).not.toHaveAttribute("style");
  });

  it("applies a non-custom mobile preset without reopening through a proxy", async () => {
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");

    await selectDevicePreset(user, "iPhone 14");

    await waitFor(() =>
      expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
        browserTab("browser-1", "http://127.0.0.1:5173/", {
          devicePreset: "iphone-14",
          viewportWidth: 390,
          viewportHeight: 844,
          orientation: "portrait",
          userAgentMode: "desktop",
        })
      )
    );
    expect(getBrowserFrame()).toHaveAttribute("src", "http://127.0.0.1:5173/");
  });

  it("returns to desktop fill mode immediately when selecting desktop", async () => {
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "pixel-7",
      viewportWidth: 412,
      viewportHeight: 915,
      orientation: "portrait",
      userAgentMode: "desktop",
    });
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");

    await selectDevicePreset(user, "Desktop");

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
    expect(frame).toHaveAttribute("src", "http://127.0.0.1:5173/");
  });

  it("applies rotation immediately for fixed device presets", async () => {
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

    await waitFor(() =>
      expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
        browserTab("browser-1", "http://127.0.0.1:5173/", {
          devicePreset: "iphone-14",
          viewportWidth: 844,
          viewportHeight: 390,
          orientation: "landscape",
          userAgentMode: "desktop",
        })
      )
    );
  });

  it("renders device sessions inside a fixed logical viewport", async () => {
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "pixel-7",
      viewportWidth: 412,
      viewportHeight: 915,
      orientation: "portrait",
      userAgentMode: "desktop",
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
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "iphone-14",
      viewportWidth: 390,
      viewportHeight: 844,
      orientation: "portrait",
      userAgentMode: "desktop",
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
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/", {
      devicePreset: "pixel-7",
      viewportWidth: 412,
      viewportHeight: 915,
      orientation: "portrait",
      userAgentMode: "desktop",
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

    expect(screen.getByLabelText("Viewport preview")).toHaveStyle({
      width: "412px",
      height: "915px",
    });

    fireEvent.keyDown(screen.getByLabelText("Local URL"), {
      key: "Enter",
      code: "Enter",
      charCode: 13,
    });

    await waitFor(() =>
      expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(
        browserTab("browser-1", "http://127.0.0.1:5173/", {
          devicePreset: "custom",
          viewportWidth: 500,
          viewportHeight: 700,
          orientation: "portrait",
          userAgentMode: "desktop",
        })
      )
    );
    expect(screen.getByLabelText("Viewport preview")).toHaveStyle({
      width: "500px",
      height: "700px",
    });
  });

  it("blocks open and shows an error when custom viewport dimensions are invalid", async () => {
    const user = userEvent.setup();
    const activeTab = browserTab("browser-1", "http://127.0.0.1:5173/");
    const store = createWorkspaceStore([activeTab], activeTab);

    render(<DevBrowserSurface workspaceId="ws-test" browserTab={activeTab} />, {
      wrapper: wrapperFor(store),
    });

    await screen.findByLabelText("Viewport preview");

    await selectDevicePreset(user, "Custom");
    fireEvent.change(screen.getByLabelText("Viewport width"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("Viewport height"), {
      target: { value: "99999" },
    });
    await submitLocalUrl("http://127.0.0.1:5173/");

    expect(await screen.findByText("Enter a width and height between 1 and 4096.")).toBeVisible();
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual(activeTab);
  });
});

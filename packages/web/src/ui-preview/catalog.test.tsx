import { fireEvent, render, screen } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getUiPreviewScene, UI_PREVIEW_SCENES } from "./catalog";
import { buildUiPreviewStore } from "./preview-store";

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";

function installMatchMedia(device: "desktop" | "mobile") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: query === VIEWPORT_QUERY ? device === "mobile" : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => true,
    }),
  });
}

function renderScene(sceneId: string, device: "desktop" | "mobile" = "desktop") {
  const scene = getUiPreviewScene(sceneId);
  if (!scene) {
    throw new Error(`Missing scene ${sceneId}`);
  }

  installMatchMedia(device);
  const context = { theme: "dark" as const, locale: "en" as const, device };
  const store = buildUiPreviewStore(scene.seed(context));
  const router = scene.router(context);

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={router.initialEntries}>
        <Routes>
          <Route path={router.path} element={scene.render(context)} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe("UI preview catalog", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.localStorage.clear();
    installMatchMedia("desktop");
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("registers unique first-batch page scene ids", () => {
    const ids = UI_PREVIEW_SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "welcome",
        "settings-general",
        "settings-appearance",
        "settings-providers",
        "settings-shortcuts",
        "settings-mobile-root",
        "app-loading-shell",
        "workspace-load-error",
        "workspace-desktop",
        "workspace-mobile",
        "auth-preview",
        "not-found",
      ])
    );
  });

  it("marks settings section scenes for capture-time navigation", () => {
    const scene = getUiPreviewScene("settings-appearance");
    expect(
      scene?.router({ theme: "dark", locale: "en", device: "desktop" }).initialEntries
    ).toEqual(["/settings"]);
    expect(scene?.capture?.settingsSection).toBe("appearance");
  });

  it("marks the shortcuts settings scene for capture-time navigation", () => {
    const scene = getUiPreviewScene("settings-shortcuts");
    expect(scene?.capture?.settingsSection).toBe("shortcuts");
  });

  it("limits the mobile settings root scene to mobile variants only", () => {
    const scene = getUiPreviewScene("settings-mobile-root");
    expect(scene?.devices).toEqual(["mobile"]);
  });

  it("renders the mobile workspace scene through /workspace without booting app providers", async () => {
    renderScene("workspace-mobile", "mobile");

    expect(await screen.findByTestId("mobile-shell")).toBeInTheDocument();
    expect(screen.getByTestId("mobile-bottom-stack")).toBeInTheDocument();
  });

  it("registers the first showcase scene ids", () => {
    const ids = UI_PREVIEW_SCENES.map((scene) => scene.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        "workspace-launch-modal",
        "command-palette",
        "branch-quick-pick",
        "toast-stack",
        "mobile-workspace-drawer",
        "mobile-files-sheet",
        "mobile-terminal-sheet",
        "mobile-supervisor-sheet",
        "supervisor-dialog",
        "confirm-dialog-danger",
        "provider-error-state",
        "loading-state",
        "file-tree-delete-confirm",
      ])
    );
  });

  it("renders the command palette showcase as open by default", async () => {
    renderScene("command-palette");

    expect(await screen.findByRole("textbox")).toBeInTheDocument();
    expect(document.querySelector(".command-palette, .command-palette-sheet")).toBeTruthy();
  });

  it("renders the workspace launch modal with the seeded directory list", async () => {
    renderScene("workspace-launch-modal");

    expect(await screen.findByText("coder-studio")).toBeInTheDocument();
    expect(document.querySelector(".launch-modal, .mobile-sheet--launch")).toBeTruthy();
  });

  it("renders the shortcuts settings scene with the shortcuts list", async () => {
    renderScene("settings-shortcuts");

    fireEvent.click(await screen.findByRole("button", { name: /keyboard shortcuts/i }));
    expect(await screen.findByLabelText(/keyboard shortcuts/i)).toBeInTheDocument();
    expect(document.querySelector(".shortcuts-list")).toBeTruthy();
  });

  it("renders the mobile settings root scene as the section list", async () => {
    renderScene("settings-mobile-root", "mobile");

    expect(await screen.findByText("Settings")).toBeInTheDocument();
    expect(document.querySelector(".settings-mobile-list")).toBeTruthy();
  });

  it("renders the app loading shell scene without bootstrapping routes", async () => {
    renderScene("app-loading-shell");

    expect(await screen.findByText(/coder studio/i)).toBeInTheDocument();
    expect(document.querySelector(".app-loading-shell")).toBeTruthy();
  });

  it("renders the workspace route error scene through the shared error shell", async () => {
    renderScene("workspace-load-error");

    expect(await screen.findByText(/preview workspace load failure/i)).toBeInTheDocument();
    expect(document.querySelector(".workspace-resolving-card")).toBeTruthy();
  });

  it("renders the file-tree delete confirm scene with the shared danger dialog", async () => {
    renderScene("file-tree-delete-confirm");

    expect(await screen.findByText(/delete preview-file.ts/i)).toBeInTheDocument();
    expect(document.querySelector(".modal-card")).toBeTruthy();
  });
});

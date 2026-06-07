import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { Provider } from "jotai";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { terminalOutputAtomFamily } from "../features/terminal-panel/atoms";
import { getThemeById } from "../theme";
import { getUiPreviewScene, UI_PREVIEW_SCENES } from "./catalog";
import { buildUiPreviewStore } from "./preview-store";
import type { UiPreviewSceneTheme } from "./scene-metadata";

vi.mock("../features/code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: () => <div data-testid="code-editor-host" />,
  CodeEditorDesktopHeaderActions: () => (
    <div data-testid="editor-toolbar-mock" role="toolbar" aria-label="Editor actions">
      <button type="button" aria-label="Diff">
        Diff
      </button>
      <button type="button" aria-label="Edit">
        Edit
      </button>
    </div>
  ),
}));

vi.mock("../features/code-editor/components/monaco-host", () => ({
  MonacoHost: ({ content, readOnly }: { content?: string; readOnly?: boolean }) => (
    <div data-testid="monaco-host" data-read-only={String(Boolean(readOnly))}>
      {content ?? ""}
    </div>
  ),
}));

vi.mock("../features/code-editor/components/monaco-diff-host", () => ({
  MonacoDiffHost: ({
    filePath,
    originalContent,
    modifiedContent,
  }: {
    filePath?: string;
    originalContent: string;
    modifiedContent: string;
  }) => (
    <div data-testid="monaco-diff-host" data-file-path={filePath ?? ""}>
      <pre>{originalContent}</pre>
      <pre>{modifiedContent}</pre>
    </div>
  ),
}));

const VIEWPORT_QUERY = "(max-width: 899px), (pointer: coarse)";
const originalClipboard = navigator.clipboard;
const originalClipboardItem = globalThis.ClipboardItem;
const originalGetContext = HTMLCanvasElement.prototype.getContext;

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

function renderScene(
  sceneId: string,
  device: "desktop" | "mobile" = "desktop",
  theme: UiPreviewSceneTheme = "mint-dark"
) {
  const scene = getUiPreviewScene(sceneId);
  if (!scene) {
    throw new Error(`Missing scene ${sceneId}`);
  }

  installMatchMedia(device);
  const context = { theme, locale: "en" as const, device };
  const store = buildUiPreviewStore(scene.seed(context));
  const router = scene.router(context);

  document.documentElement.setAttribute("data-theme", getThemeById(theme).documentThemeAttr);
  document.documentElement.setAttribute("lang", "en");
  document.body.dataset.uiPreviewDevice = device;

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

  beforeAll(() => {
    installMatchMedia("desktop");
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: vi.fn(() => ({})),
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: {
        write: vi.fn().mockResolvedValue(undefined),
        writeText: vi.fn().mockResolvedValue(undefined),
        readText: vi.fn().mockResolvedValue(""),
      },
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      writable: true,
      value: class ClipboardItemMock {
        constructor(public readonly items: Record<string, Blob | Promise<Blob>>) {}
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      configurable: true,
      value: originalGetContext,
    });
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: originalClipboard,
    });
    Object.defineProperty(globalThis, "ClipboardItem", {
      configurable: true,
      writable: true,
      value: originalClipboardItem,
    });
  });

  beforeEach(() => {
    window.localStorage.clear();
    installMatchMedia("desktop");
  });

  afterEach(() => {
    if (originalMatchMedia) {
      window.matchMedia = originalMatchMedia;
    } else {
      installMatchMedia("desktop");
    }
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("lang");
    delete document.body.dataset.uiPreviewDevice;
  });

  it("registers unique first-batch page scene ids", () => {
    const ids = UI_PREVIEW_SCENES.map((scene) => scene.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(
      expect.arrayContaining([
        "welcome",
        "settings-general",
        "settings-appearance",
        "settings-monitoring",
        "settings-providers",
        "settings-shortcuts",
        "settings-mobile-root",
        "app-loading-shell",
        "workspace-load-error",
        "workspace-desktop",
        "workspace-mobile",
        "workspace-draft-pane-editor-review",
        "auth-preview",
        "session-gate",
        "not-found",
      ])
    );
  });

  it("marks settings section scenes for capture-time navigation", () => {
    const scene = getUiPreviewScene("settings-appearance");
    expect(
      scene?.router({ theme: "mint-dark", locale: "en", device: "desktop" }).initialEntries
    ).toEqual(["/settings"]);
    expect(scene?.capture?.settingsSection).toBe("appearance");
  });

  it("marks the shortcuts settings scene for capture-time navigation", () => {
    const scene = getUiPreviewScene("settings-shortcuts");
    expect(scene?.capture?.settingsSection).toBe("shortcuts");
  });

  it("deep-links the monitoring settings scene directly into the monitoring section", () => {
    const scene = getUiPreviewScene("settings-monitoring");
    expect(
      scene?.router({ theme: "mint-dark", locale: "en", device: "desktop" }).initialEntries
    ).toEqual(["/settings?section=monitoring"]);
    expect(scene?.capture?.selector).toBe(".settings-monitoring-shell");
  });

  it("seeds the monitoring review scene with attribution, detail, and subprocess content", () => {
    const scene = getUiPreviewScene("settings-monitoring");
    const seed = scene?.seed({ theme: "mint-light", locale: "en", device: "desktop" });
    const monitoringResponse = seed?.commands?.monitoringGet;

    expect(monitoringResponse?.snapshot.workspaces.length).toBeGreaterThan(0);
    expect(monitoringResponse?.snapshot.sessions.length).toBeGreaterThan(0);
    expect(monitoringResponse?.snapshot.subprocessGroups.length).toBeGreaterThan(0);
    expect(Object.keys(monitoringResponse?.history.workspaces ?? {})).not.toHaveLength(0);
    expect(Object.keys(monitoringResponse?.history.sessions ?? {})).not.toHaveLength(0);
    expect(Object.keys(monitoringResponse?.history.subprocessGroups ?? {})).not.toHaveLength(0);
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
        "readme-desktop-hero",
        "readme-desktop-review",
        "readme-mobile-progress",
        "workspace-launch-modal",
        "command-palette",
        "branch-quick-pick",
        "footer-update-rail-review",
        "footer-update-rail-confirm-review",
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

  it("renders the workspace launch modal with seeded history and directory data", async () => {
    renderScene("workspace-launch-modal");

    expect(await screen.findByText("Recent Workspaces")).toBeInTheDocument();
    expect(
      await screen.findByRole("button", { name: "Open recent workspace coder-studio" })
    ).toBeInTheDocument();
    expect(screen.getByText("/home/spencer/workspace/coder-studio")).toBeInTheDocument();
    expect(document.querySelector(".launch-modal, .mobile-sheet--launch")).toBeTruthy();
  });

  it("renders the mobile terminal showcase without the replay loading overlay", async () => {
    renderScene("mobile-terminal-sheet", "mobile");

    expect(await screen.findByRole("button", { name: "New Terminal" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Close Terminal" })).toBeInTheDocument();
    await waitFor(() => {
      expect(
        document.querySelector(".mobile-sheet--terminal .terminal-toolbar-mobile-row")
      ).toBeTruthy();
      expect(screen.queryByText("Restoring terminal output...")).not.toBeInTheDocument();
    });
    expect(document.querySelector(".mobile-sheet--terminal")).toBeTruthy();
    expect(
      document.querySelector(".mobile-sheet--terminal .terminal-toolbar-mobile-row")
    ).toBeTruthy();
    expect(
      document.querySelector(
        '.mobile-sheet--terminal .page-header__actions [aria-label="New Terminal"]'
      )
    ).toBeNull();
    expect(
      document.querySelector(
        '.mobile-sheet--terminal .terminal-toolbar [aria-label="New Terminal"]'
      )
    ).toBeTruthy();
    expect(document.querySelector(".mobile-sheet--terminal .workspace-status-bar")).toBeTruthy();
    expect(document.querySelector(".mobile-sheet--terminal .terminal-toolbar-left")).toBeNull();
  });

  it("renders seeded content search results inside the mobile files sheet search tab", async () => {
    renderScene("mobile-files-sheet", "mobile");

    fireEvent.click(await screen.findByRole("tab", { name: /Search|搜索/i }));
    fireEvent.change(await screen.findByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "search" },
    });

    expect(await screen.findByText("mobile-files-sheet.tsx")).toBeInTheDocument();
    expect(screen.getByText("packages/web/src/styles/components.css")).toBeInTheDocument();
  });

  it("captures the mobile terminal showcase from the fullscreen terminal sheet root", () => {
    const scene = getUiPreviewScene("mobile-terminal-sheet");
    expect(scene?.capture?.selector).toBe(".mobile-sheet--terminal");
    expect(scene?.devices).toEqual(["mobile"]);
  });

  it("keeps mobile terminal showcase history in replay state instead of preloading live output", () => {
    const scene = getUiPreviewScene("mobile-terminal-sheet");
    if (!scene) {
      throw new Error("Missing mobile-terminal-sheet scene");
    }

    const store = buildUiPreviewStore(
      scene.seed({
        theme: "mint-dark",
        locale: "en",
        device: "mobile",
      })
    );

    expect(store.get(terminalOutputAtomFamily("term-preview-1"))).toEqual({
      chunks: [],
      lastSeq: 0,
    });
  });

  it("renders the shortcuts settings scene with the shortcuts list", async () => {
    renderScene("settings-shortcuts");

    fireEvent.click(await screen.findByRole("button", { name: /keyboard shortcuts/i }));
    expect(await screen.findByLabelText(/keyboard shortcuts/i)).toBeInTheDocument();
    expect(document.querySelector(".shortcuts-list")).toBeTruthy();
  });

  it("renders the mobile settings root scene as the section list", async () => {
    renderScene("settings-mobile-root", "mobile");

    expect(await screen.findByRole("button", { name: /general/i })).toBeInTheDocument();
    expect(document.querySelector(".settings-mobile-root")).toBeTruthy();
    expect(document.querySelector(".settings-mobile-group")).toBeTruthy();
    expect(document.querySelector(".settings-mobile-group__list")).toBeTruthy();
    expect(document.querySelector(".settings-mobile-root-hero")).toBeNull();
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

  it("renders the session gate scene through the shared auth shell", async () => {
    renderScene("session-gate");

    expect(await screen.findByRole("button", { name: /re-enter|重新进入/i })).toBeInTheDocument();
    expect(document.querySelector(".auth-card-shell")).toBeTruthy();
  });

  it("renders the file-tree delete confirm scene with the shared danger dialog", async () => {
    renderScene("file-tree-delete-confirm");

    expect(await screen.findByText(/delete preview-file.ts/i)).toBeInTheDocument();
    expect(document.querySelector(".modal-card")).toBeTruthy();
  });

  it("renders the workspace icon review scene with file tree and git status content", async () => {
    renderScene("workspace-icon-review");

    expect(await screen.findByText("packages")).toBeInTheDocument();
    expect(document.querySelector(".file-tree-shell")).toBeTruthy();
    expect(document.querySelector(".git-panel, .git-row")).toBeTruthy();
    expect(document.querySelector(".bottom-terminal-empty")).toBeTruthy();
  });

  it("renders the toast icon review scene with four status tones", async () => {
    renderScene("toast-icon-review");

    expect(await screen.findByText("Workspace opened")).toBeInTheDocument();
    expect(document.querySelectorAll(".toast").length).toBeGreaterThanOrEqual(4);
  });

  it("renders the workspace topbar review scene", async () => {
    renderScene("workspace-topbar-review");

    expect(await screen.findByRole("tablist", { name: "Workspace tabs" })).toBeInTheDocument();
    expect(document.querySelector(".desktop-review-card--topbar .app-topbar")).toBeTruthy();
  });

  it("renders the workspace sidebar files review scene", async () => {
    renderScene("workspace-sidebar-files-review");

    expect(await screen.findByText("packages")).toBeInTheDocument();
    expect(document.querySelector(".desktop-review-card--sidebar .file-tree-shell")).toBeTruthy();
  });

  it("renders the workspace sidebar git review scene", async () => {
    renderScene("workspace-sidebar-git-review");

    expect(await screen.findByText(/changes|更改/i)).toBeInTheDocument();
    expect(document.querySelector(".desktop-review-card--sidebar .git-panel")).toBeTruthy();
  });

  it("renders seeded content search results in the workspace desktop scene", async () => {
    renderScene("workspace-desktop");

    expect(
      await screen.findByRole("navigation", { name: /Workspace activity bar|工作区活动栏/i })
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Search|搜索/i }));
    fireEvent.change(await screen.findByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    expect(await screen.findByText("app.tsx")).toBeInTheDocument();
    expect(screen.getByText("packages/web/src/app.tsx")).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: /app\.tsx.*packages\/web\/src\/app\.tsx.*4.*(?:matches|匹配)/i,
      })
    ).toBeInTheDocument();
    expect(document.querySelector(".workspace-search-panel__group-count")).toHaveTextContent("4");
  });

  it("renders the draft-pane editor review scene with a split draft layout", async () => {
    renderScene("workspace-draft-pane-editor-review");

    expect(
      await screen.findByRole("navigation", { name: /Workspace activity bar|工作区活动栏/i })
    ).toBeInTheDocument();
    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(document.querySelectorAll(".agent-pane-leaf")).toHaveLength(2);
    expect(screen.getAllByText("Draft")).toHaveLength(2);
  });

  it("renders the editor-pane review scene with pane-local editor toolbar chrome", async () => {
    renderScene("workspace-editor-pane-review");

    expect(
      await screen.findByRole("navigation", { name: /Workspace activity bar|工作区活动栏/i })
    ).toBeInTheDocument();
    expect(await screen.findByTestId("editor-pane-left")).toBeInTheDocument();
    expect(screen.getAllByText("packages/web/src/app.tsx").length).toBeGreaterThan(0);
    const toolbar = screen.getByRole("toolbar", { name: "Editor actions" });
    expect(toolbar).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /Diff|差异/i })).toBeInTheDocument();
    expect(within(toolbar).getByRole("button", { name: /Edit|编辑/i })).toBeInTheDocument();
    expect(screen.getAllByText("Draft")).toHaveLength(1);
  });

  it("renders the workspace editor review scene", async () => {
    renderScene("workspace-editor-review");

    expect(
      await screen.findByText("packages/web/src/features/settings/components/settings-page.tsx")
    ).toBeInTheDocument();
    expect(
      document.querySelector(".desktop-review-card--editor .workspace-git-editor")
    ).toBeTruthy();
    expect(screen.getByText("const headerTitle = isMobile")).toBeInTheDocument();
  });

  it("renders the workspace diff review scene", async () => {
    renderScene("workspace-diff-review");

    expect(await screen.findByText("packages/web/src/styles/components.css")).toBeInTheDocument();
    expect(document.querySelector(".desktop-review-card--diff .workspace-git-editor")).toBeTruthy();
    expect(screen.getByText(/\+\s+background: var\(--bg-elevated\);/)).toBeInTheDocument();
  });

  it("renders the README desktop hero scene with a live session and shell terminal", async () => {
    renderScene("readme-desktop-hero");

    expect(
      await screen.findByText("Ship the header polish and verify README visuals")
    ).toBeInTheDocument();
    expect(screen.getByText("Supervisor")).toBeInTheDocument();
    expect(screen.getByText("Preview Runner")).toBeInTheDocument();
    expect(document.querySelector(".workspace-page--desktop .session-card")).toBeTruthy();
    expect(document.querySelector(".workspace-page--desktop .bottom-terminal")).toBeTruthy();
  });

  it("renders the README desktop review scene with git and diff context", async () => {
    renderScene("readme-desktop-review");

    expect(await screen.findByText("README capture polish")).toBeInTheDocument();
    expect(screen.getByText(/Refine the desktop topbar hierarchy/)).toBeInTheDocument();
    expect(document.querySelector(".workspace-page--desktop .git-panel")).toBeTruthy();
    expect(document.querySelector(".workspace-page--desktop .workspace-git-editor")).toBeTruthy();
  });

  it("renders the README mobile progress scene with session continuity and supervisor state", async () => {
    renderScene("readme-mobile-progress", "mobile");

    expect(await screen.findByText("Resume mobile progress review")).toBeInTheDocument();
    expect(screen.getAllByText("Supervisor").length).toBeGreaterThan(0);
    expect(document.querySelector(".mobile-shell .session-card")).toBeTruthy();
    expect(document.querySelector(".mobile-shell .workspace-status-bar")).toBeTruthy();
  });

  it("renders the footer update rail review scene with a desktop update prompt", async () => {
    renderScene("footer-update-rail-review");

    expect(await screen.findByText("New version detected v0.5.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update now/i })).toBeInTheDocument();
    expect(document.querySelector(".footer-update-rail-review .workspace-status-bar")).toBeTruthy();
  });

  it("renders the footer update rail review scene on mobile with the same update prompt", async () => {
    renderScene("footer-update-rail-review", "mobile");

    expect(await screen.findByText("New version detected v0.5.0")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /update now/i })).toBeInTheDocument();
    expect(document.querySelector(".footer-update-rail-review.mobile-shell")).toBeTruthy();
    expect(
      document.querySelector(
        ".mobile-shell__bottom-stack .workspace-status-bar__right .footer-update-rail"
      )
    ).toBeTruthy();
  });

  it("renders the footer update confirm review scene with the post-click confirmation dialog", async () => {
    renderScene("footer-update-rail-confirm-review");

    const dialog = await screen.findByRole("dialog", { name: /confirm update/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /update now/i })).toBeInTheDocument();
    expect(screen.getByText(/1 terminals, 2 sessions, and 3 supervisor tasks/)).toBeInTheDocument();
  });

  it("renders the footer update confirm review scene on mobile with the post-click confirmation dialog", async () => {
    renderScene("footer-update-rail-confirm-review", "mobile");

    const dialog = await screen.findByRole("dialog", { name: /confirm update/i });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: /update now/i })).toBeInTheDocument();
    expect(screen.getByText(/1 terminals, 2 sessions, and 3 supervisor tasks/)).toBeInTheDocument();
  });

  it("renders the workspace terminal empty review scene", async () => {
    renderScene("workspace-terminal-empty-review");

    expect(await screen.findByText(/no terminal|暂无终端/i)).toBeInTheDocument();
    expect(
      document.querySelector(".desktop-review-card--terminal .bottom-terminal-empty")
    ).toBeTruthy();
  });

  it("renders the settings density review scene", async () => {
    renderScene("settings-density-review");

    expect(await screen.findByRole("heading", { name: /settings|设置/i })).toBeInTheDocument();
    expect(document.querySelector(".settings-header .page-header")).toBeTruthy();
    expect(document.querySelector(".settings-sidebar")).toBeTruthy();
  });

  it("renders the settings light theme review scene", async () => {
    renderScene("settings-light-theme-review", "desktop", "mint-light");

    expect(await screen.findByRole("heading", { name: /settings|设置/i })).toBeInTheDocument();
    expect(document.querySelector(".settings-page")).toBeTruthy();
    expect(document.querySelector(".settings-nav-item")).toBeTruthy();
    expect(document.documentElement).toHaveAttribute("data-theme", "mint-light");
  });

  it("renders the desktop overlay review scene", async () => {
    renderScene("desktop-overlay-review");

    expect(await screen.findByRole("dialog", { name: "Start Workspace" })).toBeInTheDocument();
    expect(document.querySelector(".desktop-review-grid")).toBeTruthy();
    expect(document.body.querySelector(".workbench-layer-backdrop")).toBeTruthy();
    expect(document.body.querySelector(".command-palette")).toBeTruthy();
    expect(document.body.querySelector(".launch-modal")).toBeTruthy();
    expect(
      document.querySelector(".desktop-review-card .desktop-review-embedded-worktree")
    ).toBeTruthy();

    const embeddedSurface = document.querySelector(
      ".desktop-review-card--worktree .worktree-manager-surface"
    );

    expect(embeddedSurface).toBeTruthy();
    expect(embeddedSurface?.closest(".desktop-review-card--worktree")).toBeTruthy();
    expect(document.querySelector(".desktop-review-card--worktree .modal-overlay")).toBeNull();
  });

  it("renders the desktop statusbar review scene", async () => {
    renderScene("desktop-statusbar-review");

    expect(await screen.findByText("main")).toBeInTheDocument();
    expect(
      document.querySelector(".desktop-review-card--statusbar .workspace-status-bar")
    ).toBeTruthy();
  });
});

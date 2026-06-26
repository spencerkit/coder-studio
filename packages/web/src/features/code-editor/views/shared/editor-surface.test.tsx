import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { atom } from "jotai";
import { describe, expect, it, vi } from "vitest";
import type { PendingEditorNavigation } from "../../atoms";
import { type CodeEditorState } from "./code-editor-host";
import { EditorSurface } from "./editor-surface";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) => {
    const dictionary: Record<string, string> = {
      "code_editor.mode_preview": "预览",
      "code_editor.mode_edit": "编辑",
      "code_editor.mode_diff": "Diff",
      "code_editor.diff_saved_only": "Diff preview is based on saved file contents.",
      "code_editor.close_unsaved_title": "Discard unsaved changes?",
      "code_editor.close_unsaved_description": "app.ts has unsaved changes.",
      "code_editor.discard_and_close": "Discard and Close",
      "code_editor.minimize_editor": "Minimize editor",
      "code_editor.pin_editor_view": "Pin editor view",
      "code_editor.unpin_editor_view": "Unpin editor view",
      "code_editor.close_editor_view": "Close editor view",
      "code_editor.close_editor_tab": `Close file ${params?.name ?? "editor tab"}`,
      "code_editor.open_browser_tab": "Open Browser tab",
      "code_editor.close_browser_tab": "Close Browser tab",
      "code_editor.open_editor_tabs": "Open editor tabs",
      "code_editor.current_file_path": "Current file path",
      "code_editor.modified_unsaved_changes": "modified · Unsaved changes",
      "code_editor.toolbar_actions": "Editor actions",
      "action.close": "Close",
      "action.save_file": "Save File",
      "common.cancel": "Cancel",
      "dev_browser.title": "Browser",
    };
    return dictionary[key] ?? key;
  },
}));

vi.mock("../../components/monaco-host", () => ({
  MonacoHost: ({
    readOnly,
    standalone,
    workspaceRootPath,
  }: {
    readOnly?: boolean;
    standalone?: boolean;
    workspaceRootPath?: string;
  }) => (
    <div
      data-testid="monaco-host"
      data-read-only={String(Boolean(readOnly))}
      data-standalone={String(Boolean(standalone))}
      data-workspace-root-path={workspaceRootPath ?? ""}
    />
  ),
}));

vi.mock("../../components/monaco-diff-host", () => ({
  MonacoDiffHost: ({
    originalContent,
    modifiedContent,
  }: {
    originalContent: string;
    modifiedContent: string;
  }) => (
    <div
      data-testid="monaco-diff-host"
      data-original={originalContent}
      data-modified={modifiedContent}
    />
  ),
}));

vi.mock("../../components/commit-file-list-preview", () => ({
  CommitFileListPreview: ({
    preview,
    onOpenFile,
  }: {
    preview: { files: Array<{ path: string }> };
    onOpenFile: (file: { path: string }) => void;
  }) => (
    <button
      type="button"
      data-testid="commit-file-list-preview"
      onClick={() => {
        const firstFile = preview.files[0];
        if (firstFile) {
          onOpenFile(firstFile);
        }
      }}
    >
      {preview.files[0]?.path ?? "no-files"}
    </button>
  ),
}));

vi.mock("../../components/image-preview", () => ({
  ImagePreview: () => <div data-testid="image-preview" />,
}));

vi.mock("../../components/image-diff-preview", () => ({
  ImageDiffPreview: ({
    path,
    mime,
    status,
    beforeUrl,
    afterUrl,
  }: {
    path: string;
    mime: string;
    status: "modified" | "added" | "deleted";
    beforeUrl?: string;
    afterUrl?: string;
  }) => (
    <div
      data-testid="image-diff-preview"
      data-path={path}
      data-mime={mime}
      data-status={status}
      data-before-url={beforeUrl ?? ""}
      data-after-url={afterUrl ?? ""}
    />
  ),
}));

vi.mock("../../components/document-preview", () => ({
  DocumentPreview: ({ allowScripts, src }: { allowScripts: boolean; src: string | null }) => (
    <div
      data-testid="document-preview"
      data-allow-scripts={String(allowScripts)}
      data-src={src ?? ""}
    />
  ),
}));

vi.mock("../../../dev-browser/dev-browser-surface", () => ({
  DevBrowserSurface: ({ workspaceId }: { workspaceId?: string }) => (
    <div data-testid="dev-browser-surface" data-workspace-id={workspaceId ?? ""} />
  ),
}));

vi.mock("./canvas-surface", () => ({
  CanvasSurface: ({
    workspaceId,
    tab,
  }: {
    workspaceId: string;
    tab: { canvasId: string; title: string };
  }) => (
    <div
      data-testid="canvas-surface"
      data-workspace-id={workspaceId}
      data-canvas-id={tab.canvasId}
      data-title={tab.title}
    />
  ),
}));

function createState(overrides: Partial<CodeEditorState> = {}): CodeEditorState {
  return {
    activeFilePath: "src/app.ts",
    activeDiffChange: null,
    activeExternalStatus: null,
    activeLoadError: null,
    activeEditorTab: { kind: "file", path: "src/app.ts" },
    activateOpenFile: vi.fn(),
    activateEditorTab: vi.fn(),
    closeEditorTab: vi.fn(),
    closeOpenFilePath: vi.fn(),
    canSave: true,
    canDiff: true,
    canEdit: true,
    canPreview: true,
    currentFile: {
      kind: "text",
      path: "src/app.ts",
      content: "export const app = 2;\n",
      savedContent: "export const app = 2;\n",
      baseHash: "hash-1",
      isDirty: false,
    },
    handleClose: vi.fn(),
    hideEditorView: vi.fn(),
    handleContentChange: vi.fn(),
    handleSave: vi.fn(),
    hasUnsavedChangesOutsideDiff: false,
    isImageFile: false,
    isSaving: false,
    isSvgTextBacked: false,
    isTextFile: true,
    documentPreview: {
      iframeSrc: null,
      allowScripts: false,
      isBootstrapping: false,
      isSyncing: false,
      error: null,
      retry: vi.fn(),
    },
    mode: "edit",
    openBrowserTab: vi.fn(),
    openCommitFileDiff: vi.fn(),
    openEditorTabs: [{ kind: "file", path: "src/app.ts" }],
    openEditorPaths: ["src/app.ts"],
    openFiles: {
      "src/app.ts": {
        kind: "text",
        path: "src/app.ts",
        content: "export const app = 2;\n",
        savedContent: "export const app = 2;\n",
        baseHash: "hash-1",
        isDirty: false,
      },
    },
    openInDiffMode: vi.fn(),
    pendingNavigationAtom: atom<PendingEditorNavigation | null>(null),
    saveError: null,
    setMode: vi.fn(),
    toggleSvgTextMode: vi.fn(),
    workspace: {
      id: "ws-1",
      name: "Workspace",
      path: "/tmp/ws-1",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
    workspaceId: "ws-1",
    ...overrides,
  };
}

describe("EditorSurface", () => {
  it("renders icon-only 预览, 编辑, and Diff actions in one persistent header for text files", () => {
    const state = createState();

    render(<EditorSurface state={state} />);

    expect(screen.getByRole("button", { name: "预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.queryByText("预览")).not.toBeInTheDocument();
    expect(screen.queryByText("编辑")).not.toBeInTheDocument();
  });

  it("hides Diff when the active file has no git changes", () => {
    const state = createState({ canDiff: false });

    render(<EditorSurface state={state} />);

    expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
  });

  it("renders Monaco in read-only mode for preview and editable mode for edit", () => {
    const state = createState({ mode: "preview" });
    const { rerender } = render(<EditorSurface state={state} />);

    expect(screen.getByTestId("monaco-host")).toHaveAttribute("data-read-only", "true");

    rerender(<EditorSurface state={createState({ mode: "edit" })} />);

    expect(screen.getByTestId("monaco-host")).toHaveAttribute("data-read-only", "false");
  });

  it("preserves preview file tab styling from open editor tab metadata", () => {
    const state = createState({
      activeFilePath: "package.json",
      activeEditorTab: { kind: "file", path: "package.json", pinned: false },
      currentFile: {
        kind: "text",
        path: "package.json",
        content: "{}\n",
        savedContent: "{}\n",
        baseHash: "hash-package",
        isDirty: false,
      },
      openEditorPaths: [],
      openEditorTabs: [{ kind: "file", path: "package.json", pinned: false }],
      openFiles: {
        "package.json": {
          kind: "text",
          path: "package.json",
          content: "{}\n",
          savedContent: "{}\n",
          baseHash: "hash-package",
          isDirty: false,
        },
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByRole("tab", { name: /package\.json/ })).toHaveClass(
      "code-editor-tab--preview"
    );
  });

  it("renders skill text files in standalone Monaco mode without a workspace root", () => {
    const state = createState({
      activeFilePath: "skill:my-review-skill/SKILL.md",
      activeEditorTab: { kind: "file", path: "skill:my-review-skill/SKILL.md" },
      currentFile: {
        kind: "text",
        path: "skill:my-review-skill/SKILL.md",
        displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
        content: "# My Review Skill\n",
        savedContent: "# My Review Skill\n",
        baseHash: "skill-hash-1",
        isDirty: false,
      },
      openEditorTabs: [{ kind: "file", path: "skill:my-review-skill/SKILL.md" }],
      openEditorPaths: ["skill:my-review-skill/SKILL.md"],
      openFiles: {
        "skill:my-review-skill/SKILL.md": {
          kind: "text",
          path: "skill:my-review-skill/SKILL.md",
          displayPath: "/root/.agents/skills/my-review-skill/SKILL.md",
          content: "# My Review Skill\n",
          savedContent: "# My Review Skill\n",
          baseHash: "skill-hash-1",
          isDirty: false,
        },
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("monaco-host")).toHaveAttribute("data-standalone", "true");
    expect(screen.getByTestId("monaco-host")).toHaveAttribute("data-workspace-root-path", "");
  });

  it("renders document preview for markdown files in preview mode", () => {
    const state = createState({
      mode: "preview",
      currentFile: {
        kind: "text",
        path: "README.md",
        content: "# Docs",
        savedContent: "# Docs",
        baseHash: "hash-1",
        isDirty: false,
      },
      documentPreview: {
        iframeSrc: "/api/preview/session/session-1/README.md?rev=1",
        allowScripts: false,
        isBootstrapping: false,
        isSyncing: false,
        error: null,
        retry: vi.fn(),
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("document-preview")).toHaveAttribute(
      "data-src",
      "/api/preview/session/session-1/README.md?rev=1"
    );
    expect(screen.getByTestId("document-preview")).toHaveAttribute("data-allow-scripts", "false");
  });

  it("passes HTML preview script permission into the document preview frame", () => {
    const state = createState({
      mode: "preview",
      currentFile: {
        kind: "text",
        path: "docs/page.html",
        content: "<script src='./app.js'></script>",
        savedContent: "<script src='./app.js'></script>",
        baseHash: "hash-1",
        isDirty: false,
      },
      documentPreview: {
        iframeSrc: "/api/preview/session/session-1/docs/page.html?rev=1",
        allowScripts: true,
        isBootstrapping: false,
        isSyncing: false,
        error: null,
        retry: vi.fn(),
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("document-preview")).toHaveAttribute("data-allow-scripts", "true");
  });

  it("renders the canvas surface when the active editor tab is a canvas", () => {
    const state = createState({
      activeFilePath: null,
      activeEditorTab: {
        kind: "canvas",
        id: "canvas:canvas-1",
        canvasId: "canvas-1",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      },
      openEditorTabs: [
        {
          kind: "canvas",
          id: "canvas:canvas-1",
          canvasId: "canvas-1",
          title: "Runtime Flow",
          artifactType: "architecture_canvas",
          sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
        },
      ],
      openEditorPaths: [],
      currentFile: undefined,
      isTextFile: false,
      isImageFile: false,
      canPreview: false,
      canEdit: false,
      canDiff: false,
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("canvas-surface")).toHaveAttribute("data-workspace-id", "ws-1");
    expect(screen.getByTestId("canvas-surface")).toHaveAttribute("data-canvas-id", "canvas-1");
  });

  it("renders Monaco diff when diff kind is text", () => {
    const state = createState({
      mode: "diff",
      activeDiffChange: {
        kind: "worktree-file-diff",
        path: "src/app.ts",
        diff: "@@ -1 +1 @@\n-export const app = 1;\n+export const app = 2;\n",
        renderAs: "text",
        status: "modified",
        originalContent: "export const app = 1;\n",
        modifiedContent: "export const app = 2;\n",
        staged: false,
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute(
      "data-original",
      "export const app = 1;\n"
    );
    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute(
      "data-modified",
      "export const app = 2;\n"
    );
  });

  it("renders Monaco diff for search replace previews", () => {
    const state = createState({
      mode: "diff",
      activeDiffChange: {
        kind: "search-replace-file-diff",
        path: "src/app.ts",
        title: "src/app.ts",
        sessionId: "session-1",
        baseHash: "hash-1",
        originalContent: "before\n",
        modifiedContent: "after\n",
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute("data-original", "before\n");
    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute("data-modified", "after\n");
  });

  it("shows the saved-only warning while diff mode ignores unsaved local edits", () => {
    const state = createState({
      mode: "diff",
      hasUnsavedChangesOutsideDiff: true,
      activeDiffChange: {
        kind: "worktree-file-diff",
        path: "src/app.ts",
        diff: "@@ -1 +1 @@\n-export const app = 1;\n+export const app = 2;\n",
        renderAs: "text",
        status: "modified",
        originalContent: "export const app = 1;\n",
        modifiedContent: "export const app = 2;\n",
        staged: false,
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Diff preview is based on saved file contents."
    );
  });

  it("switches mode buttons through setMode and openInDiffMode", () => {
    const state = createState();

    render(<EditorSurface state={state} />);

    fireEvent.click(screen.getByRole("button", { name: "预览" }));
    expect(state.setMode).toHaveBeenCalledWith("preview");

    fireEvent.click(screen.getByRole("button", { name: "编辑" }));
    expect(state.setMode).toHaveBeenCalledWith("edit");

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(state.openInDiffMode).toHaveBeenCalledTimes(1);
  });

  it("renders desktop header actions in the fixed order without a save button", () => {
    const state = createState({ canSave: true });
    const onToggleEditorPinned = vi.fn();
    const { container } = render(
      <EditorSurface
        state={state}
        editorPinned={false}
        onToggleEditorPinned={onToggleEditorPinned}
      />
    );

    const pathActions = container.querySelector(".code-editor-path__actions");
    expect(pathActions).toBeTruthy();

    const pathButtonLabels = within(pathActions as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");

    expect(pathButtonLabels).toEqual(["Diff", "预览", "编辑"]);

    const tabbarActions = container.querySelector(".code-editor-tabbar__actions");
    expect(tabbarActions).toBeTruthy();
    const tabbarButtonLabels = within(tabbarActions as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? "");

    expect(tabbarButtonLabels).toEqual([
      "Open Browser tab",
      "Pin editor view",
      "Close editor view",
    ]);

    fireEvent.click(
      within(tabbarActions as HTMLElement).getByRole("button", { name: "Pin editor view" })
    );
    expect(onToggleEditorPinned).toHaveBeenCalledWith(true);
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
  });

  it("opens a browser editor tab from the editor header action", () => {
    const openBrowserTab = vi.fn();
    const state = createState({ openBrowserTab });

    render(<EditorSurface state={state} />);

    fireEvent.click(screen.getByRole("button", { name: "Open Browser tab" }));

    expect(openBrowserTab).toHaveBeenCalledTimes(1);
  });

  it("renders the dev browser surface when the browser editor tab is active", () => {
    const activateEditorTab = vi.fn();
    const closeEditorTab = vi.fn();
    const state = createState({
      activeEditorTab: { kind: "browser", id: "dev-browser", url: null },
      openEditorTabs: [
        { kind: "file", path: "src/app.ts" },
        { kind: "browser", id: "dev-browser", url: null },
      ],
      activateEditorTab,
      closeEditorTab,
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("dev-browser-surface")).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-host")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Current file path" })).not.toBeInTheDocument();

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    expect(within(tablist).getByRole("tab", { selected: true })).toHaveTextContent("Browser");

    fireEvent.click(within(tablist).getByRole("tab", { name: /app\.ts/ }));
    expect(activateEditorTab).toHaveBeenCalledWith({ kind: "file", path: "src/app.ts" });

    fireEvent.click(screen.getByRole("button", { name: "Close Browser tab" }));
    expect(closeEditorTab).toHaveBeenCalledWith({ kind: "browser", id: "dev-browser", url: null });
  });

  it("renders duplicate same-url browser tabs as separate tabs with the url label", () => {
    const activateEditorTab = vi.fn();
    const closeEditorTab = vi.fn();
    const state = createState({
      activeEditorTab: { kind: "browser", id: "browser-2", url: "localhost:8001" },
      openEditorTabs: [
        { kind: "file", path: "src/app.ts" },
        { kind: "browser", id: "browser-1", url: "localhost:8001" },
        { kind: "browser", id: "browser-2", url: "localhost:8001" },
      ],
      activateEditorTab,
      closeEditorTab,
    });

    render(<EditorSurface state={state} />);

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    const browserTabs = within(tablist).getAllByRole("tab", { name: "localhost:8001" });

    expect(browserTabs).toHaveLength(2);

    fireEvent.click(browserTabs[0]!);
    expect(activateEditorTab).toHaveBeenCalledWith({
      kind: "browser",
      id: "browser-1",
      url: "localhost:8001",
    });

    const browserCloseButtons = screen.getAllByRole("button", { name: "Close Browser tab" });
    fireEvent.click(browserCloseButtons[0]!);
    expect(closeEditorTab).toHaveBeenCalledWith({
      kind: "browser",
      id: "browser-1",
      url: "localhost:8001",
    });
  });

  it("closes the desktop editor view without discarding dirty file buffers", () => {
    vi.useFakeTimers();
    const hideEditorView = vi.fn();
    const state = createState({
      currentFile: {
        kind: "text",
        path: "src/app.ts",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-app",
        isDirty: true,
      },
      hideEditorView,
    });

    const { container } = render(<EditorSurface state={state} />);

    fireEvent.click(screen.getByRole("button", { name: "Close editor view" }));

    expect(screen.queryByRole("dialog", { name: "Discard unsaved changes?" })).toBeNull();
    expect(container.querySelector(".workspace-git-view--closing-to-restore")).toBeTruthy();
    expect(hideEditorView).not.toHaveBeenCalled();

    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(hideEditorView).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("renders overlay editor tabs with file names and one full path row", () => {
    const activateOpenFile = vi.fn();
    const closeOpenFilePath = vi.fn();
    const state = {
      ...createState({
        activeFilePath: "packages/web/src/styles/components.css",
        currentFile: {
          kind: "text",
          path: "packages/web/src/styles/components.css",
          content: "changed",
          savedContent: "saved",
          baseHash: "hash-css",
          isDirty: true,
        },
      }),
      activateOpenFile,
      closeOpenFilePath,
      openEditorPaths: [
        "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
        "packages/web/src/styles/components.css",
        "packages/web/src/features/agent-panes/index.tsx",
        "packages/web/src/features/workspace/index.tsx",
      ],
      openFiles: {
        "packages/web/src/features/code-editor/views/shared/editor-surface.tsx": {
          kind: "text",
          path: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
          content: "",
          savedContent: "",
          baseHash: "hash-surface",
          isDirty: false,
        },
        "packages/web/src/styles/components.css": {
          kind: "text",
          path: "packages/web/src/styles/components.css",
          content: "changed",
          savedContent: "saved",
          baseHash: "hash-css",
          isDirty: true,
        },
        "packages/web/src/features/agent-panes/index.tsx": {
          kind: "text",
          path: "packages/web/src/features/agent-panes/index.tsx",
          content: "",
          savedContent: "",
          baseHash: "hash-agent-index",
          isDirty: false,
        },
        "packages/web/src/features/workspace/index.tsx": {
          kind: "text",
          path: "packages/web/src/features/workspace/index.tsx",
          content: "",
          savedContent: "",
          baseHash: "hash-workspace-index",
          isDirty: false,
        },
      },
    } as unknown as CodeEditorState;

    render(<EditorSurface state={state} />);

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(within(tablist).getByText("editor-surface.tsx")).toBeInTheDocument();
    expect(within(tablist).getByText("components.css")).toBeInTheDocument();
    expect(within(tablist).getAllByText("index.tsx")).toHaveLength(2);
    expect(
      within(tablist).getByRole("button", { name: "Close file components.css" })
    ).toBeInTheDocument();
    expect(within(tablist).getByText("agent-panes")).toHaveClass("code-editor-tab__folder");
    expect(within(tablist).getByText("workspace")).toHaveClass("code-editor-tab__folder");
    expect(within(tablist).queryByText("packages/web/src/styles/components.css")).toBeNull();

    const activeTab = within(tablist).getByRole("tab", { selected: true });
    expect(activeTab).toHaveTextContent("components.css");
    expect(activeTab.querySelector(".dirty-indicator")).toBeTruthy();

    const pathRows = screen.getAllByRole("navigation", { name: "Current file path" });
    expect(pathRows).toHaveLength(1);
    const pathRow = pathRows[0] as HTMLElement;
    expect(pathRow).toHaveAttribute("title", "/tmp/ws-1/packages/web/src/styles/components.css");
    expect(within(pathRow).getByText("/tmp")).toBeInTheDocument();
    expect(within(pathRow).getByText("ws-1")).toBeInTheDocument();
    expect(within(pathRow).getByText("packages")).toBeInTheDocument();
    expect(within(pathRow).getByText("web")).toBeInTheDocument();
    expect(within(pathRow).getByText("src")).toBeInTheDocument();
    expect(within(pathRow).getByText("styles")).toBeInTheDocument();
    expect(within(pathRow).getByText("components.css")).toBeInTheDocument();
    expect(within(pathRow).getByText("modified · Unsaved changes")).toHaveClass(
      "code-editor-path__state"
    );
    expect(within(pathRow).getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(within(pathRow).getByRole("button", { name: "预览" })).toBeInTheDocument();
    expect(within(pathRow).getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(within(pathRow).queryByRole("button", { name: "Close editor view" })).toBeNull();
    const tabbarActions = screen
      .getByRole("tablist", { name: "Open editor tabs" })
      .closest(".code-editor-tabbar")
      ?.querySelector(".code-editor-tabbar__actions");
    expect(tabbarActions).toBeTruthy();
    expect(
      within(tabbarActions as HTMLElement).getByRole("button", { name: "Close editor view" })
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();

    fireEvent.click(within(tablist).getByRole("tab", { name: /editor-surface\.tsx/ }));
    expect(activateOpenFile).toHaveBeenCalledWith(
      "packages/web/src/features/code-editor/views/shared/editor-surface.tsx"
    );

    fireEvent.click(within(tablist).getByRole("button", { name: "Close file components.css" }));
    expect(closeOpenFilePath).toHaveBeenCalledWith("packages/web/src/styles/components.css");
    expect(state.hideEditorView).not.toHaveBeenCalled();
    expect(state.handleClose).not.toHaveBeenCalled();
    expect(activateOpenFile).toHaveBeenCalledTimes(1);
  });

  it("does not derive global editor tabs from shared open-file cache entries", () => {
    const state = createState({
      activeFilePath: "src/global.ts",
      currentFile: {
        kind: "text",
        path: "src/global.ts",
        content: "export const globalFile = true;\n",
        savedContent: "export const globalFile = true;\n",
        baseHash: "hash-global",
        isDirty: false,
      },
      openEditorPaths: ["src/global.ts"],
      openFiles: {
        "src/global.ts": {
          kind: "text",
          path: "src/global.ts",
          content: "export const globalFile = true;\n",
          savedContent: "export const globalFile = true;\n",
          baseHash: "hash-global",
          isDirty: false,
        },
        "src/panel-only.ts": {
          kind: "text",
          path: "src/panel-only.ts",
          content: "export const panelOnly = true;\n",
          savedContent: "export const panelOnly = true;\n",
          baseHash: "hash-panel",
          isDirty: false,
        },
      },
    });

    render(<EditorSurface state={state} />);

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    const tabs = within(tablist).getAllByRole("tab");

    expect(tabs).toHaveLength(1);
    expect(within(tablist).getByText("global.ts")).toBeInTheDocument();
    expect(within(tablist).queryByText("panel-only.ts")).toBeNull();
  });

  it("shows the active filename in tabs and the full path in the path row", () => {
    const state = createState({
      activeFilePath: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
      currentFile: {
        kind: "text",
        path: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-1",
        isDirty: true,
      },
      openEditorPaths: ["packages/web/src/features/code-editor/views/shared/editor-surface.tsx"],
      openFiles: {
        "packages/web/src/features/code-editor/views/shared/editor-surface.tsx": {
          kind: "text",
          path: "packages/web/src/features/code-editor/views/shared/editor-surface.tsx",
          content: "changed",
          savedContent: "saved",
          baseHash: "hash-1",
          isDirty: true,
        },
      },
    });

    render(<EditorSurface state={state} />);

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    const activeTab = within(tablist).getByRole("tab", { selected: true });
    const pathRow = screen.getByRole("navigation", { name: "Current file path" });

    expect(activeTab).toHaveTextContent("editor-surface.tsx");
    expect(activeTab).not.toHaveTextContent("packages/web/src");
    expect(activeTab.querySelector(".dirty-indicator")).toBeTruthy();
    expect(pathRow).toHaveAttribute(
      "title",
      "/tmp/ws-1/packages/web/src/features/code-editor/views/shared/editor-surface.tsx"
    );
    expect(within(pathRow).getByText("packages")).toBeInTheDocument();
    expect(within(pathRow).getByText("editor-surface.tsx")).toBeInTheDocument();
  });

  it("renders a commit file list preview inside the shared editor surface", () => {
    const state = createState({
      activeFilePath: null,
      currentFile: undefined,
      activeDiffChange: {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByText("abc123 · commit subject")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("commit-file-list-preview"));
    expect(state.openCommitFileDiff).toHaveBeenCalledWith({
      path: "src/app.ts",
      status: "modified",
      renderAs: "text",
    });
  });

  it("renders a working close action for commit file diff previews", () => {
    const state = createState({
      activeFilePath: null,
      currentFile: undefined,
      activeDiffChange: {
        kind: "commit-file-diff",
        path: "src/app.ts",
        title: "src/app.ts",
        diff: "diff --git a/src/app.ts b/src/app.ts",
        renderAs: "text",
        status: "modified",
        originalContent: "export const app = 1;\n",
        modifiedContent: "export const app = 2;\n",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        file: {
          path: "src/app.ts",
          status: "modified",
          renderAs: "text",
        },
        parentList: {
          kind: "commit-file-list",
          path: "abc123",
          title: "abc123 · commit subject",
          commit: {
            sha: "abc123",
            shortSha: "abc123",
            subject: "commit subject",
            authorName: "Spencer",
            authoredAt: 1,
          },
          files: [
            {
              path: "src/app.ts",
              status: "modified",
              renderAs: "text",
            },
          ],
        },
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff-host")).toHaveAttribute(
      "data-original",
      "export const app = 1;\n"
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(state.handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders worktree image diffs from diff payload metadata instead of current file cache", () => {
    const state = createState({
      mode: "diff",
      currentFile: undefined,
      activeDiffChange: {
        kind: "worktree-file-diff",
        path: "assets/logo.png",
        diff: "Binary files a/assets/logo.png and b/assets/logo.png differ",
        renderAs: "image",
        status: "deleted",
        mime: "image/png",
        originalPath: "assets/logo.png",
        modifiedPath: "assets/logo.png",
        originalRevision: "INDEX",
        modifiedRevision: "WORKTREE",
        staged: false,
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByTestId("image-diff-preview")).toHaveAttribute(
      "data-path",
      "assets/logo.png"
    );
    expect(screen.getByTestId("image-diff-preview")).toHaveAttribute("data-mime", "image/png");
    expect(screen.getByTestId("image-diff-preview")).toHaveAttribute("data-status", "deleted");
    expect(screen.getByTestId("image-diff-preview")).toHaveAttribute(
      "data-before-url",
      "/api/file?workspaceId=ws-1&path=assets%2Flogo.png&revision=INDEX"
    );
    expect(screen.getByTestId("image-diff-preview")).toHaveAttribute("data-after-url", "");
  });

  it("shows the commit preview title without leaking the background file dirty marker", () => {
    const state = createState({
      currentFile: {
        kind: "text",
        path: "src/app.ts",
        content: "export const app = 2;\n",
        savedContent: "export const app = 1;\n",
        baseHash: "hash-1",
        isDirty: true,
      },
      activeDiffChange: {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByText("abc123 · commit subject")).toBeInTheDocument();
    expect(document.querySelector(".code-file-path")).toHaveTextContent("abc123 · commit subject");
    expect(document.querySelector(".dirty-indicator")).toBeNull();
  });

  it("suppresses file-scoped alerts while a commit-history preview is active", () => {
    const state = createState({
      activeExternalStatus: "modified",
      activeDiffChange: {
        kind: "commit-file-list",
        path: "abc123",
        title: "abc123 · commit subject",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        files: [
          {
            path: "src/app.ts",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
      hasUnsavedChangesOutsideDiff: true,
      saveError: "Failed to save file",
    });

    render(<EditorSurface state={state} />);

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Failed to save file")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Diff preview is based on saved file contents.")
    ).not.toBeInTheDocument();
  });
});

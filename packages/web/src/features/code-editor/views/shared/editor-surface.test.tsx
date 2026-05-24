import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { type CodeEditorState } from "./code-editor-host";
import { EditorSurface } from "./editor-surface";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const dictionary: Record<string, string> = {
      "code_editor.mode_preview": "预览",
      "code_editor.mode_edit": "编辑",
      "code_editor.mode_diff": "Diff",
      "code_editor.diff_saved_only": "Diff preview is based on saved file contents.",
      "action.close": "Close",
      "action.save_file": "Save File",
    };
    return dictionary[key] ?? key;
  },
}));

vi.mock("../../components/monaco-host", () => ({
  MonacoHost: ({ readOnly }: { readOnly?: boolean }) => (
    <div data-testid="monaco-host" data-read-only={String(Boolean(readOnly))} />
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

vi.mock("../../components/image-preview", () => ({
  ImagePreview: () => <div data-testid="image-preview" />,
}));

vi.mock("../../components/document-preview", () => ({
  DocumentPreview: ({ src }: { src: string | null }) => (
    <div data-testid="document-preview" data-src={src ?? ""} />
  ),
}));

function createState(overrides: Partial<CodeEditorState> = {}): CodeEditorState {
  return {
    activeFilePath: "src/app.ts",
    activeDiffChange: null,
    activeExternalStatus: null,
    activeLoadError: null,
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
    handleContentChange: vi.fn(),
    handleSave: vi.fn(),
    hasUnsavedChangesOutsideDiff: false,
    isImageFile: false,
    isSaving: false,
    isSvgTextBacked: false,
    isTextFile: true,
    documentPreview: {
      iframeSrc: null,
      isBootstrapping: false,
      isSyncing: false,
      error: null,
      retry: vi.fn(),
    },
    mode: "edit",
    openInDiffMode: vi.fn(),
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
  it("renders 预览, 编辑, and Diff in one persistent header for text files", () => {
    const state = createState();

    render(<EditorSurface state={state} />);

    expect(screen.getByRole("button", { name: "预览" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
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
  });

  it("renders Monaco diff when diff kind is text", () => {
    const state = createState({
      mode: "diff",
      activeDiffChange: {
        path: "src/app.ts",
        diff: "@@ -1 +1 @@\n-export const app = 1;\n+export const app = 2;\n",
        renderAs: "text",
        status: "modified",
        originalContent: "export const app = 1;\n",
        modifiedContent: "export const app = 2;\n",
        source: "file",
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

  it("shows the saved-only warning while diff mode ignores unsaved local edits", () => {
    const state = createState({
      mode: "diff",
      hasUnsavedChangesOutsideDiff: true,
      activeDiffChange: {
        path: "src/app.ts",
        diff: "@@ -1 +1 @@\n-export const app = 1;\n+export const app = 2;\n",
        renderAs: "text",
        status: "modified",
        originalContent: "export const app = 1;\n",
        modifiedContent: "export const app = 2;\n",
        source: "file",
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

  it("renders desktop header actions in the fixed order and left-aligned group", () => {
    const state = createState({ canSave: true });
    const { container } = render(<EditorSurface state={state} />);

    const toolbar = container.querySelector(".editor-surface__toolbar");
    expect(toolbar).toBeTruthy();

    const buttonLabels = within(toolbar as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent ?? "");

    expect(buttonLabels).toEqual(["Diff", "预览", "编辑", "Save File", "Close"]);
  });

  it("renders a working close action for commit-history previews", () => {
    const state = createState({
      activeFilePath: "src/app.ts",
      activeDiffChange: {
        path: "abc123",
        title: "abc123 · commit subject",
        diff: "diff --git a/src/app.ts b/src/app.ts",
        source: "commit",
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.queryByRole("button", { name: "Diff" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(state.handleClose).toHaveBeenCalledTimes(1);
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
        path: "abc123",
        title: "abc123 · commit subject",
        diff: "diff --git a/src/app.ts b/src/app.ts",
        source: "commit",
      },
    });

    render(<EditorSurface state={state} />);

    expect(screen.getByText("abc123 · commit subject")).toBeInTheDocument();
    expect(screen.queryByText("src/app.ts")).not.toBeInTheDocument();
    expect(document.querySelector(".dirty-indicator")).toBeNull();
  });

  it("suppresses file-scoped alerts while a commit-history preview is active", () => {
    const state = createState({
      activeExternalStatus: "modified",
      activeDiffChange: {
        path: "abc123",
        title: "abc123 · commit subject",
        diff: "diff --git a/src/app.ts b/src/app.ts",
        source: "commit",
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

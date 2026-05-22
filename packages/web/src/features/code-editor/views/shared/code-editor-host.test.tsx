import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeEditorHeaderActions, type CodeEditorState, CodeEditorView } from "./code-editor-host";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    switch (key) {
      case "code_editor.edit_as_text":
        return "Edit as text";
      case "code_editor.preview_as_image":
        return "Preview as image";
      case "code_editor.mode_text":
        return "Text";
      case "code_editor.mode_image":
        return "Image";
      case "code_editor.saving":
        return "Saving";
      case "action.save_file":
        return "Save File";
      case "action.close":
        return "Close";
      default:
        return key;
    }
  },
}));

vi.mock("../../components/monaco-host", () => ({
  MonacoHost: () => <div data-testid="monaco-host-mock" />,
}));

vi.mock("../../components/monaco-diff-host", () => ({
  MonacoDiffHost: () => <div data-testid="monaco-diff-host-mock" />,
}));

vi.mock("../../components/image-preview", () => ({
  ImagePreview: () => <div data-testid="image-preview-mock" />,
}));

function createState(overrides: Partial<CodeEditorState> = {}): CodeEditorState {
  return {
    activeFilePath: null,
    activeDiffChange: null,
    activeExternalStatus: null,
    activeLoadError: null,
    canSave: true,
    canDiff: false,
    canEdit: true,
    canPreview: false,
    currentFile: undefined,
    handleClose: vi.fn(),
    handleContentChange: vi.fn(),
    handleSave: vi.fn(),
    hasUnsavedChangesOutsideDiff: false,
    isImageFile: false,
    isSaving: false,
    isSvgTextBacked: true,
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
    workspace: undefined,
    workspaceId: undefined,
    ...overrides,
  };
}

describe("CodeEditorHeaderActions", () => {
  it("uses shared IconButton compatibility classes for the mobile icon toggle", () => {
    const state = createState();

    render(<CodeEditorHeaderActions state={state} variant="mobile" />);

    const toggleButton = screen.getByRole("button", { name: "Preview as image" });

    expect(toggleButton).toHaveClass(
      "btn",
      "btn-ghost",
      "mobile-sheet__action",
      "mobile-sheet__action--icon"
    );

    fireEvent.click(toggleButton);
    expect(state.toggleSvgTextMode).toHaveBeenCalledTimes(1);
  });

  it("uses shared IconButton compatibility classes for the desktop close action", () => {
    const state = createState();

    render(<CodeEditorHeaderActions state={state} />);

    const closeButton = screen.getByRole("button", { name: "Close" });

    expect(closeButton).toHaveClass("btn", "btn-ghost", "btn-sm", "code-mode-btn");

    fireEvent.click(closeButton);
    expect(state.handleClose).toHaveBeenCalledTimes(1);
  });

  it("renders semantic icons for save and external file alerts", () => {
    const state = createState({
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
      currentFile: {
        kind: "text",
        path: "src/app.tsx",
        content: "export const app = true;",
        baseHash: "hash-1",
        isDirty: false,
      } as CodeEditorState["currentFile"],
      activeExternalStatus: "modified",
      saveError: "Failed to save file",
    });

    const { container, rerender } = render(<CodeEditorView state={state} />);
    const alerts = screen.getAllByRole("alert");

    expect(alerts[0]?.querySelector('[data-icon-semantic="state.error"]')).toBeTruthy();
    expect(alerts[1]?.querySelector('[data-icon-semantic="state.fileModified"]')).toBeTruthy();

    rerender(
      <CodeEditorView
        state={{
          ...state,
          activeExternalStatus: "deleted",
        }}
      />
    );

    expect(container.querySelector('[data-icon-semantic="state.fileDeleted"]')).toBeTruthy();
  });

  it("renders git diff viewer inside the editor surface when mode is diff", () => {
    const state = createState({
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
      activeFilePath: "src/app.tsx",
      mode: "diff",
      canDiff: true,
      activeDiffChange: {
        path: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;",
        modifiedContent: "const app = 1;",
        source: "file",
      },
      currentFile: {
        kind: "text",
        path: "src/app.tsx",
        content: "const app = 1;",
        savedContent: "const app = 1;",
        baseHash: "hash-1",
        isDirty: false,
      } as CodeEditorState["currentFile"],
    });

    render(<CodeEditorView state={state} />);

    expect(screen.getByTestId("monaco-diff-host-mock")).toBeInTheDocument();
  });

  it("renders commit-history diff preview without an active file", () => {
    const state = createState({
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
      mode: "preview",
      activeDiffChange: {
        path: "abc123",
        title: "abc123 · commit subject",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        source: "commit",
      },
    });

    render(<CodeEditorView state={state} />);

    expect(screen.getByText("abc123 · commit subject")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff-host-mock")).toBeInTheDocument();
  });
});

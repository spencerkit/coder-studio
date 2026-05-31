import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  CodeEditorDesktopHeaderActions,
  CodeEditorHeaderActions,
  type CodeEditorState,
  CodeEditorView,
} from "./code-editor-host";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    switch (key) {
      case "code_editor.mode_diff":
        return "Diff";
      case "code_editor.mode_preview":
        return "Preview";
      case "code_editor.mode_edit":
        return "Edit";
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
    openCommitFileDiff: vi.fn(),
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

  it("renders mobile mode switches for diff preview and edit alongside save", () => {
    const state = createState({
      canDiff: true,
      canPreview: true,
      canEdit: true,
      isSvgTextBacked: false,
    });

    render(<CodeEditorHeaderActions state={state} variant="mobile" />);

    fireEvent.click(screen.getByRole("button", { name: "Diff" }));
    expect(state.openInDiffMode).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Preview" }));
    expect(state.setMode).toHaveBeenCalledWith("preview");

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(state.setMode).toHaveBeenCalledWith("edit");
  });

  it("uses shared IconButton compatibility classes for the desktop close action", () => {
    const state = createState();

    render(<CodeEditorHeaderActions state={state} />);

    const closeButton = screen.getByRole("button", { name: "Close" });

    expect(closeButton).toHaveClass("btn", "btn-ghost", "btn-sm", "code-mode-btn");

    fireEvent.click(closeButton);
    expect(state.handleClose).toHaveBeenCalledTimes(1);
  });

  it("can suppress the desktop close action when pane chrome provides its own close control", () => {
    const state = createState();

    render(<CodeEditorDesktopHeaderActions state={state} showCloseAction={false} />);

    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
  });

  it("renders desktop mode actions as icon-only buttons without save chrome", () => {
    const state = createState({
      canDiff: true,
      canEdit: true,
      canPreview: true,
      isSvgTextBacked: false,
      mode: "preview",
    });

    render(<CodeEditorDesktopHeaderActions state={state} />);

    expect(screen.getByRole("button", { name: "Diff" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save File" })).not.toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(screen.queryByText("Edit")).not.toBeInTheDocument();
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
        kind: "worktree-file-diff",
        path: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;",
        modifiedContent: "const app = 1;",
        staged: false,
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

  it("renders commit file list preview without an active file", () => {
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
            path: "src/app.tsx",
            status: "modified",
            renderAs: "text",
          },
        ],
      },
    });

    render(<CodeEditorView state={state} />);

    expect(screen.getByText("abc123 · commit subject")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/app.tsx modified" })).toBeInTheDocument();
    expect(screen.queryByTestId("monaco-diff-host-mock")).not.toBeInTheDocument();
  });

  it("renders commit file diff preview without an active file", () => {
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
        kind: "commit-file-diff",
        path: "src/app.tsx",
        title: "src/app.tsx",
        diff: "diff --git a/src/app.tsx b/src/app.tsx",
        renderAs: "text",
        status: "modified",
        originalContent: "const app = 0;",
        modifiedContent: "const app = 1;",
        commit: {
          sha: "abc123",
          shortSha: "abc123",
          subject: "commit subject",
          authorName: "Spencer",
          authoredAt: 1,
        },
        file: {
          path: "src/app.tsx",
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
              path: "src/app.tsx",
              status: "modified",
              renderAs: "text",
            },
          ],
        },
      },
    });

    render(<CodeEditorView state={state} />);

    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getByTestId("monaco-diff-host-mock")).toBeInTheDocument();
  });
});

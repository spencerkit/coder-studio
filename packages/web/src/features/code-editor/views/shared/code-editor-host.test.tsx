import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CodeEditorHeaderActions, type CodeEditorState } from "./code-editor-host";

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

function createState(overrides: Partial<CodeEditorState> = {}): CodeEditorState {
  return {
    activeFilePath: null,
    activeExternalStatus: null,
    activeLoadError: null,
    canSave: true,
    currentFile: undefined,
    handleClose: vi.fn(),
    handleContentChange: vi.fn(),
    handleSave: vi.fn(),
    isImageFile: false,
    isSaving: false,
    isSvgTextBacked: true,
    isTextFile: true,
    openInDiffMode: vi.fn(),
    saveError: null,
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
});

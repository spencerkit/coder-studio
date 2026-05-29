import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import {
  activeFilePathAtomFamily,
  type OpenFile,
  openFilesAtomFamily,
} from "../../../workspace/atoms";
import { EditorPaneCard } from "./editor-pane-card";

const mocks = vi.hoisted(() => ({
  editorState: {
    marker: "editor-state",
    currentFile: undefined as OpenFile | undefined,
  },
  mockUseCodeEditorActions: vi.fn(),
  mockCodeEditorHost: vi.fn(() => <div data-testid="editor-host">Editor Host</div>),
  mockCodeEditorDesktopHeaderActions: vi.fn(() => (
    <div data-testid="editor-toolbar" role="toolbar" aria-label="Editor actions">
      Editor Toolbar
    </div>
  )),
}));

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string>) => {
    const dictionary: Record<string, string> = {
      "action.close": "Close",
      "code_editor.unsaved_changes": "Unsaved changes",
      "code_editor.close_unsaved_title": "Discard unsaved changes?",
      "code_editor.close_unsaved_description": `${params?.name ?? "File"} has unsaved changes.`,
      "code_editor.discard_and_close": "Discard and Close",
      "common.cancel": "Cancel",
    };
    return dictionary[key] ?? key;
  },
}));

vi.mock("../../../code-editor/actions/use-code-editor-actions", () => ({
  useCodeEditorActions: mocks.mockUseCodeEditorActions,
}));

vi.mock("../../../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: mocks.mockCodeEditorHost,
  CodeEditorDesktopHeaderActions: mocks.mockCodeEditorDesktopHeaderActions,
}));

describe("EditorPaneCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders editor pane actions and delegates split and close callbacks", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(activeFilePathAtomFamily("ws-123"), "src/app.tsx");

    render(
      <Provider store={store}>
        <EditorPaneCard
          workspaceId="ws-123"
          paneId="pane-1"
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
        />
      </Provider>
    );

    expect(screen.getByText("app.tsx")).toBeInTheDocument();
    expect(screen.queryByText("src/app.tsx")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("editor-toolbar").closest(".panel-header")).toBeTruthy();
    expect(
      screen.queryByText("Editor Toolbar")?.closest(".editor-pane-card__toolbar-row")
    ).toBeNull();
    expect(screen.getByTestId("editor-host")).toBeInTheDocument();
    expect(mocks.mockCodeEditorDesktopHeaderActions).toHaveBeenCalledWith(
      expect.objectContaining({
        state: mocks.editorState,
        showCloseAction: false,
      }),
      undefined
    );
    expect(mocks.mockCodeEditorHost).toHaveBeenCalledWith(
      expect.objectContaining({
        chrome: "content-only",
        editorState: mocks.editorState,
      }),
      undefined
    );

    fireEvent.click(screen.getByRole("button", { name: "Split horizontal" }));
    fireEvent.click(screen.getByRole("button", { name: "Split vertical" }));
    fireEvent.click(screen.getByRole("button", { name: "Close" }));

    expect(onSplitPane).toHaveBeenNthCalledWith(1, "pane-1", "horizontal");
    expect(onSplitPane).toHaveBeenNthCalledWith(2, "pane-1", "vertical");
    expect(onClosePane).toHaveBeenCalledWith("pane-1");
  });

  it("marks dirty editor pane titles and confirms before closing dirty files", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(activeFilePathAtomFamily("ws-123"), "src/app.tsx");
    store.set(openFilesAtomFamily("ws-123"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-1",
        isDirty: true,
      },
    });

    render(
      <Provider store={store}>
        <EditorPaneCard
          workspaceId="ws-123"
          paneId="pane-1"
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
        />
      </Provider>
    );

    const title = screen.getByText("app.tsx");
    const titleElement = title.closest(".panel-header__title");
    const dirtyMeta = titleElement?.nextElementSibling;

    expect(dirtyMeta).toHaveClass("panel-header__meta");
    expect(dirtyMeta?.querySelector(".editor-pane-card__dirty-indicator")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClosePane).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Discard unsaved changes?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClosePane).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Discard and Close" }));

    expect(onClosePane).toHaveBeenCalledWith("pane-1");
  });
});

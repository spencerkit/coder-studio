import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { activeFilePathAtomFamily } from "../../../workspace/atoms";
import { EditorPaneCard } from "./editor-pane-card";

const mocks = vi.hoisted(() => ({
  editorState: { marker: "editor-state" },
  mockUseCodeEditorActions: vi.fn(),
  mockCodeEditorHost: vi.fn(() => <div data-testid="editor-host">Editor Host</div>),
  mockCodeEditorDesktopHeaderActions: vi.fn(() => (
    <div data-testid="editor-toolbar">Editor Toolbar</div>
  )),
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
});

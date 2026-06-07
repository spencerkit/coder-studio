import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { setWorkspacePathDragData } from "../../../../lib/workspace-path-drag";
import { type OpenFile, openFilesAtomFamily } from "../../../workspace/atoms";
import { editorPaneActiveFilePathAtomFamily } from "../../atoms/editor-panes";
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
const paneDragEnabledMock = vi.hoisted(() => ({
  value: true,
}));

vi.mock("../../actions/use-pane-drag-enabled", () => ({
  usePaneDragEnabled: () => paneDragEnabledMock.value,
}));

vi.mock("../../../code-editor/actions/use-code-editor-actions", () => ({
  useCodeEditorActions: mocks.mockUseCodeEditorActions,
}));

vi.mock("../../../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: mocks.mockCodeEditorHost,
  CodeEditorDesktopHeaderActions: mocks.mockCodeEditorDesktopHeaderActions,
}));

function createWorkspaceFileDataTransfer(workspaceId: string, path: string) {
  const values = new Map<string, string>();
  const types: string[] = [];
  const dataTransfer: Pick<DataTransfer, "effectAllowed" | "getData" | "setData" | "types"> = {
    types,
    effectAllowed: "uninitialized" as DataTransfer["effectAllowed"],
    setData: vi.fn((type: string, value: string) => {
      if (!types.includes(type)) {
        types.push(type);
      }
      values.set(type, value);
    }),
    getData: vi.fn((type: string) => values.get(type) ?? ""),
  };

  setWorkspacePathDragData(dataTransfer, {
    workspaceId,
    path,
    kind: "file",
  });

  return dataTransfer;
}

describe("EditorPaneCard", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders a drag handle in the header actions on desktop", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();
    const onPaneDragStart = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(editorPaneActiveFilePathAtomFamily("ws-123"), "src/app.tsx");

    render(
      <Provider store={store}>
        <EditorPaneCard
          workspaceId="ws-123"
          paneId="pane-1"
          onClosePane={onClosePane}
          onSplitPane={onSplitPane}
          onPaneDragStart={onPaneDragStart as never}
        />
      </Provider>
    );

    const dragHandle = screen.getByRole("button", { name: "Drag pane" });

    expect(dragHandle).toBeInTheDocument();

    fireEvent.pointerDown(dragHandle);

    expect(onPaneDragStart).toHaveBeenCalledWith(expect.objectContaining({ paneId: "pane-1" }));
  });

  it("opens workspace file drops in the editor pane instead of letting the editor insert text", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();
    const onOpenFile = vi.fn();
    const parentDrop = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(editorPaneActiveFilePathAtomFamily("ws-123"), "src/app.tsx");

    render(
      <Provider store={store}>
        <div onDrop={parentDrop}>
          <EditorPaneCard
            workspaceId="ws-123"
            paneId="pane-1"
            onClosePane={onClosePane}
            onOpenFile={onOpenFile}
            onSplitPane={onSplitPane}
          />
        </div>
      </Provider>
    );

    const editorPane = screen.getByTestId("editor-pane-pane-1");
    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "dataTransfer", {
      value: createWorkspaceFileDataTransfer("ws-123", "src/dropped.ts"),
    });

    fireEvent(editorPane, dragOver);

    expect(dragOver.defaultPrevented).toBe(true);

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: createWorkspaceFileDataTransfer("ws-123", "src/dropped.ts"),
    });

    fireEvent(editorPane, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(parentDrop).not.toHaveBeenCalled();
    expect(onOpenFile).toHaveBeenCalledWith("pane-1", "src/dropped.ts");
  });

  it("renders editor pane actions and delegates split and close callbacks", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(editorPaneActiveFilePathAtomFamily("ws-123"), "src/app.tsx");

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
    store.set(editorPaneActiveFilePathAtomFamily("ws-123"), "src/app.tsx");
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

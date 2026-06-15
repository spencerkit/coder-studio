import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { setWorkspacePathDragData } from "../../../../lib/workspace-path-drag";
import { type OpenFile, openFilesAtomFamily } from "../../../workspace/atoms";
import {
  editorPaneActiveFilePathAtomFamily,
  getEditorPaneStateKey,
} from "../../atoms/editor-panes";
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
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-123", "pane-1")),
      "src/app.tsx"
    );

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

    expect(onPaneDragStart).toHaveBeenCalledWith(
      expect.objectContaining({ paneId: "pane-1", title: "app.tsx" })
    );
  });

  it("opens workspace file drops in the editor pane instead of letting the editor insert text", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();
    const onOpenFile = vi.fn();
    const parentDrop = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-123", "pane-1")),
      "src/app.tsx"
    );

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
    const fileDropOverlay = screen.getByText("Open in editor").closest(".pane-drop-overlay");
    expect(fileDropOverlay).toHaveClass("editor-pane-card__file-drop-overlay");

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: createWorkspaceFileDataTransfer("ws-123", "src/dropped.ts"),
    });

    fireEvent(editorPane, drop);

    expect(drop.defaultPrevented).toBe(true);
    expect(parentDrop).not.toHaveBeenCalled();
    expect(onOpenFile).toHaveBeenCalledWith("pane-1", "src/dropped.ts");
  });

  it("prepares a hidden file drop shield while a workspace file drag is active", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();
    const onOpenFile = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-123", "pane-1")),
      "docs/preview.md"
    );

    render(
      <Provider store={store}>
        <EditorPaneCard
          workspaceId="ws-123"
          paneId="pane-1"
          onClosePane={onClosePane}
          onOpenFile={onOpenFile}
          onSplitPane={onSplitPane}
        />
      </Provider>
    );

    act(() => {
      window.dispatchEvent(
        new CustomEvent("coder-studio:workspace-path-drag-start", {
          detail: {
            workspaceId: "ws-123",
            path: "src/dropped.ts",
            kind: "file",
          },
        })
      );
    });

    const hiddenDropShield = document.querySelector(".editor-pane-card__file-drop-overlay");
    expect(hiddenDropShield).toHaveClass("editor-pane-card__file-drop-overlay--hidden");

    const dragOver = new Event("dragover", { bubbles: true, cancelable: true });
    Object.defineProperty(dragOver, "dataTransfer", {
      value: createWorkspaceFileDataTransfer("ws-123", "src/dropped.ts"),
    });

    fireEvent(hiddenDropShield!, dragOver);

    expect(dragOver.defaultPrevented).toBe(true);
    expect(screen.getByText("Open in editor")).toBeInTheDocument();

    const drop = new Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(drop, "dataTransfer", {
      value: createWorkspaceFileDataTransfer("ws-123", "src/dropped.ts"),
    });

    fireEvent(hiddenDropShield!, drop);

    expect(onOpenFile).toHaveBeenCalledWith("pane-1", "src/dropped.ts");

    act(() => {
      window.dispatchEvent(new Event("coder-studio:workspace-path-drag-end"));
    });
    expect(document.querySelector(".editor-pane-card__file-drop-overlay")).toBeNull();
  });

  it("keeps header actions right aligned when the editor pane has no open files", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");

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

    const header = screen.getByTestId("editor-pane-pane-1").querySelector(".code-editor-tabbar");
    const emptyTabs = header?.querySelector(".code-editor-tabs--empty");
    const emptyLabel = header?.querySelector(".code-file-path");
    const headerActions = header?.querySelector(".code-editor-tabbar__actions");

    expect(emptyTabs).toContainElement(emptyLabel);
    expect(emptyTabs?.nextElementSibling).toBe(headerActions);
    expect(headerActions).toContainElement(
      screen.getByRole("button", { name: "Split horizontal" })
    );
  });

  it("renders editor pane actions and delegates split and close callbacks", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-123", "pane-1")),
      "src/app.tsx"
    );

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

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    expect(within(tablist).getByRole("tab", { selected: true })).toHaveTextContent("app.tsx");
    expect(screen.queryByText("src/app.tsx")).not.toBeInTheDocument();
    expect(screen.getByTestId("editor-toolbar")).toBeInTheDocument();
    expect(screen.getByTestId("editor-toolbar").closest(".code-editor-path__actions")).toBeTruthy();
    expect(screen.queryByText("Editor Toolbar")?.closest(".panel-header")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Split horizontal" }).closest(".session-header-actions")
    ).toBeTruthy();
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

  it("renders opened panel files as editor tabs and switches through editor actions", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();
    const activateOpenFile = vi.fn();
    const closeOpenFilePath = vi.fn();

    const openFiles: Record<string, OpenFile> = {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "",
        savedContent: "",
        baseHash: "hash-app",
        isDirty: false,
      },
      "src/findings.md": {
        kind: "text",
        path: "src/findings.md",
        content: "changed",
        savedContent: "saved",
        baseHash: "hash-findings",
        isDirty: true,
      },
    };

    mocks.mockUseCodeEditorActions.mockReturnValue({
      ...mocks.editorState,
      activeFilePath: "src/findings.md",
      activateOpenFile,
      closeOpenFilePath,
      currentFile: openFiles["src/findings.md"],
      openEditorPaths: ["src/app.tsx", "src/findings.md"],
      openFiles,
      workspace: {
        id: "ws-123",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    });
    store.set(localeAtom, "en");
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-123", "pane-1")),
      "src/findings.md"
    );
    store.set(openFilesAtomFamily("ws-123"), openFiles);

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

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    const tabs = within(tablist).getAllByRole("tab");

    expect(tabs).toHaveLength(2);
    expect(within(tablist).getByText("app.tsx")).toBeInTheDocument();
    expect(within(tablist).getByText("findings.md")).toBeInTheDocument();
    expect(within(tablist).getByRole("tab", { selected: true })).toHaveTextContent("findings.md");
    expect(within(tablist).getByRole("tab", { name: /findings\.md/ })).toContainElement(
      within(tablist).getByTitle("Unsaved changes")
    );
    expect(screen.queryByText("src/findings.md")).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Current file path" })).toHaveAttribute(
      "title",
      "/workspace/src/findings.md"
    );

    fireEvent.click(within(tablist).getByRole("tab", { name: /app\.tsx/ }));

    expect(activateOpenFile).toHaveBeenCalledWith("src/app.tsx");

    fireEvent.click(within(tablist).getByRole("button", { name: "Close file findings.md" }));

    expect(closeOpenFilePath).toHaveBeenCalledWith("src/findings.md");
    expect(onClosePane).not.toHaveBeenCalled();
    expect(activateOpenFile).toHaveBeenCalledTimes(1);
  });

  it("marks dirty editor pane titles and confirms before closing dirty files", () => {
    const store = createStore();
    const onClosePane = vi.fn();
    const onSplitPane = vi.fn();

    mocks.mockUseCodeEditorActions.mockReturnValue(mocks.editorState);
    store.set(localeAtom, "en");
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-123", "pane-1")),
      "src/app.tsx"
    );
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

    const tablist = screen.getByRole("tablist", { name: "Open editor tabs" });
    const activeTab = within(tablist).getByRole("tab", { selected: true });

    expect(activeTab).toHaveTextContent("app.tsx");
    expect(activeTab).toHaveClass("code-editor-tab--dirty");
    expect(activeTab.querySelector(".code-editor-tab__dirty-indicator")).toBeTruthy();
    expect(screen.getByText("modified · Unsaved changes")).toHaveClass("code-editor-path__state");

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

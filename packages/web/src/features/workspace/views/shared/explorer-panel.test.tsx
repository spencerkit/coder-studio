// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { activeFilePathAtomFamily, fileTreeAtomFamily, openFilesAtomFamily } from "../../atoms";
import { ExplorerPanel } from "./explorer-panel";

const fileTreePanelSpy = vi.fn();

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      "workspace.sidebar.explorer": "Explorer",
      "workspace.sidebar.workspace": "Workspace",
      "workspace.sidebar.open_editors": "Open Files",
      "workspace.sidebar.workspace_expand_label": "Expand Workspace",
      "workspace.sidebar.workspace_collapse_label": "Collapse Workspace",
      "file.new_file": "New File",
      "file.new_folder": "New Folder",
      "file.collapse_all": "Collapse All",
      "action.close": "Close",
      "action.close_all": "Close all",
    };

    if (key === "workspace.open_editors.title_with_count") {
      return `${params?.title ?? "Open Files"} (${params?.count ?? 0})`;
    }

    if (key === "workspace.open_editors.expand_label") {
      return "Expand Open Files";
    }

    if (key === "workspace.open_editors.collapse_label") {
      return "Collapse Open Files";
    }

    if (key === "workspace.open_editors.close_path") {
      return `Close ${params?.path ?? ""}`.trim();
    }

    return translations[key] ?? key;
  },
}));

vi.mock("../shared/file-tree-panel", () => ({
  FileTreePanel: (props: unknown) => {
    fileTreePanelSpy(props);
    return <div data-testid="file-tree-panel" />;
  },
}));

describe("ExplorerPanel", () => {
  it("renders without a runtime Explorer panel header and keeps file actions in the Workspace section", () => {
    const onOpenFileCreate = vi.fn();
    const onOpenFolderCreate = vi.fn();
    const store = createStore();
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(openFilesAtomFamily("ws-test"), {});

    const { container } = render(
      <Provider store={store}>
        <ExplorerPanel
          workspaceId="ws-test"
          createRequest={null}
          onCreateRequestConsumed={vi.fn()}
          onOpenFileCreate={onOpenFileCreate}
          onOpenFolderCreate={onOpenFolderCreate}
        />
      </Provider>
    );

    expect(fileTreePanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collapseVersion: 0,
        showSearch: false,
        variant: "desktop",
      })
    );

    const stackedBody = container.querySelector(".workspace-sidebar-panel__body--stacked");

    expect(screen.queryByText("Explorer")).toBeNull();
    expect(stackedBody).not.toBeNull();
    expect(stackedBody?.querySelectorAll(".workspace-sidebar-section")).toHaveLength(2);
    expect(stackedBody?.querySelector(".panel-header")).toBeNull();

    const workspaceSection = screen
      .getByRole("heading", { level: 2, name: "Workspace" })
      .closest("section") as HTMLElement;

    fireEvent.click(within(workspaceSection).getByRole("button", { name: "New File" }));
    fireEvent.click(within(workspaceSection).getByRole("button", { name: "New Folder" }));
    fireEvent.click(within(workspaceSection).getByRole("button", { name: "Collapse All" }));

    expect(onOpenFileCreate).toHaveBeenCalledTimes(1);
    expect(onOpenFolderCreate).toHaveBeenCalledTimes(1);
    expect(fileTreePanelSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({
        collapseVersion: 1,
      })
    );
  });

  it("renders the active open editor with the shared selected row contract", () => {
    const store = createStore();
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(activeFilePathAtomFamily("ws-test"), "src/alpha.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/alpha.tsx": {
        kind: "text",
        path: "src/alpha.tsx",
        content: "export const alpha = 1;\n",
        savedContent: "export const alpha = 1;\n",
        baseHash: "base-alpha",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <ExplorerPanel
          workspaceId="ws-test"
          createRequest={null}
          onCreateRequestConsumed={vi.fn()}
          onOpenFileCreate={vi.fn()}
          onOpenFolderCreate={vi.fn()}
        />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "src/alpha.tsx" })).toHaveClass(
      "workspace-sidebar-row",
      "workspace-sidebar-row--selected"
    );
  });

  it("toggles the workspace section body from the section chevron control", () => {
    const store = createStore();
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(openFilesAtomFamily("ws-test"), {});

    render(
      <Provider store={store}>
        <ExplorerPanel
          workspaceId="ws-test"
          createRequest={null}
          onCreateRequestConsumed={vi.fn()}
          onOpenFileCreate={vi.fn()}
          onOpenFolderCreate={vi.fn()}
        />
      </Provider>
    );

    const workspaceSection = screen
      .getByRole("heading", { level: 2, name: "Workspace" })
      .closest("section") as HTMLElement;
    const toggle = within(workspaceSection).getByRole("button", {
      name: "Collapse Workspace",
    });

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(workspaceSection).getByTestId("file-tree-panel")).toBeInTheDocument();

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(within(workspaceSection).queryByTestId("file-tree-panel")).toBeNull();

    fireEvent.click(
      within(workspaceSection).getByRole("button", {
        name: "Expand Workspace",
      })
    );

    expect(within(workspaceSection).getByTestId("file-tree-panel")).toBeInTheDocument();
  });

  it("re-expands the workspace section before forwarding create actions", () => {
    const onOpenFileCreate = vi.fn();
    const store = createStore();
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(openFilesAtomFamily("ws-test"), {});

    render(
      <Provider store={store}>
        <ExplorerPanel
          workspaceId="ws-test"
          createRequest={null}
          onCreateRequestConsumed={vi.fn()}
          onOpenFileCreate={onOpenFileCreate}
          onOpenFolderCreate={vi.fn()}
        />
      </Provider>
    );

    const workspaceSection = screen
      .getByRole("heading", { level: 2, name: "Workspace" })
      .closest("section") as HTMLElement;

    fireEvent.click(
      within(workspaceSection).getByRole("button", {
        name: "Collapse Workspace",
      })
    );

    expect(within(workspaceSection).queryByTestId("file-tree-panel")).toBeNull();

    fireEvent.click(within(workspaceSection).getByRole("button", { name: "New File" }));

    expect(onOpenFileCreate).toHaveBeenCalledTimes(1);
    expect(
      within(workspaceSection).getByRole("button", {
        name: "Collapse Workspace",
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(within(workspaceSection).getByTestId("file-tree-panel")).toBeInTheDocument();
  });
});

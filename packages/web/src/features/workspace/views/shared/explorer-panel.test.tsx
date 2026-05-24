// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { fileTreeAtomFamily, openFilesAtomFamily } from "../../atoms";
import { ExplorerPanel } from "./explorer-panel";

const fileTreePanelSpy = vi.fn();

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      "workspace.sidebar.explorer": "Explorer",
      "workspace.sidebar.workspace": "Workspace",
      "workspace.sidebar.open_editors": "Open Editors",
      "file.new_file": "New File",
      "file.new_folder": "New Folder",
      "file.collapse_all": "Collapse All",
      "action.close": "Close",
      "action.close_all": "Close all",
    };

    if (key === "workspace.open_editors.title_with_count") {
      return `${params?.title ?? "Open Editors"} (${params?.count ?? 0})`;
    }

    if (key === "workspace.open_editors.expand_label") {
      return "Expand Open Editors";
    }

    if (key === "workspace.open_editors.collapse_label") {
      return "Collapse Open Editors";
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
  it("keeps the panel header for Explorer and moves file actions into the Workspace section", () => {
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

    const explorerHeader = screen.getByText("Explorer").closest(".panel-header") as HTMLElement;
    expect(within(explorerHeader).queryByRole("button", { name: "New File" })).toBeNull();
    expect(container.querySelector(".workspace-sidebar-panel__actions")).not.toBe(
      explorerHeader.querySelector(".workspace-sidebar-panel__actions")
    );

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
});

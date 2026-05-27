import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import type { GitDiffPreview } from "../../atoms";
import { MobileFilesSheet } from "./mobile-files-sheet";

const mobileExplorerPanelSpy = vi.fn();

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      "mobile.files.tabs": "Files tabs",
      "workspace.sidebar.explorer": "Explorer",
      "workspace.sidebar.search": "Search",
      "workspace.sidebar.source_control": "Source Control",
      "file.new_file": "New File",
      "file.new_folder": "New Folder",
      "file.collapse_all": "Collapse All",
      "common.loading": "Loading",
    };

    return translations[key] ?? key;
  },
}));

vi.mock("../../../code-editor/views/shared/code-editor-host", () => ({
  CodeEditorHost: () => <div data-testid="code-editor-host" />,
}));

vi.mock("./mobile-explorer-panel", () => ({
  MobileExplorerPanel: (props: unknown) => {
    mobileExplorerPanelSpy(props);
    return <div className="mobile-explorer-panel" data-testid="mobile-explorer-panel" />;
  },
}));

vi.mock("../shared/search-panel", () => ({
  SearchPanel: ({ variant }: { variant?: string }) => (
    <div data-testid="search-panel" data-variant={variant} />
  ),
}));

vi.mock("../shared/git-panel", () => ({
  GitPanel: ({ onPreviewOpen }: { onPreviewOpen?: (preview: GitDiffPreview) => void }) => (
    <button
      type="button"
      data-testid="git-panel"
      onClick={() =>
        onPreviewOpen?.({
          path: "abc123",
          title: "abc123 · commit subject",
          diff: "diff --git a/src/app.tsx b/src/app.tsx",
          source: "commit",
        })
      }
    >
      git-panel
    </button>
  ),
}));

describe("MobileFilesSheet", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mobileExplorerPanelSpy.mockReset();
  });

  it("renders three icon tabs and keeps explorer actions inside the explorer content", () => {
    const { container } = render(
      <Provider store={createStore()}>
        <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeView="explorer" />
      </Provider>
    );

    expect(screen.getByRole("tab", { name: "Explorer" })).toHaveClass(
      "mobile-files-sheet__segment",
      "active"
    );
    const content = container.querySelector(".mobile-files-sheet__content");

    expect(container.querySelector(".mobile-files-sheet__segmented")).not.toBeNull();
    expect(content).not.toBeNull();
    expect(content?.querySelector(".mobile-explorer-panel")).not.toBeNull();
    expect(screen.getByRole("tab", { name: "Search" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Source Control" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New File" })).toBeNull();
    expect(screen.getByTestId("mobile-explorer-panel")).toBeInTheDocument();
  });

  it("keeps the mobile files root on segmented navigation plus flush content only", () => {
    const { container } = render(
      <Provider store={createStore()}>
        <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeView="explorer" />
      </Provider>
    );

    expect(container.querySelector(".mobile-files-sheet__segmented")).toBeTruthy();
    expect(container.querySelector(".mobile-files-sheet__content")).toBeTruthy();
    expect(container.querySelector(".mobile-files-sheet__header")).toBeNull();
  });

  it("renders the mobile search panel without explorer actions when Search is active", () => {
    render(
      <Provider store={createStore()}>
        <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeView="search" />
      </Provider>
    );

    expect(screen.queryByRole("button", { name: "New File" })).toBeNull();
    expect(screen.getByTestId("search-panel")).toHaveAttribute("data-variant", "mobile");
  });

  it("passes workspace action callbacks through to the explorer content", () => {
    const onCreateFile = vi.fn();
    const onCreateFolder = vi.fn();
    const onCollapseAll = vi.fn();

    render(
      <Provider store={createStore()}>
        <MobileFilesSheet
          workspaceId="ws-test"
          route={{ kind: "root" }}
          activeView="explorer"
          collapseVersion={7}
          onCreateFile={onCreateFile}
          onCreateFolder={onCreateFolder}
          onCollapseAll={onCollapseAll}
        />
      </Provider>
    );

    expect(mobileExplorerPanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collapseVersion: 7,
        onCollapseAll,
        onOpenFileCreate: onCreateFile,
        onOpenFolderCreate: onCreateFolder,
        workspaceId: "ws-test",
      })
    );
  });

  it("uses one file detail surface for preview edit and diff instead of separate editor and diff pages", () => {
    render(
      <Provider store={createStore()}>
        <MobileFilesSheet
          workspaceId="ws-test"
          route={{ kind: "detail", path: "src/app.tsx" }}
          activeView="explorer"
        />
      </Provider>
    );

    expect(screen.getByTestId("code-editor-host")).toBeInTheDocument();
    expect(screen.queryByTestId("git-diff-viewer")).not.toBeInTheDocument();
  });

  it("navigates into the unified detail surface for commit-history diff previews too", () => {
    const handleRouteChange = vi.fn();

    render(
      <Provider store={createStore()}>
        <MobileFilesSheet
          workspaceId="ws-test"
          route={{ kind: "root" }}
          activeView="source-control"
          onRouteChange={handleRouteChange}
        />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "git-panel" }));

    expect(handleRouteChange).toHaveBeenCalledWith({
      kind: "detail",
      path: "abc123",
      title: "abc123 · commit subject",
    });
  });
});

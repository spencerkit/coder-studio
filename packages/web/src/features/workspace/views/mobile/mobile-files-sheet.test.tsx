import { fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import type { GitDiffPreview } from "../../atoms";
import { MobileFilesSheet } from "./mobile-files-sheet";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string) => {
    const translations: Record<string, string> = {
      "mobile.files.tabs": "Files tabs",
      "file.title": "Files",
      "label.git": "Git",
      "action.search_files": "Search files",
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

vi.mock("../shared/file-tree-panel", () => ({
  FileTreePanel: () => (
    <div data-testid="file-tree-panel">
      <input aria-label="Search files" role="searchbox" />
    </div>
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
  });

  it("renders file actions in the tab row instead of a separate dock", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: "/workspace",
      children: [],
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeTab="files" />
      </Provider>
    );

    const newFileButton = await screen.findByRole("button", { name: "New File" });
    const searchInput = await screen.findByRole("searchbox", { name: "Search files" });

    expect(document.querySelector(".mobile-files-sheet__dock")).toBeNull();
    expect(document.querySelector(".file-tree-mobile-actions")).toBeNull();
    expect(newFileButton.closest(".mobile-files-sheet__tab-actions")).not.toBeNull();
    expect(
      newFileButton.compareDocumentPosition(searchInput) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(searchInput).toBeInTheDocument();
  });

  it("uses the mobile segmented tab styling without legacy panel-tab classes", () => {
    render(
      <Provider store={createStore()}>
        <MobileFilesSheet workspaceId="ws-test" route={{ kind: "root" }} activeTab="git" />
      </Provider>
    );

    const filesTab = screen.getByRole("tab", { name: "Files" });
    const gitTab = screen.getByRole("tab", { name: "Git" });

    expect(filesTab).toHaveClass("mobile-files-sheet__segment");
    expect(filesTab).not.toHaveClass("panel-tab");
    expect(gitTab).toHaveClass("mobile-files-sheet__segment", "active");
    expect(gitTab).not.toHaveClass("panel-tab");
  });

  it("uses one file detail surface for preview edit and diff instead of separate editor and diff pages", () => {
    render(
      <Provider store={createStore()}>
        <MobileFilesSheet
          workspaceId="ws-test"
          route={{ kind: "detail", path: "src/app.tsx" }}
          activeTab="files"
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
          activeTab="git"
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

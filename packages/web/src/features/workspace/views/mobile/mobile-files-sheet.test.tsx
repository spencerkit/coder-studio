import { render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
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

vi.mock("../shared/git-diff-viewer", () => ({
  GitDiffViewer: () => <div data-testid="git-diff-viewer" />,
}));

vi.mock("../shared/git-panel", () => ({
  GitPanel: () => <div data-testid="git-panel" />,
}));

vi.mock("../../actions/use-git-actions", () => ({
  useGitDiffViewerActions: () => ({
    closePreview: vi.fn(),
  }),
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
});

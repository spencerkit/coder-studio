// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { activeFilePathAtomFamily, fileTreeAtomFamily, openFilesAtomFamily } from "../../atoms";
import { MobileExplorerPanel } from "./mobile-explorer-panel";

const fileTreePanelSpy = vi.fn();

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      "workspace.quick_jump.title": "Quick Jump",
      "workspace.quick_jump.placeholder": "Type a filename or path",
      "workspace.quick_jump.no_results": "No results",
      "workspace.quick_jump.failed": "Search failed",
      "workspace.sidebar.workspace": "Workspace",
      "workspace.sidebar.open_editors": "Open Editors",
      "file.new_file": "New File",
      "file.new_folder": "New Folder",
      "file.collapse_all": "Collapse All",
      "action.close": "Close",
      "action.close_all": "Close all",
      "common.loading": "Loading",
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

describe("MobileExplorerPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    fileTreePanelSpy.mockReset();
  });

  it("renders quick jump above open editors and a file tree without the embedded tree search", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        return {
          files: [
            { path: "README.md", name: "README.md", kind: "file" },
            {
              path: "src/mobile-files-sheet.tsx",
              name: "mobile-files-sheet.tsx",
              kind: "file",
            },
          ].filter((file) => file.path.toLowerCase().includes((args.query ?? "").toLowerCase())),
        };
      }

      return { ok: true };
    });

    const onSelectFile = vi.fn();
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(activeFilePathAtomFamily("ws-test"), "src/mobile-files-sheet.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "README.md": {
        kind: "text",
        path: "README.md",
        content: "# docs",
        savedContent: "# docs",
        baseHash: "base-readme",
        isDirty: false,
      },
      "src/mobile-files-sheet.tsx": {
        kind: "text",
        path: "src/mobile-files-sheet.tsx",
        content: "export function MobileFilesSheet() {}\n",
        savedContent: "export function MobileFilesSheet() {}\n",
        baseHash: "base-mobile-files-sheet",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <MobileExplorerPanel
          workspaceId="ws-test"
          routeToDetail={onSelectFile}
          collapseVersion={0}
        />
      </Provider>
    );

    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings[0]).toHaveTextContent(/Quick Jump|快速跳转/i);
    expect(headings[1]).toHaveTextContent(/Open Editors|打开的编辑器/i);
    expect(headings[2]).toHaveTextContent(/Workspace|工作区/i);

    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/mobile-files-sheet.tsx" })).toHaveClass(
      "workspace-open-editors__item--active"
    );
    const quickJumpSearch = screen.getByRole("searchbox", { name: /Quick Jump|快速跳转/i });
    expect(quickJumpSearch).toBeInTheDocument();
    expect(quickJumpSearch.closest("label")).toHaveClass("workspace-sidebar-control");
    expect(
      screen.getByPlaceholderText(/Type a filename or path|输入文件名或路径/i)
    ).toBeInTheDocument();
    expect(screen.queryByRole("searchbox", { name: /Search Files|搜索文件/i })).toBeNull();
    expect(fileTreePanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        variant: "mobile",
        showSearch: false,
      })
    );

    fireEvent.change(quickJumpSearch, {
      target: { value: "read" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "file.search",
      {
        workspaceId: "ws-test",
        query: "read",
        limit: 10,
      },
      undefined
    );

    fireEvent.click(
      within(screen.getByText(/Quick Jump|快速跳转/i).closest("section") as HTMLElement).getByRole(
        "button",
        {
          name: /README\.md/i,
        }
      )
    );

    expect(onSelectFile).toHaveBeenCalledWith("README.md");
  });

  it("renders shared open editor controls on mobile and closing the active row exits editor focus", () => {
    const onSelectFile = vi.fn();
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
      "src/beta.tsx": {
        kind: "text",
        path: "src/beta.tsx",
        content: "export const beta = 2;\n",
        savedContent: "export const beta = 2;\n",
        baseHash: "base-beta",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <MobileExplorerPanel
          workspaceId="ws-test"
          routeToDetail={onSelectFile}
          collapseVersion={0}
        />
      </Provider>
    );

    const heading = screen.getByRole("heading", { level: 2, name: /(Open Editors|打开的编辑器)/i });
    expect(heading).toHaveTextContent(/(Open Editors|打开的编辑器)\s*\(2\)/i);

    const section = heading.closest("section") as HTMLElement;

    expect(
      within(section).getByRole("button", {
        name: /Collapse Open Editors|Expand Open Editors|收起打开的编辑器|展开打开的编辑器/i,
      })
    ).toHaveAttribute("aria-expanded", "true");
    expect(
      within(section).getByRole("button", { name: /Close all|全部关闭/i })
    ).toBeInTheDocument();
    expect(within(section).getByRole("button", { name: "src/alpha.tsx" })).toHaveClass(
      "workspace-open-editors__item--active"
    );

    const activeRow = within(section)
      .getByRole("button", { name: "src/alpha.tsx" })
      .closest(".workspace-open-editors__row") as HTMLElement;
    fireEvent.click(
      within(activeRow).getByRole("button", {
        name: /Close src\/alpha\.tsx|关闭 src\/alpha\.tsx/i,
      })
    );

    expect(within(section).getByRole("button", { name: "src/beta.tsx" })).not.toHaveClass(
      "workspace-open-editors__item--active"
    );
    expect(within(section).queryByRole("button", { name: "src/alpha.tsx" })).toBeNull();
    expect(heading).toHaveTextContent(/(Open Editors|打开的编辑器)\s*\(1\)/i);
    expect(Object.keys(store.get(openFilesAtomFamily("ws-test")))).toEqual(["src/beta.tsx"]);
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(onSelectFile).not.toHaveBeenCalled();
  });

  it("renders workspace actions inside the Workspace section and wires mobile callbacks", () => {
    const onOpenFileCreate = vi.fn();
    const onOpenFolderCreate = vi.fn();
    const onCollapseAll = vi.fn();
    const store = createStore();
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(openFilesAtomFamily("ws-test"), {});

    render(
      <Provider store={store}>
        <MobileExplorerPanel
          workspaceId="ws-test"
          routeToDetail={vi.fn()}
          collapseVersion={3}
          onOpenFileCreate={onOpenFileCreate}
          onOpenFolderCreate={onOpenFolderCreate}
          onCollapseAll={onCollapseAll}
        />
      </Provider>
    );

    expect(fileTreePanelSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        collapseVersion: 3,
        showSearch: false,
        variant: "mobile",
      })
    );

    const workspaceSection = screen
      .getByRole("heading", { level: 2, name: "Workspace" })
      .closest("section") as HTMLElement;

    fireEvent.click(within(workspaceSection).getByRole("button", { name: "New File" }));
    fireEvent.click(within(workspaceSection).getByRole("button", { name: "New Folder" }));
    fireEvent.click(within(workspaceSection).getByRole("button", { name: "Collapse All" }));

    expect(onOpenFileCreate).toHaveBeenCalledTimes(1);
    expect(onOpenFolderCreate).toHaveBeenCalledTimes(1);
    expect(onCollapseAll).toHaveBeenCalledTimes(1);
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { WORKSPACE_PATH_DRAG_MIME } from "../../../../lib/workspace-path-drag";
import { pendingEditorNavigationAtomFamily } from "../../../code-editor/atoms";
import {
  activeFilePathAtomFamily,
  expandedDirsAtomFamily,
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  loadedDirsAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { FileTreePanel } from "./file-tree-panel";

const { copyTextWithFallbackMock } = vi.hoisted(() => ({
  copyTextWithFallbackMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../../../lib/clipboard", () => ({
  copyTextWithFallback: copyTextWithFallbackMock,
}));

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (key === "file.delete_confirm") {
      return `Are you sure you want to delete "${params?.name ?? ""}"?`;
    }
    if (key === "mobile.sheet.region") {
      return `${params?.title ?? ""} sheet`;
    }
    if (key === "action.cancel") return "Cancel";
    if (key === "action.confirm") return "Confirm";
    return key;
  },
}));

function createDragDataTransfer() {
  const values = new Map<string, string>();
  const dataTransfer = {
    effectAllowed: "none",
    setData: vi.fn((type: string, value: string) => {
      values.set(type, value);
    }),
  } as unknown as DataTransfer;

  return { dataTransfer, values };
}

describe("FileTreePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    copyTextWithFallbackMock.mockReset();
    copyTextWithFallbackMock.mockResolvedValue(undefined);
  });

  it("clears the stale flag after reloading the file tree for an fs.dirty event", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: "/workspace",
      children: [
        {
          path: "src",
          name: "src",
          kind: "dir",
          children: [],
        },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
            },
          ],
        ],
      ])
    );
    store.set(fileTreeStaleAtomFamily("ws-test"), true);

    const { container } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(document.querySelector(".file-tree-shell.file-tree-shell--desktop")).toBeTruthy();

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(store.get(fileTreeStaleAtomFamily("ws-test"))).toBe(false);
    });

    expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
          ],
        ],
      ])
    );
  });

  it("persists pruned expanded directories after a stale refresh removes them", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { uiState?: Record<string, unknown> }) => {
        if (op === "workspace.uiState.set") {
          return {
            id: "ws-test",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: args?.uiState,
          };
        }

        return {
          path: "/workspace",
          children: [{ path: "docs", name: "docs", kind: "dir", isGitIgnored: false }],
        };
      });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          fileTreeExpandedDirs: ["src"],
        },
      },
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [".", [{ path: "src", name: "src", kind: "dir", isGitIgnored: false }]],
        ["src", [{ path: "src/index.ts", name: "index.ts", kind: "file", isGitIgnored: false }]],
      ])
    );
    store.set(expandedDirsAtomFamily("ws-test"), new Set(["src"]));
    store.set(loadedDirsAtomFamily("ws-test"), new Set(["src"]));
    store.set(fileTreeStaleAtomFamily("ws-test"), true);

    const { container } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(Array.from(store.get(expandedDirsAtomFamily("ws-test")) ?? [])).toEqual([]);
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-test",
        uiState: expect.objectContaining({ fileTreeExpandedDirs: [] }),
      }),
      undefined
    );
  });

  it("consumes a refresh token only once instead of reloading on every render", async () => {
    let resolveTree: ((value: { path: string; children: never[] }) => void) | null = null;
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveTree = resolve;
        })
    );
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
            },
          ],
        ],
      ])
    );

    const { rerender } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" refreshToken={0} />
      </Provider>
    );

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" refreshToken={1} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
      expect(sendCommand).toHaveBeenCalledWith(
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await act(async () => {
      resolveTree?.({
        path: "/workspace",
        children: [],
      });
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(1);
    });
  });

  it("restores expanded directories from workspace ui state", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          fileTreeExpandedDirs: ["src"],
        },
      },
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [".", [{ path: "src", name: "src", kind: "dir" }]],
        ["src", [{ path: "src/index.ts", name: "index.ts", kind: "file" }]],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByText("index.ts")).toBeInTheDocument();
    expect(Array.from(store.get(expandedDirsAtomFamily("ws-test")) ?? [])).toEqual(["src"]);
  });

  it("keeps fallback auto-expand disabled when persisted expansion is explicitly empty", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          fileTreeExpandedDirs: [],
        },
      },
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [".", [{ path: "src", name: "src", kind: "dir" }]],
        ["src", [{ path: "src/index.ts", name: "index.ts", kind: "file" }]],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
  });

  it("keeps default root auto-expand when fileTreeExpandedDirs is still undefined", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
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
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [".", [{ path: "src", name: "src", kind: "dir" }]],
        ["src", [{ path: "src/index.ts", name: "index.ts", kind: "file" }]],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByText("index.ts")).toBeInTheDocument();
    expect(store.get(expandedDirsAtomFamily("ws-test"))).toBeNull();
  });

  it("preserves default root expansion when the user first expands a non-default directory", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { subPath?: string }) => {
        if (op === "workspace.uiState.set") {
          return {
            id: "ws-test",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: args?.uiState,
          };
        }

        if (args?.subPath === "src") {
          return {
            path: "src",
            children: [{ path: "src/index.ts", name: "index.ts", kind: "file" }],
          };
        }

        if (args?.subPath === "lib") {
          return {
            path: "lib",
            children: [{ path: "lib/foo.ts", name: "foo.ts", kind: "file" }],
          };
        }

        return {
          path: "/workspace",
          children: [
            { path: "lib", name: "lib", kind: "dir" },
            { path: "src", name: "src", kind: "dir" },
          ],
        };
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
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
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "lib",
              name: "lib",
              kind: "dir",
            },
            {
              path: "src",
              name: "src",
              kind: "dir",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByText("lib"));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "workspace.uiState.set",
        expect.objectContaining({
          workspaceId: "ws-test",
          uiState: expect.objectContaining({
            fileTreeExpandedDirs: expect.arrayContaining(["lib", "src"]),
          }),
        }),
        undefined
      );
    });

    expect(Array.from(store.get(expandedDirsAtomFamily("ws-test")) ?? [])).toEqual(["lib", "src"]);
  });

  it("reloads the file tree after creating a file from the toolbar", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: "/workspace",
        children: [
          {
            path: "src/demo/new-file.ts",
            name: "new-file.ts",
            kind: "file",
          },
        ],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel
          workspaceId="ws-test"
          createRequest={{ id: 1, mode: "file", baseDir: null }}
        />
      </Provider>
    );

    const pathInput = await screen.findByLabelText("file.path");
    expect(pathInput).toHaveClass("input");

    fireEvent.change(pathInput, {
      target: { value: "src/demo/new-file.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.create",
        {
          workspaceId: "ws-test",
          path: "src/demo/new-file.ts",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(
        new Map([
          [
            ".",
            [
              {
                path: "src/demo/new-file.ts",
                name: "new-file.ts",
                kind: "file",
              },
            ],
          ],
        ])
      );
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/demo/new-file.ts");
  });

  it("reloads the file tree after creating a folder from a directory action", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: "/workspace",
        children: [
          {
            path: "src",
            name: "src",
            kind: "dir",
            children: [
              {
                path: "src/demo",
                name: "demo",
                kind: "dir",
                children: [],
              },
            ],
          },
        ],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "file.new_folder src" }));

    const input = await screen.findByLabelText("file.path");
    expect(input).toHaveValue("src/");

    fireEvent.change(input, { target: { value: "src/demo" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.mkdir",
        {
          workspaceId: "ws-test",
          path: "src/demo",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(
        new Map([
          [
            ".",
            [
              {
                path: "src",
                name: "src",
                kind: "dir",
                children: [
                  {
                    path: "src/demo",
                    name: "demo",
                    kind: "dir",
                    children: [],
                  },
                ],
              },
            ],
          ],
        ])
      );
    });
  });

  it("keeps the selected desktop tree row on the shared row hook without restoring the embedded search field", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [
                {
                  path: "src/index.ts",
                  name: "index.ts",
                  kind: "file",
                },
              ],
            },
          ],
        ],
      ])
    );
    store.set(activeFilePathAtomFamily("ws-test"), "src/index.ts");

    const { container } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" showSearch={false} />
      </Provider>
    );

    const selectedRow = container.querySelector(".file-tree-shell--desktop .tree-item.selected");
    expect(selectedRow).toHaveClass("workspace-sidebar-row", "workspace-sidebar-row--selected");
    expect(
      screen.queryByRole("searchbox", { name: /Search Files|搜索文件/i })
    ).not.toBeInTheDocument();
    expect(container.querySelector(".file-tree-search")).toBeNull();
  });

  it("does not render a leading tree chevron for file rows", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/index.ts",
              name: "index.ts",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" showSearch={false} />
      </Provider>
    );

    const row = screen.getByText("index.ts").closest(".tree-item") as HTMLElement;

    expect(row.querySelector(".tree-chevron")).toBeNull();
  });

  it("restores per-type icon tone classes for tree rows and search results", async () => {
    const searchFiles = [
      { path: "src/app.tsx", name: "app.tsx", kind: "file" },
      { path: "src/config.json", name: "config.json", kind: "file" },
      { path: "src/README.md", name: "README.md", kind: "file" },
      { path: "src/logo.svg", name: "logo.svg", kind: "file" },
      { path: "src/notes.bin", name: "notes.bin", kind: "file" },
    ];
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        const query = args.query?.toLowerCase() ?? "";
        return {
          files: searchFiles.filter((item) => item.name.toLowerCase().includes(query)),
        };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [
                { path: "src/app.tsx", name: "app.tsx", kind: "file" },
                { path: "src/config.json", name: "config.json", kind: "file" },
                { path: "src/README.md", name: "README.md", kind: "file" },
                { path: "src/logo.svg", name: "logo.svg", kind: "file" },
                { path: "src/notes.bin", name: "notes.bin", kind: "file" },
              ],
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const folderLabel = screen.getByText("src");
    expect(folderLabel.previousElementSibling).toHaveClass("tree-icon");
    expect(
      folderLabel.previousElementSibling?.querySelector('[data-icon-semantic="file.folder.open"]')
    ).toBeTruthy();

    await screen.findByText("app.tsx");

    expect(screen.getByText("app.tsx").previousElementSibling).toHaveClass("tree-icon");
    expect(
      screen
        .getByText("app.tsx")
        .previousElementSibling?.querySelector('[data-icon-semantic="file.type.code"]')
    ).toBeTruthy();
    expect(
      screen
        .getByText("config.json")
        .previousElementSibling?.querySelector('[data-icon-semantic="file.type.data"]')
    ).toBeTruthy();
    expect(
      screen
        .getByText("README.md")
        .previousElementSibling?.querySelector('[data-icon-semantic="file.type.doc"]')
    ).toBeTruthy();
    expect(
      screen
        .getByText("logo.svg")
        .previousElementSibling?.querySelector('[data-icon-semantic="file.type.media"]')
    ).toBeTruthy();
    expect(
      screen
        .getByText("notes.bin")
        .previousElementSibling?.querySelector('[data-icon-semantic="file.type.default"]')
    ).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "logo" },
    });

    const searchLabel = await screen.findByText("logo.svg");
    expect(searchLabel.closest(".tree-search-labels")?.previousElementSibling).toHaveClass(
      "tree-icon"
    );
    expect(
      searchLabel
        .closest(".tree-search-labels")
        ?.previousElementSibling?.querySelector('[data-icon-semantic="file.type.media"]')
    ).toBeTruthy();
  });

  it("adds a subdued class to gitignored nodes in the normal tree", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            { path: "ignored.log", name: "ignored.log", kind: "file", isGitIgnored: true },
            { path: "visible.ts", name: "visible.ts", kind: "file", isGitIgnored: false },
          ],
        ],
      ])
    );

    const { container } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByText("ignored.log")).toHaveClass("tree-label", "tree-label--gitignored");
    expect(screen.getByText("visible.ts")).toHaveClass("tree-label");
    expect(screen.getByText("visible.ts")).not.toHaveClass("tree-label--gitignored");
    expect(container.querySelectorAll(".tree-label--gitignored")).toHaveLength(1);
  });

  it("does not add the subdued class to search result rows", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.search") {
        return {
          files: [{ path: "ignored.log", name: "ignored.log", kind: "file", isGitIgnored: true }],
        };
      }

      return { path: "/workspace", children: [] };
    });

    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "ignored" },
    });

    const resultRow = await screen.findByText("ignored.log");
    expect(resultRow).toHaveClass("tree-label");
    expect(resultRow).not.toHaveClass("tree-label--gitignored");
  });

  it("opens the new file dialog from the toolbar and dispatches file.create", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ path: "/workspace", children: [] })
      .mockResolvedValueOnce({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel
          workspaceId="ws-test"
          createRequest={{ id: 1, mode: "file", baseDir: null }}
        />
      </Provider>
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("file.path")).toHaveClass("input");

    fireEvent.change(screen.getByLabelText("file.path"), {
      target: { value: "src/demo/new-file.ts" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.create",
        {
          workspaceId: "ws-test",
          path: "src/demo/new-file.ts",
        },
        undefined
      );
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/demo/new-file.ts");
  });

  it("does not create a file until the confirmation action is clicked", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel
          workspaceId="ws-test"
          createRequest={{ id: 1, mode: "file", baseDir: null }}
        />
      </Provider>
    );

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    const pathInput = screen.getByLabelText("file.path");
    expect(pathInput).toHaveClass("input");
    expect(pathInput).toHaveAttribute("placeholder", "src/demo/new-file.ts");

    fireEvent.change(pathInput, { target: { value: "src/demo/new-file.ts" } });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "file.create",
      {
        workspaceId: "ws-test",
        path: "src/demo/new-file.ts",
      },
      undefined
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "file.create",
      {
        workspaceId: "ws-test",
        path: "src/demo/new-file.ts",
      },
      undefined
    );
  });

  it("connects file create helper and error text to the shared input", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel
          workspaceId="ws-test"
          createRequest={{ id: 1, mode: "file", baseDir: null }}
        />
      </Provider>
    );

    const input = await screen.findByLabelText("file.path");
    const helper = screen.getByText("file.path_helper_file");

    expect(input).toHaveAttribute("aria-describedby", helper.id);
    expect(input).toHaveAttribute("aria-invalid", "false");
    expect(screen.getByRole("button", { name: "action.close" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm"
    );

    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    const error = await screen.findByRole("alert");

    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", `${helper.id} ${error.id}`);
  });

  it("opens the new folder dialog from a directory action and pre-fills the directory prefix", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "file.new_folder src" }));

    const input = await screen.findByLabelText("file.path");
    expect(input).toHaveValue("src/");

    fireEvent.change(input, { target: { value: "src/demo/new-dir" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.mkdir",
        {
          workspaceId: "ws-test",
          path: "src/demo/new-dir",
        },
        undefined
      );
    });
  });

  it("opens the new folder dialog on the first click from a directory action", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "file.new_folder src" }));

    expect(await screen.findByLabelText("file.path")).toHaveClass("input");
  });

  it("renders file dialog actions with shared button compatibility classes", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel
          workspaceId="ws-test"
          createRequest={{ id: 1, mode: "file", baseDir: null }}
        />
      </Provider>
    );

    await screen.findByLabelText("file.path");

    expect(screen.getByRole("button", { name: "Cancel" })).toHaveClass("btn", "btn-secondary");
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("btn", "btn-primary");
  });

  it("uses translated loading copy while the tree is still being fetched", async () => {
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // Keep the initial tree request pending so the loading state remains visible.
        })
    );
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const loadingStates = await screen.findAllByText("common.loading");
    expect(loadingStates.length).toBeGreaterThan(0);

    const loadingStateTitle = loadingStates[0];
    expect(loadingStateTitle?.tagName).toBe("P");

    const loadingShell = loadingStateTitle?.closest(".file-tree-empty");
    expect(loadingShell).not.toBeNull();
  });

  it("loads children for default-expanded root directories", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: "src",
      children: [
        {
          path: "src/index.ts",
          name: "index.ts",
          kind: "file",
        },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.readTree",
        {
          workspaceId: "ws-test",
          subPath: "src",
        },
        undefined
      );
    });

    expect(await screen.findByText("index.ts")).toBeInTheDocument();
  });

  it("collapses expanded directories when the external collapse trigger changes", () => {
    const store = createStore();
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args: { uiState?: Record<string, unknown> }) => {
        if (op === "workspace.uiState.set") {
          return {
            id: "ws-test",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: args.uiState,
          };
        }
        return { path: "/workspace", children: [] };
      });
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          fileTreeExpandedDirs: ["src"],
        },
      },
    } as never);
    store.set(expandedDirsAtomFamily("ws-test"), new Set(["src"]));
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
            },
          ],
        ],
        [
          "src",
          [
            {
              path: "src/index.ts",
              name: "index.ts",
              kind: "file",
            },
          ],
        ],
      ])
    );

    const { rerender } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" collapseVersion={0} />
      </Provider>
    );

    expect(screen.getByText("index.ts")).toBeInTheDocument();

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" collapseVersion={1} />
      </Provider>
    );

    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();
    expect(Array.from(store.get(expandedDirsAtomFamily("ws-test")) ?? [])).toEqual([]);
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-test",
        uiState: expect.objectContaining({ fileTreeExpandedDirs: [] }),
      }),
      undefined
    );
  });

  it("uses translated empty-directory copy for expanded folders with no children", () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const emptyDirectoryState = screen.getByText("file.empty_directory");

    expect(emptyDirectoryState.tagName).toBe("P");
    expect(emptyDirectoryState.closest(".tree-empty-hint")).toBeTruthy();
  });

  it("uses translated loading copy for expanded folders while children are still loading", async () => {
    const sendCommand = vi.fn().mockImplementation(
      () =>
        new Promise(() => {
          // Keep the directory request pending so the inline loading state remains visible.
        })
    );
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "docs",
              name: "docs",
              kind: "dir",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByText("docs"));

    const loadingState = await screen.findByText("common.loading");

    expect(loadingState.tagName).toBe("P");
    expect(loadingState.closest(".tree-loading")).toBeTruthy();
  });

  it("filters loaded files by fuzzy filename search", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        const query = args.query?.toLowerCase() ?? "";
        const files = [
          { path: "README.md", name: "README.md", kind: "file" },
          { path: "src/AppController.tsx", name: "AppController.tsx", kind: "file" },
          { path: "src/button.tsx", name: "button.tsx", kind: "file" },
        ].filter((item) => item.name.toLowerCase().includes(query));

        return { files };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const searchInput = screen.getByPlaceholderText("action.search_files");
    fireEvent.change(searchInput, { target: { value: "app" } });

    expect(await screen.findByText("AppController.tsx")).toBeInTheDocument();
    expect(screen.queryByText("button.tsx")).not.toBeInTheDocument();
    expect(screen.queryByText("README.md")).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: "read" } });

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("AppController.tsx")).not.toBeInTheDocument();
  });

  it("restores file search state per workspace tab instance", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        const query = args.query?.toLowerCase() ?? "";
        const files = [
          { path: "README.md", name: "README.md", kind: "file" },
          { path: "src/AppController.tsx", name: "AppController.tsx", kind: "file" },
          { path: "src/button.tsx", name: "button.tsx", kind: "file" },
        ].filter((item) => item.name.toLowerCase().includes(query));

        return { files };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    const { rerender } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-a" />
      </Provider>
    );

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "app" },
    });

    expect(await screen.findByText("AppController.tsx")).toBeInTheDocument();

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-b" />
      </Provider>
    );

    expect(await screen.findByPlaceholderText("action.search_files")).toHaveValue("");
    expect(screen.queryByText("AppController.tsx")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "read" },
    });

    expect(await screen.findByText("README.md")).toBeInTheDocument();
    expect(screen.queryByText("AppController.tsx")).toBeNull();

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-a" />
      </Provider>
    );

    expect(await screen.findByPlaceholderText("action.search_files")).toHaveValue("app");
    expect(await screen.findByText("AppController.tsx")).toBeInTheDocument();
    expect(screen.queryByText("README.md")).toBeNull();
  });

  it("renders the compact shared empty shell for search misses", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        const query = args.query?.toLowerCase() ?? "";
        const files = [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }].filter((item) =>
          item.name.toLowerCase().includes(query)
        );

        return { files };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "zzz" },
    });

    const emptyText = await screen.findByText("command.no_results");
    expect(emptyText.tagName).toBe("P");

    const emptyShell = emptyText.closest(".file-tree-empty");

    expect(emptyShell).not.toBeNull();
  });

  it("marks desktop search chrome and active rows with the polished desktop selectors", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({}) } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const desktopSearch = document.querySelector(
      ".file-tree-search.file-tree-search--desktop"
    ) as HTMLElement | null;
    const searchInput = screen.getByLabelText("action.search_files");
    const activeRow = screen.getByText("app.tsx").closest(".tree-item");

    expect(desktopSearch).toBeTruthy();
    expect(desktopSearch).toHaveClass("workspace-sidebar-control");
    expect(desktopSearch).toContainElement(searchInput);
    expect(activeRow).toHaveClass("selected");
    expect(activeRow?.querySelector(".tree-item-actions")).toBeTruthy();
  });

  it("shows a symlink badge for tree rows and search results", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "file.search") {
        return {
          files: [{ path: "src/linked.ts", name: "linked.ts", kind: "file", isSymlink: true }],
        };
      }

      return {};
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              isSymlink: true,
              children: [],
            },
          ],
        ],
      ])
    );

    const { container } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    const treeRow = screen.getByText("src").closest(".tree-item");
    expect(treeRow?.querySelector(".tree-symlink-badge")).toBeTruthy();

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "linked" },
    });

    await screen.findByText("linked.ts");
    const searchRow = screen.getByText("linked.ts").closest(".tree-item");
    expect(searchRow?.querySelector(".tree-symlink-badge")).toBeTruthy();
  });

  it("right-clicks a file row to open the custom menu and prevents the native menu", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );
    const onSelectFile = vi.fn();

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" onSelectFile={onSelectFile} />
      </Provider>
    );

    const row = screen.getByText("app.tsx").closest(".tree-item");
    expect(row).toBeTruthy();

    fireEvent.contextMenu(row!, { clientX: 90, clientY: 120 });
    expect(onSelectFile).toHaveBeenCalledWith("src/app.tsx");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");

    const menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    expect(menu).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: "Rename" })).toBeInTheDocument();
  });

  it("right-clicks a search result row to open the same custom menu", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        const query = args.query?.toLowerCase() ?? "";
        const files = [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }].filter((item) =>
          item.name.toLowerCase().includes(query)
        );

        return { files };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    const onSelectFile = vi.fn();

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" onSelectFile={onSelectFile} />
      </Provider>
    );

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "app" },
    });

    const searchRow = (await screen.findByText("app.tsx")).closest(".tree-item");
    expect(searchRow).toBeTruthy();

    fireEvent.contextMenu(searchRow!, { clientX: 120, clientY: 80 });
    expect(onSelectFile).toHaveBeenCalledWith("src/app.tsx");
    expect(
      await screen.findByRole("menu", { name: "file.context_menu_title" })
    ).toBeInTheDocument();
  });

  it("marks desktop search result rows draggable and writes workspace path drag data", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string, args: { query?: string }) => {
      if (op === "file.search") {
        const query = args.query?.toLowerCase() ?? "";
        const files = [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }].filter((item) =>
          item.name.toLowerCase().includes(query)
        );

        return { files };
      }

      return { ok: true };
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByPlaceholderText("action.search_files"), {
      target: { value: "app" },
    });

    const searchRow = (await screen.findByText("app.tsx")).closest(".tree-item");
    expect(searchRow).toHaveAttribute("draggable", "true");

    const { dataTransfer, values } = createDragDataTransfer();
    fireEvent.dragStart(searchRow!, { dataTransfer });

    expect(values.get(WORKSPACE_PATH_DRAG_MIME)).toBe(
      JSON.stringify({
        workspaceId: "ws-test",
        path: "src/app.tsx",
        kind: "file",
      })
    );
    expect(values.get("text/plain")).toBe("src/app.tsx");
  });

  it("opens the rename modal from the context menu and submits file.rename", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        path: "/workspace",
        children: [
          {
            path: "src/renamed.tsx",
            name: "renamed.tsx",
            kind: "file",
          },
        ],
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!, {
      clientX: 120,
      clientY: 80,
    });

    const menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Rename" }));

    const input = await screen.findByLabelText("file.rename_name");
    expect(input).toHaveValue("app.tsx");

    fireEvent.change(input, { target: { value: "renamed.tsx" } });
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.rename",
        {
          workspaceId: "ws-test",
          fromPath: "src/app.tsx",
          toPath: "src/renamed.tsx",
        },
        undefined
      );
    });
  });

  it("copies relative and absolute paths from the context menu", async () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({ ok: true }) } as never);
    store.set(workspacesAtom, {
      "ws-test": {
        id: "ws-test",
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
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!, {
      clientX: 120,
      clientY: 80,
    });

    let menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy Relative Path" }));
    expect(copyTextWithFallbackMock).toHaveBeenCalledWith("src/app.tsx");
    await waitFor(() => {
      expect(screen.queryByRole("menu", { name: "file.context_menu_title" })).toBeNull();
    });

    fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!, {
      clientX: 120,
      clientY: 80,
    });

    menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Copy Absolute Path" }));
    expect(copyTextWithFallbackMock).toHaveBeenCalledWith("/workspace/src/app.tsx");
  });

  it("opens a terminal from the context menu with root-vs-folder cwd behavior", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValue({
        ok: true,
        data: {
          id: "term-1",
          workspaceId: "ws-test",
          kind: "shell",
          alive: true,
          exitCode: null,
          title: "Shell",
        },
      })
      .mockImplementation(async (op: string, args: Record<string, unknown>) => {
        if (op === "terminal.create") {
          return {
            id: `${String(args.cwdPath ?? "root")}-terminal`,
            workspaceId: "ws-test",
            kind: "shell",
            alive: true,
            exitCode: null,
            title: "Shell",
          };
        }

        return { ok: true };
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
            {
              path: "README.md",
              name: "README.md",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("src").closest(".tree-item")!, {
      clientX: 80,
      clientY: 80,
    });
    let menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open in Terminal" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.create",
        expect.objectContaining({
          workspaceId: "ws-test",
          cwdPath: "src",
          themeBackground: expect.stringMatching(/^#[0-9a-fA-F]{6,8}$/),
        }),
        undefined
      );
    });

    fireEvent.contextMenu(screen.getByText("README.md").closest(".tree-item")!, {
      clientX: 80,
      clientY: 80,
    });
    menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Open in Terminal" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "terminal.create",
        expect.objectContaining({
          workspaceId: "ws-test",
          cwdPath: undefined,
          themeBackground: expect.stringMatching(/^#[0-9a-fA-F]{6,8}$/),
        }),
        undefined
      );
    });
  });

  it("shows desktop row-action visibility changes for file and folder rows", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({}) } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByRole("button", { name: "file.new_file src" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "file.new_folder src" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "file.delete src" })).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "file.delete src/app.tsx" })
    ).not.toBeInTheDocument();
  });

  it("routes file-tree selection through the shared editor navigation path", async () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({}) } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(await screen.findByText("app.tsx"));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    });

    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      source: "file-tree",
      requestId: expect.any(Number),
    });
    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      { kind: "file", path: "src/app.tsx", pinned: false },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([]);
  });

  it("pins a file tab when a file-tree row is double-clicked", async () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({}) } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.doubleClick(await screen.findByText("app.tsx"));

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    });

    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      { kind: "file", path: "src/app.tsx", pinned: true },
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual(["src/app.tsx"]);
  });

  it("keeps expanded directories populated after refreshing the file tree", async () => {
    let libReadCount = 0;
    const sendCommand = vi
      .fn()
      .mockImplementation(async (_op: string, args: { subPath?: string }) => {
        if (args.subPath === "lib") {
          libReadCount += 1;
          return {
            path: "lib",
            children: [
              {
                path: libReadCount === 1 ? "lib/old.ts" : "lib/new.ts",
                name: libReadCount === 1 ? "old.ts" : "new.ts",
                kind: "file",
              },
            ],
          };
        }

        return {
          path: ".",
          children: [
            {
              path: "lib",
              name: "lib",
              kind: "dir",
            },
          ],
        };
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "lib",
              name: "lib",
              kind: "dir",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByText("lib"));
    expect(await screen.findByText("old.ts")).toBeInTheDocument();

    act(() => {
      store.set(fileTreeStaleAtomFamily("ws-test"), true);
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });
    expect(await screen.findByText("new.ts")).toBeInTheDocument();
    expect(screen.queryByText("old.ts")).not.toBeInTheDocument();
  });

  it("restores expanded directories after switching away and back to a workspace", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (_op: string, args?: { subPath?: string }) => {
        if (args?.subPath === "src") {
          return {
            path: "src",
            children: [{ path: "src/index.ts", name: "index.ts", kind: "file" }],
          };
        }

        return {
          path: "/workspace",
          children: [{ path: "src", name: "src", kind: "dir" }],
        };
      });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/workspace-1",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          fileTreeExpandedDirs: ["src"],
        },
      },
      "ws-2": {
        id: "ws-2",
        path: "/workspace-2",
        targetRuntime: "native",
        openedAt: 2,
        lastActiveAt: 2,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
        },
      },
    } as never);
    store.set(
      fileTreeAtomFamily("ws-1"),
      new Map([[".", [{ path: "src", name: "src", kind: "dir" }]]])
    );
    store.set(
      fileTreeAtomFamily("ws-2"),
      new Map([[".", [{ path: "docs", name: "docs", kind: "dir" }]]])
    );

    const { rerender } = render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-1" />
      </Provider>
    );

    expect(await screen.findByText("index.ts")).toBeInTheDocument();
    expect(Array.from(store.get(expandedDirsAtomFamily("ws-1")) ?? [])).toEqual(["src"]);
    expect(Array.from(store.get(loadedDirsAtomFamily("ws-1")))).toEqual(["src"]);

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-2" />
      </Provider>
    );

    expect(screen.getByText("docs")).toBeInTheDocument();
    expect(screen.queryByText("index.ts")).not.toBeInTheDocument();

    store.set(
      fileTreeAtomFamily("ws-1"),
      new Map([[".", [{ path: "src", name: "src", kind: "dir" }]]])
    );

    rerender(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-1" />
      </Provider>
    );

    expect(await screen.findByText("index.ts")).toBeInTheDocument();
  });

  it("reloads the file tree after deleting a file from the context menu", async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      path: "/workspace",
      children: [],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!, {
      clientX: 100,
      clientY: 100,
    });
    const menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.delete",
        {
          workspaceId: "ws-test",
          path: "src/app.tsx",
        },
        { timeoutMs: 180_000 }
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(new Map([[".", []]]));
    });
  });

  it("confirms directory deletion and reloads the file tree from the context menu", async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({
      path: "/workspace",
      children: [],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src",
              name: "src",
              kind: "dir",
              children: [],
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("src").closest(".tree-item")!, {
      clientX: 100,
      clientY: 100,
    });
    const menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();
    expect(await screen.findByText('Are you sure you want to delete "src"?')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("btn", "btn-danger");
    expect(screen.getByRole("button", { name: "action.close" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm"
    );
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        1,
        "file.delete",
        {
          workspaceId: "ws-test",
          path: "src",
        },
        { timeoutMs: 180_000 }
      );
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenNthCalledWith(
        2,
        "file.readTree",
        {
          workspaceId: "ws-test",
        },
        undefined
      );
    });

    await waitFor(() => {
      expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(new Map([[".", []]]));
    });
  });

  it("confirms file deletion and removes the file from editor state", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );
    store.set(activeFilePathAtomFamily("ws-test"), "src/app.tsx");
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "export {}",
        savedContent: "export {}",
        baseHash: "hash",
        isDirty: false,
      },
      "src/other.ts": {
        kind: "text",
        path: "src/other.ts",
        content: "export const other = true",
        savedContent: "export const other = true",
        baseHash: "hash-2",
        isDirty: false,
      },
    });

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!, {
      clientX: 100,
      clientY: 100,
    });
    const menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(
      await screen.findByText('Are you sure you want to delete "app.tsx"?')
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "file.delete",
        {
          workspaceId: "ws-test",
          path: "src/app.tsx",
        },
        { timeoutMs: 180_000 }
      );
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(openFilesAtomFamily("ws-test"))).toEqual({
      "src/other.ts": {
        kind: "text",
        path: "src/other.ts",
        content: "export const other = true",
        savedContent: "export const other = true",
        baseHash: "hash-2",
        isDirty: false,
      },
    });
  });

  it("does not render a panel footer on mobile", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      path: "/workspace",
      children: [
        {
          path: "README.md",
          name: "README.md",
          kind: "file",
        },
      ],
    });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="mobile" />
      </Provider>
    );

    expect(screen.getByLabelText("action.search_files")).toBeInTheDocument();
    expect(document.querySelector(".git-panel-status-strip")).toBeNull();
    expect(document.querySelector(".file-tree-status-strip")).toBeNull();
    expect(screen.queryByText("file.visible_count")).toBeNull();
    expect(document.querySelector(".tree-item-actions")).toBeNull();
  });

  it("omits the desktop filename search input when showSearch is false", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="desktop" showSearch={false} />
      </Provider>
    );

    expect(screen.queryByLabelText("action.search_files")).toBeNull();
    expect(document.querySelector(".file-tree-search")).toBeNull();
  });

  it("marks desktop tree rows draggable and writes workspace path drag data on dragstart", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            { path: "README.md", name: "README.md", kind: "file" },
            { path: "src", name: "src", kind: "dir", children: [] },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="desktop" showSearch={false} />
      </Provider>
    );

    const fileRow = screen.getByText("README.md").closest(".tree-item");
    const folderRow = screen.getByText("src").closest(".tree-item");
    expect(fileRow).toHaveAttribute("draggable", "true");
    expect(folderRow).toHaveAttribute("draggable", "true");

    const { dataTransfer, values } = createDragDataTransfer();
    fireEvent.dragStart(fileRow!, { dataTransfer });

    expect(values.get(WORKSPACE_PATH_DRAG_MIME)).toBe(
      JSON.stringify({
        workspaceId: "ws-test",
        path: "README.md",
        kind: "file",
      })
    );
    expect(values.get("text/plain")).toBe("README.md");
  });

  it("writes workspace drag data for nested desktop nodes too", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [".", [{ path: "src", name: "src", kind: "dir", children: [] }]],
        ["src", [{ path: "src/app.tsx", name: "app.tsx", kind: "file" }]],
      ])
    );
    store.set(expandedDirsAtomFamily("ws-test"), new Set(["src"]));

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="desktop" showSearch={false} />
      </Provider>
    );

    const nestedRow = screen.getByText("app.tsx").closest(".tree-item");
    expect(nestedRow).toHaveAttribute("draggable", "true");

    const { dataTransfer, values } = createDragDataTransfer();
    fireEvent.dragStart(nestedRow!, { dataTransfer });

    expect(values.get(WORKSPACE_PATH_DRAG_MIME)).toBe(
      JSON.stringify({
        workspaceId: "ws-test",
        path: "src/app.tsx",
        kind: "file",
      })
    );
    expect(values.get("text/plain")).toBe("src/app.tsx");
  });

  it("keeps desktop draggable file rows clickable for shared editor navigation", async () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({}) } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="desktop" showSearch={false} />
      </Provider>
    );

    const row = screen.getByText("app.tsx").closest(".tree-item");
    expect(row).toHaveAttribute("draggable", "true");

    fireEvent.click(row!);

    await waitFor(() => {
      expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    });

    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      source: "file-tree",
      requestId: expect.any(Number),
    });
  });

  it("keeps mobile tree rows non-draggable", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([[".", [{ path: "README.md", name: "README.md", kind: "file" }]]])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="mobile" showSearch={false} />
      </Provider>
    );

    expect(screen.getByText("README.md").closest(".tree-item")).not.toHaveAttribute(
      "draggable",
      "true"
    );
  });

  it("opens the mobile action sheet on long press but not on ordinary tap", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );
    const onSelectFile = vi.fn();

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="mobile" onSelectFile={onSelectFile} />
      </Provider>
    );

    const row = screen.getByText("app.tsx").closest(".tree-item");
    expect(row).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.pointerDown(row!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 30,
      clientY: 30,
    });
    fireEvent.pointerUp(row!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 30,
      clientY: 30,
    });
    fireEvent.click(row!);

    expect(onSelectFile).toHaveBeenCalledWith("src/app.tsx");
    expect(screen.queryByRole("region", { name: "file.context_menu_title sheet" })).toBeNull();

    onSelectFile.mockClear();

    fireEvent.pointerDown(row!, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 30,
      clientY: 30,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(
      screen.getByRole("region", { name: "file.context_menu_title sheet" })
    ).toBeInTheDocument();

    fireEvent.pointerUp(row!, {
      pointerId: 2,
      pointerType: "touch",
      clientX: 30,
      clientY: 30,
    });
    fireEvent.click(row!);
    expect(onSelectFile).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("cancels a mobile long press when the pointer moves before timeout", () => {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand: vi.fn().mockResolvedValue({ ok: true }) } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" variant="mobile" />
      </Provider>
    );

    const row = screen.getByText("app.tsx").closest(".tree-item");
    expect(row).toBeTruthy();

    vi.useFakeTimers();
    fireEvent.pointerDown(row!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(row!, {
      pointerId: 1,
      pointerType: "touch",
      clientX: 40,
      clientY: 10,
    });
    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.queryByRole("region", { name: "file.context_menu_title sheet" })).toBeNull();
    vi.useRealTimers();
  });

  it("requires explicit confirmation before deleting a file from the context menu", async () => {
    const sendCommand = vi.fn().mockResolvedValue({ ok: true });
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              kind: "file",
            },
          ],
        ],
      ])
    );

    render(
      <Provider store={store}>
        <FileTreePanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.contextMenu(screen.getByText("app.tsx").closest(".tree-item")!, {
      clientX: 100,
      clientY: 100,
    });
    const menu = await screen.findByRole("menu", { name: "file.context_menu_title" });
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Delete" }));

    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("btn", "btn-danger");
    expect(screen.getByRole("button", { name: "action.close" })).toHaveClass(
      "btn",
      "btn-ghost",
      "btn-sm"
    );
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    expect(sendCommand).not.toHaveBeenCalledWith(
      "file.delete",
      {
        workspaceId: "ws-test",
        path: "src/app.tsx",
      },
      undefined
    );
  });
});

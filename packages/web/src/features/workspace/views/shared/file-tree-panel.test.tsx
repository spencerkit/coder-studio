import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { pendingEditorNavigationAtomFamily } from "../../../code-editor/atoms";
import {
  activeFilePathAtomFamily,
  fileTreeAtomFamily,
  fileTreeStaleAtomFamily,
  loadedDirsAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { FileTreePanel } from "./file-tree-panel";

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    if (key === "file.delete_confirm") {
      return `Are you sure you want to delete "${params?.name ?? ""}"?`;
    }
    if (key === "action.cancel") return "Cancel";
    if (key === "action.confirm") return "Confirm";
    return key;
  },
}));

describe("FileTreePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

    render(
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
    expect(desktopSearch).toContainElement(searchInput);
    expect(activeRow).toHaveClass("selected");
    expect(activeRow?.querySelector(".tree-item-actions")).toBeTruthy();
  });

  it("uses shared tooltip behavior for the search result delete action", async () => {
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

    const deleteButton = await screen.findByRole("button", {
      name: "file.delete src/app.tsx",
    });
    expect(deleteButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(deleteButton).not.toHaveAttribute("title");

    fireEvent.mouseEnter(deleteButton);

    const tooltip = screen.getByRole("tooltip");
    expect(tooltip).toHaveTextContent("file.delete");
    expect(deleteButton).toHaveAttribute("aria-describedby", tooltip.getAttribute("id") ?? "");

    fireEvent.click(deleteButton);

    expect(onSelectFile).not.toHaveBeenCalled();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("uses shared tooltips for file-tree action triggers without showing row path labels", () => {
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

    const newFileButton = screen.getByRole("button", { name: "file.new_file src" });
    const newFolderButton = screen.getByRole("button", { name: "file.new_folder src" });
    const deleteDirectoryButton = screen.getByRole("button", { name: "file.delete src" });
    const deleteFileButton = screen.getByRole("button", { name: "file.delete src/app.tsx" });

    expect(newFileButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(newFolderButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(deleteDirectoryButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(deleteFileButton).toHaveClass("btn", "btn-ghost", "btn-sm", "git-row-action");
    expect(newFileButton).not.toHaveAttribute("title");
    expect(newFolderButton).not.toHaveAttribute("title");
    expect(deleteDirectoryButton).not.toHaveAttribute("title");
    expect(deleteFileButton).not.toHaveAttribute("title");
    const directoryLabel = screen.getByText("src");
    const fileLabel = screen.getByText("app.tsx");
    expect(directoryLabel).not.toHaveAttribute("title");
    expect(fileLabel).not.toHaveAttribute("title");
    expect(directoryLabel.closest(".tree-item")).not.toHaveAttribute("title");
    expect(fileLabel.closest(".tree-item")).not.toHaveAttribute("title");

    fireEvent.mouseEnter(newFileButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("file.new_file");

    fireEvent.mouseLeave(newFileButton);
    fireEvent.mouseEnter(newFolderButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("file.new_folder");

    fireEvent.mouseLeave(newFolderButton);
    fireEvent.mouseEnter(deleteDirectoryButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("file.delete");

    fireEvent.mouseLeave(deleteDirectoryButton);
    fireEvent.mouseEnter(deleteFileButton);
    expect(screen.getByRole("tooltip")).toHaveTextContent("file.delete");

    fireEvent.mouseLeave(deleteFileButton);
    fireEvent.mouseEnter(directoryLabel);
    expect(screen.queryByRole("tooltip")).toBeNull();

    fireEvent.mouseLeave(directoryLabel);
    fireEvent.mouseEnter(fileLabel);
    expect(screen.queryByRole("tooltip")).toBeNull();
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

  it("reloads the file tree after deleting a file", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "file.delete src/app.tsx" }));
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
      expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(new Map([[".", []]]));
    });
  });

  it("confirms directory deletion and reloads the file tree", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "file.delete src" }));

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

    fireEvent.click(screen.getByRole("button", { name: "file.delete src/app.tsx" }));

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
        undefined
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
  });

  it("requires explicit confirmation before deleting a file", async () => {
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

    fireEvent.click(screen.getByRole("button", { name: "file.delete src/app.tsx" }));

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

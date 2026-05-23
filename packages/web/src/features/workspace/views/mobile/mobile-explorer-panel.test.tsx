// @vitest-environment jsdom

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { activeFilePathAtomFamily, fileTreeAtomFamily, openFilesAtomFamily } from "../../atoms";
import { MobileExplorerPanel } from "./mobile-explorer-panel";

const fileTreePanelSpy = vi.fn();

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

  it("renders open editors, quick jump, and a file tree without the embedded tree search", async () => {
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

    expect(screen.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "src/mobile-files-sheet.tsx" })).toHaveClass(
      "workspace-open-editors__item--active"
    );
    expect(screen.getByRole("searchbox", { name: /Quick Jump|快速跳转/i })).toBeInTheDocument();
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

    fireEvent.change(screen.getByRole("searchbox", { name: /Quick Jump|快速跳转/i }), {
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
});

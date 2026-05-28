// @vitest-environment jsdom

import type { SearchContentResult } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import {
  activeEditorPaneIdAtomFamily,
  focusedEditorPaneIdAtomFamily,
} from "../../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../../agent-panes/atoms/pane-layout";
import { pendingEditorNavigationAtomFamily } from "../../../code-editor/atoms";
import { activeFilePathAtomFamily } from "../../atoms/files";
import { SearchPanel } from "./search-panel";

describe("SearchPanel", () => {
  const singleMatchCountPattern = /1.*(?:matches|条匹配)/i;

  function escapeRegExp(value: string) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function fileGroupNamePattern(path: string, name: string) {
    return new RegExp(
      `${escapeRegExp(path)}.*${escapeRegExp(name)}.*${singleMatchCountPattern.source}`,
      "i"
    );
  }

  function renderSearchPanel(
    sendCommand: ReturnType<typeof vi.fn>,
    seedStore?: (store: ReturnType<typeof createStore>) => void
  ) {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    seedStore?.(store);

    const renderResult = render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    return { store, ...renderResult };
  }

  async function searchFor(query: string) {
    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: query },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows the empty hint only once before a query is entered", () => {
    const sendCommand = vi.fn();
    renderSearchPanel(sendCommand);

    expect(
      screen.getAllByText(/Type to search across file contents|输入关键词以搜索文件内容/i)
    ).toHaveLength(1);
    expect(sendCommand).not.toHaveBeenCalled();
  });

  it("debounces content queries, renders grouped results, and highlights matches", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 2,
          hasMoreMatches: true,
          matches: [
            {
              line: 3,
              column: 7,
              endColumn: 18,
              preview: "const needleValue = searchState;",
              previewColumnStart: 7,
              previewColumnEnd: 18,
            },
            {
              line: 8,
              column: 8,
              endColumn: 19,
              preview: "return needleValue;",
              previewColumnStart: 8,
              previewColumnEnd: 19,
            },
          ],
        },
      ],
      totalMatchCount: 2,
      hasMoreFiles: true,
      truncatedMatchFileCount: 1,
    } satisfies SearchContentResult);
    renderSearchPanel(sendCommand);

    await searchFor("needle");

    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchContent",
      {
        workspaceId: "ws-test",
        query: "needle",
        maxFiles: 50,
        maxMatchesPerFile: 20,
      },
      undefined
    );

    expect(screen.getByText("app.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getAllByText("needleValue")[0]?.tagName).toBe("MARK");
    expect(screen.getByText(/Results limited|结果已截断/i)).toBeInTheDocument();
  });

  it("expands file groups by default after results load", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const groupHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });

    expect(groupHeader).toHaveAttribute("aria-expanded", "true");
    expect(groupHeader).toHaveAttribute("aria-controls");
    expect(screen.getByRole("button", { name: /12.*needle/i })).toBeInTheDocument();
  });

  it("keeps grouped headers expanded with highlighted preview rows after a rerender", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 7,
              endColumn: 13,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    const { rerender, store } = renderSearchPanel(sendCommand);

    await searchFor("needle");

    rerender(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    const groupHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });
    const matchRow = screen.getByRole("button", { name: /12.*needle/i });
    const mark = matchRow.querySelector("mark");

    expect(groupHeader).toHaveAttribute("aria-expanded", "true");
    expect(matchRow).toBeInTheDocument();
    expect(mark).not.toBeNull();
    expect(mark).toHaveTextContent("needle");
  });

  it("collapses and re-expands file matches when the group header is clicked", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const groupHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });

    fireEvent.click(groupHeader);

    expect(groupHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: /12.*needle/i })).not.toBeInTheDocument();

    fireEvent.click(groupHeader);

    expect(groupHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /12.*needle/i })).toBeInTheDocument();
  });

  it("resets returned file groups to expanded on a new successful query", async () => {
    const sendCommand = vi.fn().mockImplementation(async (_op: string, args: { query: string }) => {
      if (args.query === "needle") {
        return {
          files: [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              matchCount: 1,
              hasMoreMatches: false,
              matches: [
                {
                  line: 12,
                  column: 5,
                  endColumn: 11,
                  preview: "const needle = true;",
                  previewColumnStart: 7,
                  previewColumnEnd: 13,
                },
              ],
            },
          ],
          totalMatchCount: 1,
          hasMoreFiles: false,
          truncatedMatchFileCount: 0,
        } satisfies SearchContentResult;
      }

      return {
        files: [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 21,
                column: 3,
                endColumn: 9,
                preview: "startThread(worker);",
                previewColumnStart: 6,
                previewColumnEnd: 12,
              },
            ],
          },
          {
            path: "src/worker.ts",
            name: "worker.ts",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 4,
                column: 10,
                endColumn: 16,
                preview: "threadPool.run(job);",
                previewColumnStart: 1,
                previewColumnEnd: 7,
              },
            ],
          },
        ],
        totalMatchCount: 2,
        hasMoreFiles: false,
        truncatedMatchFileCount: 0,
      } satisfies SearchContentResult;
    });

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const firstHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });

    fireEvent.click(firstHeader);
    expect(firstHeader).toHaveAttribute("aria-expanded", "false");

    await searchFor("thread");

    const appHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });
    const workerHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/worker.ts", "worker.ts"),
    });

    expect(appHeader).toHaveAttribute("aria-expanded", "true");
    expect(workerHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /21.*startThread/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /4.*threadPool/i })).toBeInTheDocument();
  });

  it("clears collapsed group state when the query is cleared", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const groupHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });

    fireEvent.click(groupHeader);
    expect(groupHeader).toHaveAttribute("aria-expanded", "false");

    await searchFor("");

    expect(
      screen.queryByRole("button", {
        name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
      })
    ).not.toBeInTheDocument();

    await searchFor("needle");

    const nextHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
    });

    expect(nextHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /12.*needle/i })).toBeInTheDocument();
  });

  it("opens the file at the selected match location", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);
    const { store } = renderSearchPanel(sendCommand);

    await searchFor("needle");

    fireEvent.click(screen.getByRole("button", { name: /12.*needle/i }));

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      line: 12,
      column: 5,
      source: "search",
    });
  });

  it("clicked match stays selected until query changes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (_op: string, args: { query: string }) => {
      if (args.query === "needle") {
        return {
          files: [
            {
              path: "src/app.tsx",
              name: "app.tsx",
              matchCount: 2,
              hasMoreMatches: false,
              matches: [
                {
                  line: 12,
                  column: 5,
                  endColumn: 11,
                  preview: "const needle = true;",
                  previewColumnStart: 7,
                  previewColumnEnd: 13,
                },
                {
                  line: 18,
                  column: 9,
                  endColumn: 15,
                  preview: "return needle;",
                  previewColumnStart: 8,
                  previewColumnEnd: 14,
                },
              ],
            },
          ],
          totalMatchCount: 2,
          hasMoreFiles: false,
          truncatedMatchFileCount: 0,
        } satisfies SearchContentResult;
      }

      return {
        files: [
          {
            path: "src/thread.ts",
            name: "thread.ts",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 4,
                column: 10,
                endColumn: 16,
                preview: "threadPool.run(job);",
                previewColumnStart: 1,
                previewColumnEnd: 7,
              },
            ],
          },
        ],
        totalMatchCount: 1,
        hasMoreFiles: false,
        truncatedMatchFileCount: 0,
      } satisfies SearchContentResult;
    });

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const firstMatch = screen.getByRole("button", { name: /12.*needle/i });
    const secondMatch = screen.getByRole("button", { name: /18.*needle/i });

    fireEvent.click(firstMatch);

    expect(firstMatch).toHaveAttribute("aria-current", "true");
    expect(firstMatch).toHaveClass(
      "workspace-search-panel__match--active",
      "workspace-sidebar-row--selected"
    );
    expect(secondMatch).not.toHaveAttribute("aria-current");
    expect(secondMatch).not.toHaveClass("workspace-search-panel__match--active");

    fireEvent.click(secondMatch);

    expect(secondMatch).toHaveAttribute("aria-current", "true");
    expect(secondMatch).toHaveClass(
      "workspace-search-panel__match--active",
      "workspace-sidebar-row--selected"
    );
    expect(firstMatch).not.toHaveAttribute("aria-current");
    expect(firstMatch).not.toHaveClass("workspace-search-panel__match--active");

    await searchFor("thread");

    expect(screen.getByRole("button", { name: /4.*threadPool/i })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("clearing query clears selected match", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const match = screen.getByRole("button", { name: /12.*needle/i });

    fireEvent.click(match);

    expect(match).toHaveAttribute("aria-current", "true");
    expect(match).toHaveClass(
      "workspace-search-panel__match--active",
      "workspace-sidebar-row--selected"
    );

    await searchFor("");

    expect(screen.queryByRole("button", { name: /12.*needle/i })).not.toBeInTheDocument();

    await searchFor("needle");

    expect(screen.getByRole("button", { name: /12.*needle/i })).toHaveAttribute(
      "aria-current",
      "true"
    );
  });

  it("rapidly reverting to the resolved query before debounce clears loading and selected match without refetching", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    const searchbox = screen.getByRole("searchbox", { name: /Search|搜索/i });
    const match = screen.getByRole("button", { name: /12.*needle/i });

    fireEvent.click(match);
    expect(match).toHaveAttribute("aria-current", "true");

    fireEvent.change(searchbox, { target: { value: "needlex" } });
    expect(screen.getAllByText(/Loading|加载/i).length).toBeGreaterThan(0);

    fireEvent.change(searchbox, { target: { value: "needle" } });

    expect(screen.queryByText(/Loading|加载/i)).not.toBeInTheDocument();
    const restoredMatch = screen.getByRole("button", { name: /12.*needle/i });
    expect(screen.getByText("app.tsx")).toBeInTheDocument();
    expect(restoredMatch).toBeInTheDocument();
    expect(restoredMatch).not.toHaveAttribute("aria-current");
    expect(sendCommand).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(sendCommand).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/Loading|加载/i)).not.toBeInTheDocument();
  });

  it("routes selected matches into the focused editor pane", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);

    const { store } = renderSearchPanel(sendCommand, (draftStore) => {
      draftStore.set(paneLayoutAtomFamily("ws-test"), {
        id: "root",
        type: "leaf",
        leafKind: "editor",
      });
      draftStore.set(focusedEditorPaneIdAtomFamily("ws-test"), "root");
    });

    await searchFor("needle");
    fireEvent.click(screen.getByRole("button", { name: /12.*needle/i }));

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("root");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
  });

  it("renders a mobile variant without the desktop header and still opens the selected match", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      files: [
        {
          path: "src/app.tsx",
          name: "app.tsx",
          matchCount: 1,
          hasMoreMatches: false,
          matches: [
            {
              line: 12,
              column: 5,
              endColumn: 11,
              preview: "const needle = true;",
              previewColumnStart: 7,
              previewColumnEnd: 13,
            },
          ],
        },
      ],
      totalMatchCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
    } satisfies SearchContentResult);
    const onSelectFile = vi.fn();
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" variant="mobile" onSelectFile={onSelectFile} />
      </Provider>
    );

    expect(screen.queryByRole("heading", { name: /Search|搜索/i })).toBeNull();

    await searchFor("needle");
    fireEvent.click(screen.getByRole("button", { name: /12.*needle/i }));

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(onSelectFile).toHaveBeenCalledWith("src/app.tsx");
  });

  it("shows retry when the search command fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("boom"));
    renderSearchPanel(sendCommand);

    await searchFor("needle");

    expect(screen.getByRole("button", { name: /Retry|重试/i })).toBeInTheDocument();
  });

  it("re-expands file groups after a failed search is retried successfully", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce({
        files: [
          {
            path: "src/app.tsx",
            name: "app.tsx",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 12,
                column: 5,
                endColumn: 11,
                preview: "const needle = true;",
                previewColumnStart: 7,
                previewColumnEnd: 13,
              },
            ],
          },
        ],
        totalMatchCount: 1,
        hasMoreFiles: false,
        truncatedMatchFileCount: 0,
      } satisfies SearchContentResult)
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        files: [
          {
            path: "src/thread.ts",
            name: "thread.ts",
            matchCount: 1,
            hasMoreMatches: false,
            matches: [
              {
                line: 4,
                column: 10,
                endColumn: 16,
                preview: "threadPool.run(job);",
                previewColumnStart: 1,
                previewColumnEnd: 7,
              },
            ],
          },
        ],
        totalMatchCount: 1,
        hasMoreFiles: false,
        truncatedMatchFileCount: 0,
      } satisfies SearchContentResult);

    renderSearchPanel(sendCommand);

    await searchFor("needle");

    fireEvent.click(
      screen.getByRole("button", {
        name: fileGroupNamePattern("src/app.tsx", "app.tsx"),
      })
    );

    await searchFor("thread");

    fireEvent.click(screen.getByRole("button", { name: /Retry|重试/i }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    const retryHeader = screen.getByRole("button", {
      name: fileGroupNamePattern("src/thread.ts", "thread.ts"),
    });

    expect(retryHeader).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: /4.*threadPool/i })).toBeInTheDocument();
  });
});

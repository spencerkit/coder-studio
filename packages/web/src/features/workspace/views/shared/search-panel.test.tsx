// @vitest-environment jsdom

import type { SearchContentResult } from "@coder-studio/core";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { pendingEditorNavigationAtomFamily } from "../../../code-editor/atoms";
import { activeFilePathAtomFamily } from "../../atoms/files";
import { SearchPanel } from "./search-panel";

describe("SearchPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
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
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

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
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

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

  it("shows retry when the search command fails", async () => {
    const sendCommand = vi.fn().mockRejectedValue(new Error("boom"));
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);

    render(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: "needle" },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(screen.getByRole("button", { name: /Retry|重试/i })).toBeInTheDocument();
  });
});

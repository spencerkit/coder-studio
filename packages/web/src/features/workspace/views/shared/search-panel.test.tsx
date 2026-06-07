// @vitest-environment jsdom

import type { SearchSessionStartResult } from "@coder-studio/core";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { CommandResultError } from "../../../../ws/client";
import {
  activeEditorPaneIdAtomFamily,
  editorPaneActiveFilePathAtomFamily,
  focusedEditorPaneIdAtomFamily,
  getEditorPaneStateKey,
} from "../../../agent-panes/atoms/editor-panes";
import { paneLayoutAtomFamily } from "../../../agent-panes/atoms/pane-layout";
import { pendingEditorNavigationAtomFamily } from "../../../code-editor/atoms";
import {
  activeFilePathAtomFamily,
  editorModeAtomFamily,
  gitDiffPreviewAtomFamily,
  openFilesAtomFamily,
} from "../../atoms";
import { SearchPanel } from "./search-panel";

const baseResult: SearchSessionStartResult = {
  sessionId: "session-1",
  files: [
    {
      path: "src/app.tsx",
      name: "app.tsx",
      matchCount: 2,
      hasMoreMatches: false,
      baseHash: "hash-1",
      matches: [
        {
          id: "m-1",
          line: 3,
          column: 7,
          endColumn: 13,
          preview: "const needle = true;",
          previewColumnStart: 7,
          previewColumnEnd: 13,
          replacementPreview: "const replace = true;",
          replacementPreviewColumnStart: 7,
          replacementPreviewColumnEnd: 14,
          isReplacementPreviewTruncated: false,
        },
        {
          id: "m-2",
          line: 8,
          column: 10,
          endColumn: 16,
          preview: "return needle;",
          previewColumnStart: 8,
          previewColumnEnd: 14,
          replacementPreview: "return replace;",
          replacementPreviewColumnStart: 8,
          replacementPreviewColumnEnd: 15,
          isReplacementPreviewTruncated: false,
        },
      ],
    },
  ],
  totalMatchCount: 2,
  totalFileCount: 1,
  hasMoreFiles: false,
  truncatedMatchFileCount: 0,
  skippedBinaryFileCount: 0,
  skippedLargeFileCount: 0,
};

describe("SearchPanel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function renderSearchPanel(
    sendCommand: ReturnType<typeof vi.fn>,
    seedStore?: (store: ReturnType<typeof createStore>) => void
  ) {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    store.set(activeEditorPaneIdAtomFamily("ws-test"), "root");
    store.set(focusedEditorPaneIdAtomFamily("ws-test"), "root");
    store.set(
      editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-test", "root")),
      "src/panel.tsx"
    );
    store.set(openFilesAtomFamily("ws-test"), {
      "src/app.tsx": {
        kind: "text",
        path: "src/app.tsx",
        content: "const needle = true;",
        savedContent: "const needle = true;",
        baseHash: "hash-1",
        isDirty: false,
      },
    });
    seedStore?.(store);

    return {
      store,
      ...render(
        <Provider store={store}>
          <SearchPanel workspaceId="ws-test" />
        </Provider>
      ),
    };
  }

  async function searchFor(query: string) {
    fireEvent.change(screen.getByRole("searchbox", { name: /Search|搜索/i }), {
      target: { value: query },
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });
  }

  function hasSummaryText(text: string, matchCount: number, fileCount: number) {
    return (
      (text.includes(`${matchCount}`) &&
        text.includes(`${fileCount}`) &&
        /results|匹配|结果/.test(text) &&
        /files|文件/.test(text)) ||
      false
    );
  }

  async function flushMicrotasks() {
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("shows a single empty hint before a query is entered", () => {
    const sendCommand = vi.fn();
    renderSearchPanel(sendCommand);

    expect(
      screen.getAllByText(/Type to search across file contents|输入关键词以搜索文件内容/i)
    ).toHaveLength(1);
    expect(sendCommand).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Query$|^查询$/i)).toBeNull();
    expect(screen.queryByText(/^Results$|^结果$/i)).toBeNull();
  });

  it("starts a session search, shows grouped results, and renders replacement previews", async () => {
    const sendCommand = vi.fn().mockResolvedValue(baseResult);
    renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });

    await searchFor("needle");

    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchSession.start",
      expect.objectContaining({
        workspaceId: "ws-test",
        query: "needle",
        replace: "replace",
      }),
      undefined
    );
    expect(screen.getByText("app.tsx")).toBeInTheDocument();
    expect(screen.getByText("src/app.tsx")).toBeInTheDocument();
    expect(screen.getAllByText("needle")[0]?.tagName).toBe("MARK");
    expect(screen.getAllByText(/replace/i).length).toBeGreaterThan(0);
    expect(screen.getByText((content) => hasSummaryText(content, 2, 1))).toBeInTheDocument();
  });

  it("sends advanced search toggles and filters in the session start request", async () => {
    const sendCommand = vi.fn().mockResolvedValue(baseResult);
    renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Match Case|区分大小写/i }));
    fireEvent.click(screen.getByRole("button", { name: /Whole Word|全字匹配/i }));
    fireEvent.click(screen.getByRole("button", { name: /Use Regular Expression|使用正则表达式/i }));
    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Preserve Case|保留大小写/i }));
    fireEvent.click(screen.getByRole("button", { name: /Toggle search details|切换搜索详情/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Files to Include|包含的文件/i }), {
      target: { value: "src/**/*.tsx" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: /Files to Exclude|排除的文件/i }), {
      target: { value: "**/*.spec.tsx" },
    });
    expect(screen.queryByRole("switch", { name: /Only Open Files|仅在打开的文件中/i })).toBeNull();
    fireEvent.click(
      screen.getByRole("button", {
        name: /Use Exclude Settings and Ignore Files|使用排除设置和忽略文件/i,
      })
    );

    await searchFor("needle");

    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchSession.start",
      {
        workspaceId: "ws-test",
        query: "needle",
        replace: "replace",
        isRegex: true,
        matchCase: true,
        matchWholeWord: true,
        preserveCase: true,
        includeGlobs: ["src/**/*.tsx"],
        excludeGlobs: ["**/*.spec.tsx"],
        useIgnoreFiles: false,
        useExcludeSettings: false,
        onlyOpenEditors: false,
        openEditorPaths: ["src/app.tsx"],
        maxFiles: 50,
        maxMatchesPerFile: 20,
      },
      undefined
    );
  });

  it("renders replace all as an icon action inside the replace control", async () => {
    const sendCommand = vi.fn().mockResolvedValue(baseResult);
    renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });

    await searchFor("needle");

    const replaceInput = screen.getByRole("textbox", { name: /Replace|替换/i });
    const replaceCompound = replaceInput.closest(".workspace-search-panel__compound-control");
    const replaceAllButton = screen.getByRole("button", { name: /Replace All|全部替换/i });

    expect(replaceCompound).not.toBeNull();
    expect(replaceCompound?.contains(replaceAllButton)).toBe(true);
    expect(screen.queryByText(/^Replace All$|^全部替换$/i)).toBeNull();
  });

  it("renders a details toggle outside replace that shows and hides include and exclude filters", () => {
    const sendCommand = vi.fn();
    renderSearchPanel(sendCommand);

    expect(screen.queryByRole("textbox", { name: /Files to Include|包含的文件/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Files to Exclude|排除的文件/i })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    const detailsToggle = screen.getByRole("button", {
      name: /Toggle search details|切换搜索详情/i,
    });
    const replaceInput = screen.getByRole("textbox", { name: /Replace|替换/i });
    const replaceCompound = replaceInput.closest(".workspace-search-panel__compound-control");
    const collapsedDetails = detailsToggle.closest(".workspace-search-panel__details--collapsed");

    expect(replaceCompound).not.toBeNull();
    expect(replaceCompound?.contains(detailsToggle)).toBe(false);
    expect(collapsedDetails).not.toBeNull();
    expect(collapsedDetails?.querySelector("input")).toBeNull();

    fireEvent.click(detailsToggle);

    const expandedDetailsToggle = screen.getByRole("button", {
      name: /Toggle search details|切换搜索详情/i,
    });
    expect(expandedDetailsToggle).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: /Files to Include|包含的文件/i })).toBeVisible();
    const includeInput = screen.getByRole("textbox", { name: /Files to Include|包含的文件/i });
    const includeCompound = includeInput.closest(".workspace-search-panel__compound-control");
    const includeHeading = screen
      .getByText(/Files to Include|包含的文件/i)
      .closest(".workspace-search-panel__detail-heading");
    const excludeInput = screen.getByRole("textbox", { name: /Files to Exclude|排除的文件/i });
    const excludeCompound = excludeInput.closest(".workspace-search-panel__compound-control");
    const ignoreToggle = screen.getByRole("button", {
      name: /Use Exclude Settings and Ignore Files|使用排除设置和忽略文件/i,
    });

    expect(includeHeading).not.toBeNull();
    expect(includeHeading?.contains(expandedDetailsToggle)).toBe(true);
    expect(includeCompound).not.toBeNull();
    expect(includeCompound?.contains(expandedDetailsToggle)).toBe(false);
    expect(replaceCompound?.contains(expandedDetailsToggle)).toBe(false);
    expect(excludeCompound).not.toBeNull();
    expect(excludeCompound?.contains(ignoreToggle)).toBe(true);
    expect(screen.queryByRole("switch", { name: /Only Open Files|仅在打开的文件中/i })).toBeNull();

    fireEvent.click(expandedDetailsToggle);
    const collapsedDetailsToggle = screen.getByRole("button", {
      name: /Toggle search details|切换搜索详情/i,
    });
    expect(collapsedDetailsToggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("textbox", { name: /Files to Include|包含的文件/i })).toBeNull();
    expect(screen.queryByRole("textbox", { name: /Files to Exclude|排除的文件/i })).toBeNull();
  });

  it("opens diff preview through the shared editor surface", async () => {
    const sendCommand = vi.fn().mockResolvedValueOnce(baseResult).mockResolvedValueOnce({
      kind: "search-replace-file-diff",
      path: "src/app.tsx",
      title: "src/app.tsx",
      sessionId: "session-1",
      baseHash: "hash-1",
      originalContent: "const needle = true;",
      modifiedContent: "const replace = true;",
    });
    const { store } = renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });

    await searchFor("needle");

    fireEvent.click(screen.getAllByRole("button", { name: /Preview|预览/i })[0] as HTMLElement);

    await act(async () => {
      await Promise.resolve();
    });

    expect(sendCommand).toHaveBeenNthCalledWith(2, "file.searchSession.previewFile", {
      workspaceId: "ws-test",
      sessionId: "session-1",
      path: "src/app.tsx",
    });
    expect(store.get(editorModeAtomFamily("ws-test"))).toBe("diff");
    expect(store.get(gitDiffPreviewAtomFamily("ws-test"))).toMatchObject({
      kind: "search-replace-file-diff",
      path: "src/app.tsx",
    });
  });

  it("applies replace all, then refreshes the session results", async () => {
    const refreshedResult: SearchSessionStartResult = {
      ...baseResult,
      sessionId: "session-2",
      files: [],
      totalMatchCount: 0,
      totalFileCount: 0,
    };
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(baseResult)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        status: "ok",
        appliedFileCount: 1,
        conflictFileCount: 0,
        skippedFileCount: 0,
        results: [{ path: "src/app.tsx", status: "applied", replacedMatchCount: 2 }],
      })
      .mockResolvedValueOnce(refreshedResult);
    renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });

    await searchFor("needle");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Replace All|全部替换/i }));
    });

    await flushMicrotasks();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(sendCommand).toHaveBeenNthCalledWith(
      2,
      "file.searchSession.apply",
      {
        workspaceId: "ws-test",
        sessionId: "session-1",
        scope: { kind: "all" },
      },
      undefined
    );
    expect(sendCommand).toHaveBeenNthCalledWith(
      3,
      "file.searchSession.start",
      expect.objectContaining({
        workspaceId: "ws-test",
        query: "needle",
        replace: "replace",
      }),
      undefined
    );

    expect(screen.getByText((content) => hasSummaryText(content, 0, 0))).toBeInTheDocument();
  });

  it("applies replace for a single file and a single match", async () => {
    const sendCommand = vi
      .fn()
      .mockResolvedValue(baseResult)
      .mockResolvedValueOnce(baseResult)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        status: "ok",
        appliedFileCount: 1,
        conflictFileCount: 0,
        skippedFileCount: 0,
        results: [{ path: "src/app.tsx", status: "applied", replacedMatchCount: 2 }],
      })
      .mockResolvedValueOnce(baseResult)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        status: "ok",
        appliedFileCount: 1,
        conflictFileCount: 0,
        skippedFileCount: 0,
        results: [{ path: "src/app.tsx", status: "applied", replacedMatchCount: 1 }],
      })
      .mockResolvedValueOnce(baseResult);
    renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });

    await searchFor("needle");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Replace in File|替换文件中全部/i }));
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    await searchFor("needle");

    const matchRow = screen.getByRole("button", { name: /3.*needle/i });
    await act(async () => {
      fireEvent.click(
        within(matchRow.parentElement as HTMLElement).getByRole("button", {
          name: /Replace Match|替换此项/i,
        })
      );
      await vi.advanceTimersByTimeAsync(250);
      await Promise.resolve();
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchSession.apply",
      {
        workspaceId: "ws-test",
        sessionId: "session-1",
        scope: { kind: "file", path: "src/app.tsx" },
      },
      undefined
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchSession.apply",
      {
        workspaceId: "ws-test",
        sessionId: "session-1",
        scope: { kind: "match", path: "src/app.tsx", matchId: "m-1" },
      },
      undefined
    );
  });

  it("surfaces invalid regex errors inline and hides stale results", async () => {
    const sendCommand = vi.fn().mockRejectedValue(
      new CommandResultError({
        code: "invalid_regex",
        message: "Invalid regular expression",
      })
    );
    renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Use Regular Expression|使用正则表达式/i }));

    await searchFor("(");
    await flushMicrotasks();

    expect(screen.getByText(/Invalid regular expression|无效正则表达式/i)).toBeInTheDocument();
    expect(screen.queryByText("app.tsx")).toBeNull();
  });

  it("keeps search state across rerenders for the same workspace", async () => {
    const sendCommand = vi.fn().mockResolvedValue(baseResult);
    const { rerender, store } = renderSearchPanel(sendCommand);

    fireEvent.click(screen.getByRole("button", { name: /Toggle replace|切换替换/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Replace|替换/i }), {
      target: { value: "replace" },
    });

    await searchFor("needle");

    rerender(
      <Provider store={store}>
        <SearchPanel workspaceId="ws-test" />
      </Provider>
    );

    expect(screen.getByRole("searchbox", { name: /Search|搜索/i })).toHaveValue("needle");
    expect(screen.getByRole("textbox", { name: /Replace|替换/i })).toHaveValue("replace");
    expect(screen.getByText("app.tsx")).toBeInTheDocument();
  });

  it("opens matched source locations on row click", async () => {
    const sendCommand = vi.fn().mockResolvedValue(baseResult);
    const { store } = renderSearchPanel(sendCommand);

    await searchFor("needle");

    fireEvent.click(screen.getByRole("button", { name: /3.*needle/i }));

    expect(store.get(activeEditorPaneIdAtomFamily("ws-test"))).toBe("root");
    expect(store.get(focusedEditorPaneIdAtomFamily("ws-test"))).toBeNull();
    expect(
      store.get(editorPaneActiveFilePathAtomFamily(getEditorPaneStateKey("ws-test", "root")))
    ).toBe("src/panel.tsx");
    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe("src/app.tsx");
    expect(store.get(pendingEditorNavigationAtomFamily("ws-test"))).toMatchObject({
      workspaceId: "ws-test",
      path: "src/app.tsx",
      line: 3,
      column: 7,
      endColumn: 13,
      source: "search",
    });
  });
});

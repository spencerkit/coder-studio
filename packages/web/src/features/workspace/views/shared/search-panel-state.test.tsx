// @vitest-environment jsdom

import type { SearchSessionStartResult } from "@coder-studio/core";
import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { CommandResultError } from "../../../../ws/client";
import { openEditorPathsAtomFamily, openFilesAtomFamily } from "../../atoms";
import { SEARCH_PANEL_DEBOUNCE_MS, useSearchPanelState } from "./search-panel-state";

describe("useSearchPanelState", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  function createWrapper(sendCommand: ReturnType<typeof vi.fn>) {
    const store = createStore();
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(openFilesAtomFamily("ws-test"), {
      "src/open-b.ts": {
        kind: "text",
        path: "src/open-b.ts",
        content: "b",
        savedContent: "b",
        baseHash: "hash-b",
        isDirty: false,
      },
      "src/open-a.ts": {
        kind: "text",
        path: "src/open-a.ts",
        content: "a",
        savedContent: "a",
        baseHash: "hash-a",
        isDirty: false,
      },
    });
    store.set(openEditorPathsAtomFamily("ws-test"), ["src/open-b.ts", "src/open-a.ts"]);

    const wrapper = ({ children }: { children: ReactNode }) => (
      <Provider store={store}>{children}</Provider>
    );

    return { store, wrapper };
  }

  async function flushSearchDebounce() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_PANEL_DEBOUNCE_MS);
      await Promise.resolve();
    });
  }

  it("debounces session searches and sends advanced search arguments", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      files: [],
      totalMatchCount: 0,
      totalFileCount: 0,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
      skippedBinaryFileCount: 0,
      skippedLargeFileCount: 0,
    } satisfies SearchSessionStartResult);
    const { wrapper } = createWrapper(sendCommand);
    const { result } = renderHook(() => useSearchPanelState("ws-test"), { wrapper });

    await act(async () => {
      result.current.update((current) => ({
        ...current,
        query: "needle",
        replaceText: "replacement",
        matchCase: true,
        wholeWord: true,
        isRegex: true,
        preserveCase: true,
        includeText: "src/**/*.ts, test/**/*.ts",
        excludeText: "**/*.snap",
        onlyOpenEditors: true,
        replaceExpanded: true,
        detailsExpanded: true,
      }));
    });

    await flushSearchDebounce();

    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchSession.start",
      {
        workspaceId: "ws-test",
        query: "needle",
        replace: "replacement",
        isRegex: true,
        matchCase: true,
        matchWholeWord: true,
        preserveCase: true,
        includeGlobs: ["src/**/*.ts", "test/**/*.ts"],
        excludeGlobs: ["**/*.snap"],
        useIgnoreFiles: true,
        useExcludeSettings: true,
        onlyOpenEditors: true,
        openEditorPaths: ["src/open-a.ts", "src/open-b.ts"],
        maxFiles: 50,
        maxMatchesPerFile: 20,
      },
      undefined
    );
  });

  it("uses global open editor paths instead of shared cache entries for open-editor searches", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      files: [],
      totalMatchCount: 0,
      totalFileCount: 0,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
      skippedBinaryFileCount: 0,
      skippedLargeFileCount: 0,
    } satisfies SearchSessionStartResult);
    const { store, wrapper } = createWrapper(sendCommand);
    store.set(openFilesAtomFamily("ws-test"), {
      ...store.get(openFilesAtomFamily("ws-test")),
      "src/panel-only.ts": {
        kind: "text",
        path: "src/panel-only.ts",
        content: "panel",
        savedContent: "panel",
        baseHash: "hash-panel",
        isDirty: false,
      },
    });
    store.set(openEditorPathsAtomFamily("ws-test"), ["src/open-a.ts"]);

    const { result } = renderHook(() => useSearchPanelState("ws-test"), { wrapper });

    await act(async () => {
      result.current.update((current) => ({
        ...current,
        query: "needle",
        onlyOpenEditors: true,
      }));
    });

    await flushSearchDebounce();

    expect(sendCommand).toHaveBeenCalledWith(
      "file.searchSession.start",
      expect.objectContaining({
        onlyOpenEditors: true,
        openEditorPaths: ["src/open-a.ts"],
      }),
      undefined
    );
  });

  it("surfaces invalid regex errors inline without keeping stale results", async () => {
    const sendCommand = vi.fn().mockRejectedValue(
      new CommandResultError({
        code: "invalid_regex",
        message: "Invalid regular expression",
      })
    );
    const { wrapper } = createWrapper(sendCommand);
    const { result } = renderHook(() => useSearchPanelState("ws-test"), { wrapper });

    await act(async () => {
      result.current.update((current) => ({
        ...current,
        query: "(",
        isRegex: true,
      }));
    });

    await flushSearchDebounce();

    expect(result.current.state.error).toEqual({
      code: "invalid_regex",
      message: "Invalid regular expression",
    });
    expect(result.current.state.result).toBeNull();
    expect(result.current.state.activeSessionId).toBeNull();
  });

  it("applies replacements and triggers a fresh search session afterward", async () => {
    const initialResult: SearchSessionStartResult = {
      sessionId: "session-1",
      files: [],
      totalMatchCount: 2,
      totalFileCount: 1,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
      skippedBinaryFileCount: 0,
      skippedLargeFileCount: 0,
    };
    const refreshedResult: SearchSessionStartResult = {
      sessionId: "session-2",
      files: [],
      totalMatchCount: 0,
      totalFileCount: 0,
      hasMoreFiles: false,
      truncatedMatchFileCount: 0,
      skippedBinaryFileCount: 0,
      skippedLargeFileCount: 0,
    };
    const sendCommand = vi
      .fn()
      .mockResolvedValueOnce(initialResult)
      .mockResolvedValueOnce({
        sessionId: "session-1",
        status: "ok",
        appliedFileCount: 1,
        conflictFileCount: 0,
        skippedFileCount: 0,
        results: [
          {
            path: "src/app.ts",
            status: "applied",
            replacedMatchCount: 2,
          },
        ],
      })
      .mockResolvedValueOnce(refreshedResult);
    const { wrapper } = createWrapper(sendCommand);
    const { result } = renderHook(() => useSearchPanelState("ws-test"), { wrapper });

    await act(async () => {
      result.current.update((current) => ({
        ...current,
        query: "needle",
        replaceText: "replacement",
      }));
    });

    await flushSearchDebounce();

    expect(result.current.state.activeSessionId).toBe("session-1");

    await act(async () => {
      await expect(result.current.applyReplace({ kind: "all" })).resolves.toMatchObject({
        status: "ok",
        appliedFileCount: 1,
      });
    });

    await flushSearchDebounce();

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
        replace: "replacement",
      }),
      undefined
    );
    expect(result.current.state.activeSessionId).toBe("session-2");
  });
});

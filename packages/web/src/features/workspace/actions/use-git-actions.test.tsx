// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { toastsAtom } from "../../notifications/atoms";
import { gitFetchAtomFamily } from "../atoms";
import { useGitSyncActions } from "./use-git-actions";

function buildStore() {
  const store = createStore();
  store.set(localeAtom, "en");
  return store;
}

function wrapperFor(store: ReturnType<typeof buildStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useGitSyncActions handleFetch", () => {
  it("dispatches git.fetch and writes lastFetchAt on success", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "git.fetch") return { success: true, message: "fetched", updatedRefs: [] };
      if (op === "git.branches") return { current: "main", branches: [] };
      if (op === "git.status")
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      throw new Error(`Unexpected op: ${op}`);
    });

    const store = buildStore();
    store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);

    const { result } = renderHook(() => useGitSyncActions("ws-1"), {
      wrapper: wrapperFor(store),
    });

    let success = false;
    await act(async () => {
      success = await result.current.handleFetch();
    });

    expect(success).toBe(true);
    expect(sendCommand).toHaveBeenCalledWith(
      "git.fetch",
      { workspaceId: "ws-1" },
      { timeoutMs: 180000 }
    );

    const fetchState = store.get(gitFetchAtomFamily("ws-1"));
    expect(fetchState.status).toBe("idle");
    expect(typeof fetchState.lastFetchAt).toBe("number");
    expect(fetchState.error).toBeUndefined();
  });

  it("records error on failed fetch and shows toast", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "git.fetch") {
        throw new Error("boom");
      }
      throw new Error(`Unexpected op: ${op}`);
    });

    const store = buildStore();
    store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);

    const { result } = renderHook(() => useGitSyncActions("ws-1"), {
      wrapper: wrapperFor(store),
    });

    let success = true;
    await act(async () => {
      success = await result.current.handleFetch();
    });

    expect(success).toBe(false);
    const fetchState = store.get(gitFetchAtomFamily("ws-1"));
    expect(fetchState.status).toBe("error");
    expect(fetchState.error).toContain("boom");

    const toasts = store.get(toastsAtom);
    expect(toasts.some((t) => t.kind === "error")).toBe(true);
  });

  it("treats fetch as failed when the follow-up git refresh fails", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "git.fetch") {
        return { success: true, message: "fetched", updatedRefs: [] };
      }
      if (op === "git.branches") {
        throw new Error("branches failed");
      }
      if (op === "git.status") {
        return {
          branch: "main",
          ahead: 0,
          behind: 0,
          staged: [],
          modified: [],
          untracked: [],
          deleted: [],
        };
      }
      throw new Error(`Unexpected op: ${op}`);
    });

    const store = buildStore();
    store.set(wsClientAtom, { sendCommand, subscribe: vi.fn(() => () => {}) } as never);

    const { result } = renderHook(() => useGitSyncActions("ws-1"), {
      wrapper: wrapperFor(store),
    });

    let success = true;
    await act(async () => {
      success = await result.current.handleFetch();
    });

    expect(success).toBe(false);
    const fetchState = store.get(gitFetchAtomFamily("ws-1"));
    expect(fetchState.status).toBe("error");
    expect(fetchState.lastFetchAt).toBeUndefined();
    expect(fetchState.error).toContain("refreshing local git state failed");
  });
});

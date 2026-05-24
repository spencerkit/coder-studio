import { act, fireEvent, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { lastViewedTargetAtom } from "../../../atoms/app-ui";
import { wsClientAtom } from "../../../atoms/connection";
import { activeWorkspaceIdAtom, workspacesAtom } from "../../../atoms/workspaces";
import { customShortcutsAtom } from "../../../lib/shortcuts";
import { seedReadyWorkspaceState } from "../../../test-utils/workspace-state";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import { useWorkspaceNavigationShortcuts } from "./use-workspace-navigation-shortcuts";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useWorkspaceNavigationShortcuts", () => {
  it("moves to an adjacent session and persists both last viewed target and activeSessionId", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string, payload: unknown) => {
      if (op === "workspace.lastViewedTarget.set") {
        const target = payload as { workspaceId: string; sessionId?: string };
        return {
          workspaceId: target.workspaceId,
          sessionId: target.sessionId,
          updatedAt: 10,
        };
      }

      if (op === "workspace.uiState.set") {
        const { workspaceId, uiState } = payload as {
          workspaceId: string;
          uiState: { activeSessionId?: string };
        };

        const current = store.get(workspacesAtom)[workspaceId];
        return {
          ...current,
          uiState: {
            ...current.uiState,
            ...uiState,
          },
        };
      }

      return null;
    });

    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
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
          activeSessionId: "sess-left",
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(paneLayoutAtomFamily("ws-1"), {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", sessionId: "sess-left" },
        { id: "right", type: "leaf", sessionId: "sess-right" },
      ],
    });

    renderHook(() => useWorkspaceNavigationShortcuts("ws-1"), {
      wrapper: wrapperFor(store),
    });

    fireEvent.keyDown(window, { key: "ArrowRight", ctrlKey: true });

    await waitFor(() => {
      expect(store.get(lastViewedTargetAtom)).toMatchObject({
        workspaceId: "ws-1",
        sessionId: "sess-right",
      });
    });

    expect(store.get(workspacesAtom)["ws-1"]?.uiState.activeSessionId).toBe("sess-right");
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-1", sessionId: "sess-right" },
      undefined
    );
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-1",
        uiState: expect.objectContaining({
          activeSessionId: "sess-right",
        }),
      }),
      undefined
    );
  });

  it("switches to the next workspace through the existing selection path without mutating the current workspace active session", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (op: string, payload: unknown) => {
      if (op === "workspace.lastViewedTarget.set") {
        const target = payload as { workspaceId: string; sessionId?: string };
        return {
          workspaceId: target.workspaceId,
          sessionId: target.sessionId,
          updatedAt: 20,
        };
      }

      return null;
    });

    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
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
          activeSessionId: "sess-left",
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
          activeSessionId: "sess-other",
        },
      },
    });
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(paneLayoutAtomFamily("ws-1"), {
      id: "root",
      type: "leaf",
      sessionId: "sess-left",
    });
    store.set(customShortcutsAtom, {});

    renderHook(() => useWorkspaceNavigationShortcuts("ws-1"), {
      wrapper: wrapperFor(store),
    });

    fireEvent.keyDown(window, {
      key: "ArrowRight",
      ctrlKey: true,
      shiftKey: true,
    });

    await waitFor(() => {
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    });

    expect(store.get(lastViewedTargetAtom)).toMatchObject({
      workspaceId: "ws-2",
    });
    expect(store.get(workspacesAtom)["ws-1"]?.uiState.activeSessionId).toBe("sess-left");
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.lastViewedTarget.set",
      { workspaceId: "ws-2", sessionId: undefined },
      undefined
    );
    expect(sendCommand).not.toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({ workspaceId: "ws-1" }),
      undefined
    );
  });

  it("still handles matching workspace shortcuts even when the event is already defaultPrevented", async () => {
    const store = createStore();
    const sendCommand = vi.fn().mockImplementation(async (_op: string, payload: unknown) => {
      const target = payload as { workspaceId: string; sessionId?: string };
      return {
        workspaceId: target.workspaceId,
        sessionId: target.sessionId,
        updatedAt: 30,
      };
    });

    store.set(wsClientAtom, { sendCommand } as never);
    seedReadyWorkspaceState(store, {
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
    });
    store.set(activeWorkspaceIdAtom, "ws-1");

    renderHook(() => useWorkspaceNavigationShortcuts("ws-1"), {
      wrapper: wrapperFor(store),
    });

    const event = new KeyboardEvent("keydown", {
      key: "ArrowRight",
      ctrlKey: true,
      shiftKey: true,
      cancelable: true,
    });

    event.preventDefault();
    expect(event.defaultPrevented).toBe(true);

    act(() => {
      window.dispatchEvent(event);
    });

    await waitFor(() => {
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
    });
  });
});

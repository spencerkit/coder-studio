// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import {
  bottomPanelHeightAtomFamily,
  focusModeAtomFamily,
  leftPanelWidthAtomFamily,
} from "../atoms";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

describe("useWorkspaceUiStatePersistence", () => {
  it("persists the normalized pane layout atom instead of stale workspace uiState data", async () => {
    const sendCommand = vi.fn().mockImplementation(async (_op: string, payload: unknown) => {
      const { workspaceId, uiState } = payload as {
        workspaceId: string;
        uiState: Record<string, unknown>;
      };

      return {
        ...store.get(workspacesAtom)[workspaceId],
        uiState,
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
          leftPanelWidth: 240,
          bottomPanelHeight: 180,
          focusMode: false,
          paneLayout: {
            id: "root",
            type: "leaf",
            leafKind: "draft",
            sessionId: "stale-session-id",
          },
        },
      },
    } as never);
    store.set(leftPanelWidthAtomFamily("ws-test"), 280);
    store.set(bottomPanelHeightAtomFamily("ws-test"), 220);
    store.set(focusModeAtomFamily("ws-test"), true);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "draft",
    });

    const { result } = renderHook(() => useWorkspaceUiStatePersistence("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.persistUiState({ activeSessionId: "sess-1" });
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      {
        workspaceId: "ws-test",
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 220,
          focusMode: true,
          paneLayout: {
            id: "root",
            type: "leaf",
            leafKind: "draft",
          },
          activeSessionId: "sess-1",
        },
      },
      undefined
    );
  });
});

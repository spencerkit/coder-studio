// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import { paneLayoutAtomFamily } from "../../agent-panes/atoms/pane-layout";
import {
  activeEditorTabAtomFamily,
  bottomPanelHeightAtomFamily,
  editorViewVisibleAtomFamily,
  focusModeAtomFamily,
  leftPanelWidthAtomFamily,
  openEditorTabsAtomFamily,
} from "../atoms";
import { useWorkspaceUiStatePersistence } from "./use-workspace-ui-state-persistence";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function browserTab(id: string, url: string | null) {
  return {
    kind: "browser" as const,
    id,
    url,
    devicePreset: "desktop" as const,
    viewportWidth: null,
    viewportHeight: null,
    orientation: "portrait" as const,
    userAgentMode: "desktop" as const,
  };
}

describe("useWorkspaceUiStatePersistence", () => {
  it("persists ui state when the workspace record is missing uiState", async () => {
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
      },
    } as never);
    store.set(leftPanelWidthAtomFamily("ws-test"), 280);
    store.set(bottomPanelHeightAtomFamily("ws-test"), 220);
    store.set(focusModeAtomFamily("ws-test"), true);
    store.set(editorViewVisibleAtomFamily("ws-test"), false);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
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
          editorViewVisible: false,
          paneLayout: {
            id: "root",
            type: "leaf",
            leafKind: "editor",
          },
          activeSessionId: "sess-1",
        },
      },
      undefined
    );
  });

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
          editorViewVisible: false,
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

  it("persists browser editor tabs without writing devBrowserTargetUrl", async () => {
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
        },
      },
    } as never);
    store.set(leftPanelWidthAtomFamily("ws-test"), 280);
    store.set(bottomPanelHeightAtomFamily("ws-test"), 220);
    store.set(focusModeAtomFamily("ws-test"), true);
    store.set(editorViewVisibleAtomFamily("ws-test"), false);
    store.set(paneLayoutAtomFamily("ws-test"), {
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
    store.set(openEditorTabsAtomFamily("ws-test"), [
      browserTab("browser-1", "localhost:8001"),
      browserTab("browser-2", "localhost:8002"),
    ]);
    store.set(activeEditorTabAtomFamily("ws-test"), browserTab("browser-2", "localhost:8002"));

    const { result } = renderHook(() => useWorkspaceUiStatePersistence("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.persistUiState({});
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      {
        workspaceId: "ws-test",
        uiState: expect.objectContaining({
          leftPanelWidth: 280,
          bottomPanelHeight: 220,
          focusMode: true,
          editorViewVisible: false,
          openEditorTabs: [
            browserTab("browser-1", "localhost:8001"),
            browserTab("browser-2", "localhost:8002"),
          ],
          activeEditorTab: browserTab("browser-2", "localhost:8002"),
        }),
      },
      undefined
    );
    expect(sendCommand.mock.calls[0]?.[1]?.uiState).not.toHaveProperty("devBrowserTargetUrl");
  });

  it("persists browser tabs with device settings through workspace.uiState.set", async () => {
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
        },
      },
    } as never);
    store.set(leftPanelWidthAtomFamily("ws-test"), 280);
    store.set(bottomPanelHeightAtomFamily("ws-test"), 220);
    store.set(focusModeAtomFamily("ws-test"), true);
    store.set(editorViewVisibleAtomFamily("ws-test"), false);
    store.set(openEditorTabsAtomFamily("ws-test"), [
      {
        kind: "browser" as const,
        id: "browser-mobile",
        url: "localhost:8001",
        devicePreset: "iphone-14" as const,
        viewportWidth: 390,
        viewportHeight: 844,
        orientation: "portrait" as const,
        userAgentMode: "mobile" as const,
      },
    ]);
    store.set(activeEditorTabAtomFamily("ws-test"), {
      kind: "browser" as const,
      id: "browser-mobile",
      url: "localhost:8001",
      devicePreset: "iphone-14" as const,
      viewportWidth: 390,
      viewportHeight: 844,
      orientation: "portrait" as const,
      userAgentMode: "mobile" as const,
    });

    const { result } = renderHook(() => useWorkspaceUiStatePersistence("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.persistUiState({});
    });

    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      {
        workspaceId: "ws-test",
        uiState: expect.objectContaining({
          openEditorTabs: [
            {
              kind: "browser",
              id: "browser-mobile",
              url: "localhost:8001",
              devicePreset: "iphone-14",
              viewportWidth: 390,
              viewportHeight: 844,
              orientation: "portrait",
              userAgentMode: "mobile",
            },
          ],
          activeEditorTab: {
            kind: "browser",
            id: "browser-mobile",
            url: "localhost:8001",
            devicePreset: "iphone-14",
            viewportWidth: 390,
            viewportHeight: 844,
            orientation: "portrait",
            userAgentMode: "mobile",
          },
        }),
      },
      undefined
    );
  });
});

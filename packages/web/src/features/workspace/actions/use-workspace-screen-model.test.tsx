// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { authEnabledAtom, connectionStatusAtom, wsClientAtom } from "../../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspaceOrderAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../../atoms/workspaces";
import {
  activeEditorTabAtomFamily,
  editorViewVisibleAtomFamily,
  gitDiffPreviewAtomFamily,
} from "../atoms";
import { useWorkspaceScreenModel } from "./use-workspace-screen-model";

vi.mock("../../agent-panes/actions/use-pane-actions", () => ({
  usePaneActions: () => ({
    appendSessionToMobileColumn: vi.fn(),
  }),
}));

vi.mock("../../agent-panes/actions/use-session-actions", () => ({
  useSessionActions: () => ({
    closeSession: vi.fn(),
  }),
}));

vi.mock("../../agent-panes/actions/use-workspace-sessions", () => ({
  useWorkspaceSessions: () => ({
    sessions: [],
    paneLayout: {
      id: "root",
      type: "leaf",
      leafKind: "draft",
    },
  }),
}));

vi.mock("./use-workspace-layout-actions", () => ({
  useWorkspaceLayoutActions: () => ({}),
}));

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <Provider store={store}>{children}</Provider>;
  };
}

function browserTab(id: string, url: string | null) {
  return { kind: "browser" as const, id, url };
}

describe("useWorkspaceScreenModel", () => {
  it("treats a restored visible browser tab as editor mode after refresh", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          editorViewVisible: true,
          openEditorTabs: [browserTab("browser-1", "localhost:8001")],
          activeEditorTab: browserTab("browser-1", "localhost:8001"),
        },
      },
    } as never);
    store.set(activeEditorTabAtomFamily("ws-1"), browserTab("browser-1", "localhost:8001"));
    store.set(editorViewVisibleAtomFamily("ws-1"), true);
    store.set(gitDiffPreviewAtomFamily("ws-1"), null);

    const { result } = renderHook(() => useWorkspaceScreenModel(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.mainAreaMode).toBe("editor");
  });

  it("keeps a restored browser tab in agent mode when the editor view is hidden", () => {
    const store = createStore();
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(wsClientAtom, { sendCommand: vi.fn() } as never);
    store.set(workspacesLoadStateAtom, "ready");
    store.set(activeWorkspaceIdAtom, "ws-1");
    store.set(workspaceOrderAtom, ["ws-1"]);
    store.set(workspacesAtom, {
      "ws-1": {
        id: "ws-1",
        path: "/workspace",
        targetRuntime: "native",
        openedAt: 1,
        lastActiveAt: 1,
        uiState: {
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          editorViewVisible: false,
          openEditorTabs: [browserTab("browser-1", "localhost:8001")],
          activeEditorTab: browserTab("browser-1", "localhost:8001"),
        },
      },
    } as never);
    store.set(activeEditorTabAtomFamily("ws-1"), browserTab("browser-1", "localhost:8001"));
    store.set(editorViewVisibleAtomFamily("ws-1"), false);
    store.set(gitDiffPreviewAtomFamily("ws-1"), null);

    const { result } = renderHook(() => useWorkspaceScreenModel(), {
      wrapper: wrapperFor(store),
    });

    expect(result.current.mainAreaMode).toBe("agent");
  });
});

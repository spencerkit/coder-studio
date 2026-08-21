// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../atoms/activation";
import { authenticatedAtom, lastViewedTargetAtom, localeAtom } from "../atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom, wsClientAtom } from "../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../atoms/workspaces";
import { paneLayoutAtomFamily } from "../features/agent-panes/atoms/pane-layout";
import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  openEditorPathsAtomFamily,
  openEditorTabsAtomFamily,
  type WorkspaceBrowserEditorTab,
} from "../features/workspace/atoms";
import { useBootstrap } from "./use-bootstrap";

function wrapperFor(store: ReturnType<typeof createStore>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={["/workspace"]}>
        <Provider store={store}>{children}</Provider>
      </MemoryRouter>
    );
  };
}

function rawBrowserTab(id: string, url: string | null) {
  return { kind: "browser" as const, id, url };
}

function browserTab(
  id: string,
  url: string | null,
  overrides: Partial<WorkspaceBrowserEditorTab> = {}
): WorkspaceBrowserEditorTab {
  return {
    kind: "browser",
    id,
    url,
    devicePreset: "desktop",
    viewportWidth: null,
    viewportHeight: null,
    orientation: "portrait",
    userAgentMode: "desktop",
    ...overrides,
  };
}

describe("useBootstrap", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("hydrates persisted open editor metadata from the workspace list response", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.list") {
        return [
          {
            id: "ws-1",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: {
              leftPanelWidth: 280,
              bottomPanelHeight: 200,
              focusMode: false,
              openEditorPaths: ["src/app.tsx", "README.md", "src/app.tsx", ""],
              activeEditorPath: "src/app.tsx",
            },
          },
        ];
      }

      if (op === "workspace.lastViewedTarget.get") {
        return null;
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    store.set(wsClientAtom, { sendCommand } as never);
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "active");
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");

    const { result } = renderHook(() => useBootstrap(), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await waitFor(() => {
        expect(store.get(workspacesLoadStateAtom)).toBe("ready");
      });
    });

    expect(store.get(workspacesAtom)["ws-1"]?.uiState.openEditorPaths).toEqual([
      "src/app.tsx",
      "README.md",
    ]);
    expect(store.get(openEditorPathsAtomFamily("ws-1"))).toEqual(["src/app.tsx", "README.md"]);
    expect(store.get(activeFilePathAtomFamily("ws-1"))).toBe("src/app.tsx");
    expect(store.get(lastViewedTargetAtom)).toBeNull();
    expect(result.current).toBeUndefined();
  });

  it("hydrates multiple browser tabs and keeps the active browser tab", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.list") {
        return [
          {
            id: "ws-1",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: {
              leftPanelWidth: 280,
              bottomPanelHeight: 200,
              focusMode: false,
              openEditorTabs: [
                rawBrowserTab("browser-1", "localhost:8001"),
                rawBrowserTab("browser-2", "localhost:8002"),
              ],
              activeEditorTab: rawBrowserTab("browser-3", "localhost:8003"),
            },
          },
        ];
      }

      if (op === "workspace.lastViewedTarget.get") {
        return null;
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    store.set(wsClientAtom, { sendCommand } as never);
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "active");
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");

    renderHook(() => useBootstrap(), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await waitFor(() => {
        expect(store.get(workspacesLoadStateAtom)).toBe("ready");
      });
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      browserTab("browser-1", "localhost:8001"),
      browserTab("browser-2", "localhost:8002"),
      browserTab("browser-3", "localhost:8003"),
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(
      browserTab("browser-3", "localhost:8003")
    );
  });

  it("migrates legacy singleton browser state into one browser tab", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.list") {
        return [
          {
            id: "ws-1",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: {
              leftPanelWidth: 280,
              bottomPanelHeight: 200,
              focusMode: false,
              openEditorTabs: [{ kind: "browser", id: "dev-browser" }],
              activeEditorTab: { kind: "browser", id: "dev-browser" },
              devBrowserTargetUrl: "localhost:8001",
            },
          },
        ];
      }

      if (op === "workspace.lastViewedTarget.get") {
        return null;
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    store.set(wsClientAtom, { sendCommand } as never);
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "active");
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");

    renderHook(() => useBootstrap(), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await waitFor(() => {
        expect(store.get(workspacesLoadStateAtom)).toBe("ready");
      });
    });

    expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
      browserTab("dev-browser-legacy", "localhost:8001"),
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-1"))).toEqual(
      browserTab("dev-browser-legacy", "localhost:8001")
    );
    expect(store.get(workspacesAtom)["ws-1"]?.uiState).not.toHaveProperty("devBrowserTargetUrl");
  });

  it("hydrates the persisted pane layout from the workspace list response", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.list") {
        return [
          {
            id: "ws-1",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: {
              leftPanelWidth: 280,
              bottomPanelHeight: 200,
              focusMode: false,
              paneLayout: {
                id: "root",
                type: "split",
                direction: "horizontal",
                ratio: 0.6,
                children: [
                  {
                    id: "session-pane",
                    type: "leaf",
                    leafKind: "session",
                    sessionId: "sess-1",
                  },
                  {
                    id: "editor-pane",
                    type: "leaf",
                    leafKind: "editor",
                  },
                ],
              },
            },
          },
        ];
      }

      if (op === "workspace.lastViewedTarget.get") {
        return null;
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    store.set(wsClientAtom, { sendCommand } as never);
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "active");
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");

    renderHook(() => useBootstrap(), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await waitFor(() => {
        expect(store.get(workspacesLoadStateAtom)).toBe("ready");
      });
    });

    expect(store.get(paneLayoutAtomFamily("ws-1"))).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.6,
      children: [
        {
          id: "session-pane",
          type: "leaf",
          leafKind: "session",
          sessionId: "sess-1",
        },
        {
          id: "editor-pane",
          type: "leaf",
          leafKind: "editor",
        },
      ],
    });
  });

  it("prefetches workspace bootstrap data before activation becomes active", async () => {
    const store = createStore();
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "workspace.list") {
        return [
          {
            id: "ws-1",
            path: "/workspace",
            targetRuntime: "native",
            openedAt: 1,
            lastActiveAt: 1,
            uiState: {
              leftPanelWidth: 280,
              bottomPanelHeight: 200,
              focusMode: false,
            },
          },
        ];
      }

      if (op === "workspace.lastViewedTarget.get") {
        return {
          workspaceId: "ws-1",
          updatedAt: 10,
        };
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    store.set(wsClientAtom, { sendCommand } as never);
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "idle");
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");

    renderHook(() => useBootstrap(), {
      wrapper: wrapperFor(store),
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("workspace.list", {}, undefined);
      expect(sendCommand).toHaveBeenCalledWith("workspace.lastViewedTarget.get", {}, undefined);
    });

    expect(store.get(workspacesLoadStateAtom)).toBe("loading");
    expect(store.get(workspacesAtom)).toEqual({});

    act(() => {
      store.set(activationStatusAtom, "active");
    });

    await waitFor(() => {
      expect(store.get(workspacesLoadStateAtom)).toBe("ready");
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-1");
    });
  });

  it("revalidates a prefetched last viewed target before committing after activation", async () => {
    const store = createStore();
    let lastViewedTargetCallCount = 0;
    let resolveLatestTarget: ((value: { workspaceId: string; updatedAt: number }) => void) | null =
      null;
    const latestTargetPromise = new Promise<{ workspaceId: string; updatedAt: number }>(
      (resolve) => {
        resolveLatestTarget = resolve;
      }
    );

    const sendCommand = vi.fn((op: string) => {
      if (op === "workspace.list") {
        return Promise.resolve([
          {
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
          {
            id: "ws-2",
            path: "/workspace-2",
            targetRuntime: "native",
            openedAt: 2,
            lastActiveAt: 2,
            uiState: {
              leftPanelWidth: 300,
              bottomPanelHeight: 220,
              focusMode: false,
            },
          },
        ]);
      }

      if (op === "workspace.lastViewedTarget.get") {
        lastViewedTargetCallCount += 1;
        if (lastViewedTargetCallCount === 1) {
          return Promise.resolve({
            workspaceId: "ws-1",
            updatedAt: 10,
          });
        }
        if (lastViewedTargetCallCount === 2) {
          return latestTargetPromise;
        }
      }

      throw new Error(`Unexpected command: ${op}`);
    });

    store.set(wsClientAtom, { sendCommand } as never);
    store.set(connectionStatusAtom, "connected");
    store.set(authEnabledAtom, false);
    store.set(activationStatusAtom, "idle");
    store.set(authenticatedAtom, true);
    store.set(localeAtom, "en");

    renderHook(() => useBootstrap(), {
      wrapper: wrapperFor(store),
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("workspace.list", {}, undefined);
      expect(sendCommand).toHaveBeenCalledWith("workspace.lastViewedTarget.get", {}, undefined);
      expect(lastViewedTargetCallCount).toBe(1);
    });

    expect(store.get(workspacesLoadStateAtom)).toBe("loading");
    expect(store.get(activeWorkspaceIdAtom)).toBeNull();
    expect(store.get(lastViewedTargetAtom)).toBeNull();

    act(() => {
      store.set(activationStatusAtom, "active");
    });

    await waitFor(() => {
      expect(lastViewedTargetCallCount).toBe(2);
    });

    expect(store.get(workspacesLoadStateAtom)).toBe("loading");
    expect(store.get(activeWorkspaceIdAtom)).toBeNull();
    expect(store.get(lastViewedTargetAtom)).toBeNull();

    await act(async () => {
      resolveLatestTarget?.({
        workspaceId: "ws-2",
        updatedAt: 20,
      });
    });

    await waitFor(() => {
      expect(store.get(workspacesLoadStateAtom)).toBe("ready");
      expect(store.get(activeWorkspaceIdAtom)).toBe("ws-2");
      expect(store.get(lastViewedTargetAtom)).toEqual({
        workspaceId: "ws-2",
        updatedAt: 20,
      });
    });
  });
});

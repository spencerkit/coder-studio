// @vitest-environment jsdom

import { act, renderHook, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { activationStatusAtom } from "../atoms/activation";
import { authenticatedAtom, lastViewedTargetAtom, localeAtom } from "../atoms/app-ui";
import { authEnabledAtom, connectionStatusAtom, wsClientAtom } from "../atoms/connection";
import { workspacesAtom, workspacesLoadStateAtom } from "../atoms/workspaces";
import { activeFilePathAtomFamily, openEditorPathsAtomFamily } from "../features/workspace/atoms";
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
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../atoms/connection";
import { workspacesAtom } from "../../../atoms/workspaces";
import {
  editorRefreshTokenAtomFamily,
  expandedDirsAtomFamily,
  fileTreeAtomFamily,
  loadedDirsAtomFamily,
} from "../atoms";
import { useWorkspaceRefreshActions } from "./use-workspace-refresh-actions";

function RefreshHarness({ workspaceId }: { workspaceId: string }) {
  const { refreshWorkspace, status } = useWorkspaceRefreshActions(workspaceId);

  return (
    <>
      <button onClick={() => void refreshWorkspace()}>refresh workspace</button>
      <span data-testid="refresh-status">{status}</span>
    </>
  );
}

describe("useWorkspaceRefreshActions", () => {
  it("reloads root, expanded directories, and editor refresh token", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(async (op: string, args?: { subPath?: string }) => {
        if (op === "git.branches") {
          return {
            current: "main",
            branches: [{ name: "main", isRemote: false, isCurrent: true }],
          };
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

        if (op === "worktree.list") {
          return { worktrees: [] };
        }

        if (op === "file.readTree" && !args?.subPath) {
          return {
            path: "/workspace",
            children: [{ path: "src", name: "src", kind: "dir" }],
          };
        }

        if (op === "file.readTree" && args.subPath === "src") {
          return {
            path: "src",
            children: [{ path: "src/index.ts", name: "index.ts", kind: "file" }],
          };
        }

        throw new Error(`Unexpected command: ${op}`);
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
          leftPanelWidth: 280,
          bottomPanelHeight: 200,
          focusMode: false,
          fileTreeExpandedDirs: ["src"],
        },
      },
    } as never);
    store.set(expandedDirsAtomFamily("ws-test"), new Set(["src"]));
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(loadedDirsAtomFamily("ws-test"), new Set(["src"]));

    render(
      <Provider store={store}>
        <RefreshHarness workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "refresh workspace" }));

    await waitFor(() => {
      expect(store.get(editorRefreshTokenAtomFamily("ws-test"))).toBe(1);
      expect(store.get(fileTreeAtomFamily("ws-test"))?.get("src")).toEqual([
        { path: "src/index.ts", name: "index.ts", kind: "file" },
      ]);
    });
  });
});

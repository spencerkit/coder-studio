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
            children: [{ path: "src", name: "src", kind: "dir", isGitIgnored: false }],
          };
        }

        if (op === "file.readTree" && args.subPath === "src") {
          return {
            path: "src",
            children: [
              { path: "src/index.ts", name: "index.ts", kind: "file", isGitIgnored: false },
            ],
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
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [
          ".",
          [
            { path: "src", name: "src", kind: "dir", isGitIgnored: false },
            { path: "docs", name: "docs", kind: "dir", isGitIgnored: false },
          ],
        ],
        ["src", [{ path: "src/old.ts", name: "old.ts", kind: "file", isGitIgnored: false }]],
        ["docs", [{ path: "docs/guide.md", name: "guide.md", kind: "file", isGitIgnored: false }]],
      ])
    );
    store.set(loadedDirsAtomFamily("ws-test"), new Set(["src", "docs"]));

    render(
      <Provider store={store}>
        <RefreshHarness workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "refresh workspace" }));

    await waitFor(() => {
      expect(store.get(editorRefreshTokenAtomFamily("ws-test"))).toBe(1);
      expect(store.get(fileTreeAtomFamily("ws-test"))).toEqual(
        new Map([
          [".", [{ path: "src", name: "src", kind: "dir", isGitIgnored: false }]],
          ["src", [{ path: "src/index.ts", name: "index.ts", kind: "file", isGitIgnored: false }]],
        ])
      );
    });

    expect(Array.from(store.get(loadedDirsAtomFamily("ws-test")))).toEqual(["src"]);
  });

  it("skips stale descendant refreshes after a parent refresh prunes expanded paths", async () => {
    const sendCommand = vi
      .fn()
      .mockImplementation(
        async (op: string, args?: { subPath?: string; uiState?: Record<string, unknown> }) => {
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

          if (op === "workspace.uiState.set") {
            return {
              id: "ws-test",
              path: "/workspace",
              targetRuntime: "native",
              openedAt: 1,
              lastActiveAt: 1,
              uiState: args?.uiState,
            };
          }

          if (op === "file.readTree" && !args?.subPath) {
            return {
              path: "/workspace",
              children: [
                { path: "worktrees", name: "worktrees", kind: "dir", isGitIgnored: false },
              ],
            };
          }

          if (op === "file.readTree" && args.subPath === "worktrees") {
            return {
              path: "worktrees",
              children: [],
            };
          }

          throw new Error(`Unexpected command: ${op} ${args?.subPath ?? ""}`.trim());
        }
      );

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
          fileTreeExpandedDirs: ["worktrees", "worktrees/feature-agent-canvas"],
        },
      },
    } as never);
    store.set(
      fileTreeAtomFamily("ws-test"),
      new Map([
        [".", [{ path: "worktrees", name: "worktrees", kind: "dir", isGitIgnored: false }]],
        [
          "worktrees",
          [
            {
              path: "worktrees/feature-agent-canvas",
              name: "feature-agent-canvas",
              kind: "dir",
              isGitIgnored: false,
            },
          ],
        ],
        [
          "worktrees/feature-agent-canvas",
          [
            {
              path: "worktrees/feature-agent-canvas/output",
              name: "output",
              kind: "dir",
              isGitIgnored: false,
            },
          ],
        ],
      ])
    );
    store.set(
      expandedDirsAtomFamily("ws-test"),
      new Set(["worktrees", "worktrees/feature-agent-canvas"])
    );
    store.set(
      loadedDirsAtomFamily("ws-test"),
      new Set(["worktrees", "worktrees/feature-agent-canvas"])
    );

    render(
      <Provider store={store}>
        <RefreshHarness workspaceId="ws-test" />
      </Provider>
    );

    fireEvent.click(screen.getByRole("button", { name: "refresh workspace" }));

    await waitFor(() => {
      expect(Array.from(store.get(expandedDirsAtomFamily("ws-test")) ?? [])).toEqual(["worktrees"]);
    });

    expect(Array.from(store.get(loadedDirsAtomFamily("ws-test")))).toEqual(["worktrees"]);
    expect(sendCommand).toHaveBeenCalledWith(
      "workspace.uiState.set",
      expect.objectContaining({
        workspaceId: "ws-test",
        uiState: expect.objectContaining({ fileTreeExpandedDirs: ["worktrees"] }),
      }),
      undefined
    );
    expect(
      sendCommand.mock.calls.some(
        ([op, args]) =>
          op === "file.readTree" &&
          typeof args === "object" &&
          args !== null &&
          "subPath" in args &&
          (args as { subPath?: string }).subPath === "worktrees/feature-agent-canvas"
      )
    ).toBe(false);
  });
});

import type { WorktreeInfo } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { WorktreeDetailPanel } from "./worktree-detail-panel";

const worktree: WorktreeInfo = {
  name: "feature/mobile-sheet",
  path: "/tmp/coder-studio-feature",
  branch: "feature/mobile-sheet",
  commit: "abc1234",
  status: "dirty",
};

function buildStore(sendCommand: ReturnType<typeof vi.fn>) {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  return store;
}

describe("WorktreeDetailPanel", () => {
  it("loads status by default and renders commit/path metadata", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      status: {
        branch: "feature/mobile-sheet",
        ahead: 0,
        behind: 0,
        headSha: "abc1234567890",
        headShortSha: "abc1234",
        headSubject: "Initial mobile sheet setup",
        staged: [],
        modified: [],
        untracked: [],
        deleted: [],
      },
    });

    render(
      <Provider store={buildStore(sendCommand)}>
        <WorktreeDetailPanel workspaceId="ws-1" worktree={worktree} />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.status", {
        workspaceId: "ws-1",
        worktreePath: worktree.path,
      });
    });

    expect(screen.getByText("Path")).toBeInTheDocument();
    expect(screen.getByText(worktree.path)).toBeInTheDocument();
    expect(screen.getByText("Latest Commit")).toBeInTheDocument();
    expect(screen.getByText("abc1234")).toBeInTheDocument();
    expect(screen.getByText("Initial mobile sheet setup")).toBeInTheDocument();
  });

  it("reloads detail data when the tab changes", async () => {
    const sendCommand = vi.fn().mockImplementation(async (op: string) => {
      if (op === "worktree.status") {
        return {
          status: {
            branch: "feature/mobile-sheet",
            ahead: 0,
            behind: 0,
            headSha: "abc1234567890",
            headShortSha: "abc1234",
            headSubject: "Initial mobile sheet setup",
            staged: [],
            modified: [],
            untracked: [],
            deleted: [],
          },
        };
      }

      if (op === "worktree.diff") {
        return {
          diff: "diff --git a/src/app.tsx b/src/app.tsx",
        };
      }

      if (op === "worktree.tree") {
        return {
          tree: [],
        };
      }

      return {};
    });

    render(
      <Provider store={buildStore(sendCommand)}>
        <WorktreeDetailPanel workspaceId="ws-1" worktree={worktree} />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "Diff" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.diff", {
        workspaceId: "ws-1",
        worktreePath: worktree.path,
      });
    });

    expect(await screen.findByText("diff --git a/src/app.tsx b/src/app.tsx")).toBeInTheDocument();
  });
});

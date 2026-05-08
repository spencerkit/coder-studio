import type { Workspace, WorktreeInfo } from "@coder-studio/core";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { describe, expect, it, vi } from "vitest";
import { localeAtom } from "../../../../atoms/app-ui";
import { wsClientAtom } from "../../../../atoms/connection";
import { workspacesAtom } from "../../../../atoms/workspaces";
import { WorktreesSummaryCard } from "./worktrees-summary-card";

function buildWorkspace(path: string): Workspace {
  return {
    id: "ws-1",
    path,
    targetRuntime: "native",
    openedAt: Date.now(),
    lastActiveAt: Date.now(),
    uiState: {
      leftPanelWidth: 320,
      bottomPanelHeight: 240,
      focusMode: false,
    },
  };
}

function buildSummaryStore(sendCommand: ReturnType<typeof vi.fn>, workspacePath: string) {
  const store = createStore();
  store.set(localeAtom, "en");
  store.set(workspacesAtom, {
    "ws-1": buildWorkspace(workspacePath),
  });
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  return store;
}

describe("WorktreesSummaryCard", () => {
  it("loads worktrees on first render and shows total, dirty, and current", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "worktree.list") {
        return {
          worktrees: [
            {
              name: "main",
              path: "/repo/main",
              branch: "main",
              commit: "abc1234",
              status: "clean",
            },
            {
              name: "feature/mobile",
              path: "/repo/feature-mobile",
              branch: "feature/mobile",
              commit: "def5678",
              status: "dirty",
            },
          ] satisfies WorktreeInfo[],
        };
      }

      return {};
    });

    render(
      <Provider store={buildSummaryStore(sendCommand, "/repo/feature-mobile")}>
        <WorktreesSummaryCard workspaceId="ws-1" />
      </Provider>
    );

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith("worktree.list", { workspaceId: "ws-1" }, undefined);
    });

    expect(await screen.findByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByText("2 worktrees")).toBeInTheDocument();
    expect(screen.getByText("1 dirty")).toBeInTheDocument();
    expect(screen.getByText("Current: feature/mobile")).toBeInTheDocument();
  });

  it("opens the manager in create mode from the New action", async () => {
    render(
      <Provider
        store={buildSummaryStore(vi.fn().mockResolvedValue({ worktrees: [] }), "/repo/main")}
      >
        <WorktreesSummaryCard workspaceId="ws-1" />
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: "New" }));

    expect(await screen.findByText("Create Worktree")).toBeInTheDocument();
  });
});

import type { Session, WorkspacePaneNode } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSessionMiniMapCells,
  type WorkspaceSessionMiniMapCell,
} from "./workspace-session-mini-map-model";

function createSession(id: string, state: Session["state"], workspaceId = "ws-1"): Session {
  return {
    id,
    workspaceId,
    terminalId: `term-${id}`,
    providerId: "codex",
    state,
    capability: "full",
    startedAt: 1,
    lastActiveAt: 1,
  };
}

describe("workspace-session-mini-map-model", () => {
  it("projects a single running leaf into the center of the mini map", () => {
    const layout: WorkspacePaneNode = { id: "root", type: "leaf", sessionId: "sess-1" };
    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-1": createSession("sess-1", "running"),
    });

    expect(cells).toEqual<WorkspaceSessionMiniMapCell[]>([
      expect.objectContaining({
        paneId: "root",
        sessionId: "sess-1",
        state: "running",
        x: 0.5,
        y: 0.5,
      }),
    ]);
  });

  it("keeps horizontal and vertical pane relationships while defaulting missing ratios to 0.5", () => {
    const layout = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", sessionId: "sess-1" },
        {
          id: "right-split",
          type: "split",
          direction: "vertical",
          children: [
            { id: "top-right", type: "leaf", sessionId: "sess-2" },
            { id: "bottom-right", type: "leaf" },
          ],
        },
      ],
    } satisfies WorkspacePaneNode & { ratio?: number };

    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-1": createSession("sess-1", "idle"),
      "sess-2": createSession("sess-2", "starting"),
    });

    expect(cells).toEqual([
      expect.objectContaining({ paneId: "left", state: "idle", x: 0.25, y: 0.5 }),
      expect.objectContaining({ paneId: "top-right", state: "starting", x: 0.75, y: 0.25 }),
      expect.objectContaining({ paneId: "bottom-right", state: "empty", x: 0.75, y: 0.75 }),
    ]);
  });

  it("treats draft, ended, and missing sessions as empty panes", () => {
    const layout: WorkspacePaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "draft-pane", type: "leaf", sessionId: "sess-draft" },
        { id: "ended-pane", type: "leaf", sessionId: "sess-ended" },
      ],
    };

    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-draft": createSession("sess-draft", "draft"),
      "sess-ended": createSession("sess-ended", "ended"),
    });

    expect(cells.map((cell) => [cell.paneId, cell.state])).toEqual([
      ["draft-pane", "empty"],
      ["ended-pane", "empty"],
    ]);
  });

  it("falls back to a single empty root pane when no layout exists", () => {
    expect(buildWorkspaceSessionMiniMapCells(undefined, {})).toEqual([
      expect.objectContaining({
        paneId: "root",
        sessionId: null,
        state: "empty",
        x: 0.5,
        y: 0.5,
      }),
    ]);
  });
});

import type { Session, WorkspacePaneNode } from "@coder-studio/core";
import { describe, expect, it } from "vitest";
import {
  buildWorkspaceSessionMiniMapCells,
  measureWorkspaceSessionMiniMapColumns,
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
  it("projects a single running leaf into a full-tab region", () => {
    const layout: WorkspacePaneNode = { id: "root", type: "leaf", sessionId: "sess-1" };
    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-1": createSession("sess-1", "running"),
    });

    expect(cells).toEqual<WorkspaceSessionMiniMapCell[]>([
      expect.objectContaining({
        paneId: "root",
        sessionId: "sess-1",
        state: "running",
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ]);
  });

  it("keeps pane relationships while giving each horizontal column the same width", () => {
    const layout = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.8,
      children: [
        { id: "left", type: "leaf", sessionId: "sess-1" },
        {
          id: "right-split",
          type: "split",
          direction: "vertical",
          ratio: 0.1,
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
      expect.objectContaining({
        paneId: "left",
        state: "idle",
        x: 0,
        y: 0,
        width: 0.5,
        height: 1,
      }),
      expect.objectContaining({
        paneId: "top-right",
        state: "starting",
        x: 0.5,
        y: 0,
        width: 0.5,
        height: 0.5,
      }),
      expect.objectContaining({
        paneId: "bottom-right",
        state: "empty",
        x: 0.5,
        y: 0.5,
        width: 0.5,
        height: 0.5,
      }),
    ]);
  });

  it("expands horizontally when nested splits add more columns", () => {
    const layout: WorkspacePaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", sessionId: "sess-1" },
        {
          id: "right",
          type: "split",
          direction: "horizontal",
          children: [
            { id: "center", type: "leaf", sessionId: "sess-2" },
            { id: "right", type: "leaf", sessionId: "sess-3" },
          ],
        },
      ],
    };

    const cells = buildWorkspaceSessionMiniMapCells(layout, {
      "sess-1": createSession("sess-1", "idle"),
      "sess-2": createSession("sess-2", "running"),
      "sess-3": createSession("sess-3", "starting"),
    });

    expect(cells[0]).toEqual(expect.objectContaining({ paneId: "left" }));
    expect(cells[0]?.x).toBeCloseTo(0);
    expect(cells[0]?.width).toBeCloseTo(1 / 3);
    expect(cells[1]).toEqual(expect.objectContaining({ paneId: "center" }));
    expect(cells[1]?.x).toBeCloseTo(1 / 3);
    expect(cells[1]?.width).toBeCloseTo(1 / 3);
    expect(cells[2]).toEqual(expect.objectContaining({ paneId: "right" }));
    expect(cells[2]?.x).toBeCloseTo(2 / 3);
    expect(cells[2]?.width).toBeCloseTo(1 / 3);
    expect(measureWorkspaceSessionMiniMapColumns(layout)).toBe(3);
  });

  it("measures horizontal leaf columns so the mini map can grow in width", () => {
    const layout: WorkspacePaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf" },
        {
          id: "right",
          type: "split",
          direction: "vertical",
          children: [
            { id: "top-right", type: "leaf" },
            { id: "bottom-right", type: "leaf" },
          ],
        },
      ],
    };

    expect(measureWorkspaceSessionMiniMapColumns(layout)).toBe(2);
    expect(measureWorkspaceSessionMiniMapColumns(undefined)).toBe(1);
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
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ]);
  });
});

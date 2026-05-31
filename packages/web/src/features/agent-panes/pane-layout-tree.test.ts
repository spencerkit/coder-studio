import { describe, expect, it, vi } from "vitest";
import type { PaneNode } from "./atoms/pane-layout";
import {
  appendSessionToLayout,
  appendSessionToWidestColumn,
  assignSessionToPane,
  closeDraftPaneById,
  closeEditorPaneById,
  closePaneBySessionId,
  convertDraftPaneToEditor,
  createFallbackPaneLayout,
  enforceSingleEditorPaneInvariant,
  findEditorPaneId,
  insertPaneAtEdge,
  removePaneBySessionId,
  splitPaneByPaneId,
  splitPaneBySessionId,
  swapPaneLeavesByPaneId,
  swapPaneSessionsByPaneId,
} from "./pane-layout-tree";

describe("pane-layout-tree", () => {
  it("converts a draft leaf into an editor leaf by pane id", () => {
    const layout: PaneNode = {
      id: "root",
      type: "leaf",
      leafKind: "draft",
    };

    expect(convertDraftPaneToEditor(layout, "root")).toEqual({
      id: "root",
      type: "leaf",
      leafKind: "editor",
    });
  });

  it("keeps the existing editor leaf when another draft tries to convert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "draft" },
      ],
    };

    expect(convertDraftPaneToEditor(layout, "right")).toBe(layout);
  });

  it("collapses extra editor leaves back to drafts when enforcing the invariant", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "editor" },
      ],
    };

    expect(enforceSingleEditorPaneInvariant(layout)).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "draft" },
      ],
    });
    expect(findEditorPaneId(layout)).toBe("left");
  });

  it("turns a closed editor leaf back into a draft leaf while preserving siblings", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    };

    expect(closeEditorPaneById(layout, "left")).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "draft" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    });
  });

  it("splits a session leaf into the original session and a draft pane", () => {
    const layout: PaneNode = {
      id: "root",
      type: "leaf",
      sessionId: "sess_1",
    };

    const nextLayout = splitPaneBySessionId(layout, "sess_1", "vertical");

    expect(nextLayout).toEqual(
      expect.objectContaining({
        type: "split",
        direction: "vertical",
        ratio: 0.5,
        children: [
          expect.objectContaining({ type: "leaf", sessionId: "sess_1" }),
          expect.objectContaining({ type: "leaf" }),
        ],
      })
    );
  });

  it("turns the closed session pane into a draft leaf while preserving split layout", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    const nextLayout = closePaneBySessionId(layout, "sess_1");

    expect(nextLayout).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    });
  });

  it("removes a session pane and collapses the split when explicitly requested", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(removePaneBySessionId(layout, "sess_2")).toEqual({
      id: "left",
      type: "leaf",
      sessionId: "sess_1",
    });
  });

  it("assigns a session to the matching draft pane without touching siblings", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf" },
      ],
    };

    expect(assignSessionToPane(layout, "right", "sess_3")).toEqual({
      id: "root",
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_3" },
      ],
    });
  });

  it("swaps session ids between two session panes without changing pane ids", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(swapPaneSessionsByPaneId(layout, "left", "right")).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_2" },
        { id: "right", type: "leaf", sessionId: "sess_1" },
      ],
    });
  });

  it("returns the original tree when swap source pane is a draft leaf", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(swapPaneSessionsByPaneId(layout, "left", "right")).toBe(layout);
  });

  it("returns the original tree when swap target pane is a draft leaf", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf" },
      ],
    };

    expect(swapPaneSessionsByPaneId(layout, "left", "right")).toBe(layout);
  });

  it("returns the original tree when swap source pane is missing", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(swapPaneSessionsByPaneId(layout, "missing", "right")).toBe(layout);
  });

  it("returns the original tree when swap target pane is missing", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(swapPaneSessionsByPaneId(layout, "left", "missing")).toBe(layout);
  });

  it("swaps editor and session leaf contents without changing pane ids", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    };

    expect(swapPaneLeavesByPaneId(layout, "left", "right")).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "session", sessionId: "sess_2" },
        { id: "right", type: "leaf", leafKind: "editor" },
      ],
    });
  });

  it("wraps the target leaf with a horizontal split on left insert", () => {
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1700000000000);

    try {
      const layout: PaneNode = {
        id: "root",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      };

      expect(insertPaneAtEdge(layout, "left", "right", "left")).toEqual({
        id: "split-right-left-1700000000000",
        type: "split",
        direction: "horizontal",
        ratio: 0.5,
        children: [
          { id: "left", type: "leaf", sessionId: "sess_1" },
          { id: "right", type: "leaf", sessionId: "sess_2" },
        ],
      });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("wraps the target leaf with a horizontal split on right insert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "right", "right")).toEqual({
      id: expect.stringMatching(/^split-right-right-/),
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "right", type: "leaf", sessionId: "sess_2" },
        { id: "left", type: "leaf", sessionId: "sess_1" },
      ],
    });
  });

  it("wraps the target leaf with a vertical split on top insert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "right", "top")).toEqual({
      id: expect.stringMatching(/^split-right-top-/),
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    });
  });

  it("wraps the target leaf with a vertical split on bottom insert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "right", "bottom")).toEqual({
      id: expect.stringMatching(/^split-right-bottom-/),
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { id: "right", type: "leaf", sessionId: "sess_2" },
        { id: "left", type: "leaf", sessionId: "sess_1" },
      ],
    });
  });

  it("wraps a session target with an editor source on edge insert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "right", "left")).toEqual({
      id: expect.stringMatching(/^split-right-left-/),
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "editor" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    });
  });

  it("wraps a session target with a draft source on edge insert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", leafKind: "draft" },
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "right", "right")).toEqual({
      id: expect.stringMatching(/^split-right-right-/),
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "right", type: "leaf", leafKind: "session", sessionId: "sess_2" },
        { id: "left", type: "leaf", leafKind: "draft" },
      ],
    });
  });

  it("returns the original tree when attempting to drag onto the same pane", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf", sessionId: "sess_2" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "left", "left")).toBe(layout);
    expect(swapPaneSessionsByPaneId(layout, "left", "left")).toBe(layout);
  });

  it("wraps a draft target leaf on edge insert", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf" },
      ],
    };

    expect(insertPaneAtEdge(layout, "left", "right", "right")).toEqual({
      id: expect.stringMatching(/^split-right-right-/),
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "right", type: "leaf" },
        { id: "left", type: "leaf", sessionId: "sess_1" },
      ],
    });
  });

  it("splits a draft pane by pane id without relying on a session id marker", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf" },
      ],
    };

    expect(splitPaneByPaneId(layout, "right", "vertical")).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        {
          id: expect.stringMatching(/^split-right-vertical-/),
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [{ id: "right", type: "leaf" }, expect.objectContaining({ type: "leaf" })],
        },
      ],
    });
  });

  it("closes a draft pane by pane id and collapses the split when only one sibling remains", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        { id: "right", type: "leaf" },
      ],
    };

    expect(closeDraftPaneById(layout, "right")).toEqual({
      id: "left",
      type: "leaf",
      sessionId: "sess_1",
    });
  });

  it("returns an empty draft leaf when the final pane is closed", () => {
    const layout: PaneNode = {
      id: "root",
      type: "leaf",
      sessionId: "sess_1",
    };

    expect(closePaneBySessionId(layout, "sess_1")).toEqual({
      id: "root",
      type: "leaf",
    });
  });

  it("appends a new session with a vertical split when requested", () => {
    const layout: PaneNode = {
      id: "root",
      type: "leaf",
      sessionId: "sess_1",
    };

    expect(appendSessionToLayout(layout, "sess_2", "sess_1", "vertical")).toEqual({
      id: expect.stringMatching(/^split-root-vertical-/),
      type: "split",
      direction: "vertical",
      ratio: 0.5,
      children: [
        { id: "root", type: "leaf", sessionId: "sess_1" },
        expect.objectContaining({ type: "leaf", sessionId: "sess_2" }),
      ],
    });
  });

  it("appends a session beside an existing editor leaf without replacing the layout", () => {
    const layout: PaneNode = {
      id: "editor-pane",
      type: "leaf",
      leafKind: "editor",
    };

    expect(appendSessionToLayout(layout, "sess_2")).toEqual({
      id: expect.stringMatching(/^split-editor-pane-horizontal-/),
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "editor-pane", type: "leaf", leafKind: "editor" },
        expect.objectContaining({
          type: "leaf",
          leafKind: "session",
          sessionId: "sess_2",
        }),
      ],
    });
  });

  it("appends a new session by splitting the widest column horizontally", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.3,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        {
          id: "right-column",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { id: "right-top", type: "leaf", sessionId: "sess_2" },
            { id: "right-bottom", type: "leaf", sessionId: "sess_3" },
          ],
        },
      ],
    };

    expect(appendSessionToWidestColumn(layout, "sess_4")).toEqual({
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.3,
      children: [
        { id: "left", type: "leaf", sessionId: "sess_1" },
        {
          id: expect.stringMatching(/^split-right-column-horizontal-/),
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            {
              id: "right-column",
              type: "split",
              direction: "vertical",
              ratio: 0.5,
              children: [
                { id: "right-top", type: "leaf", sessionId: "sess_2" },
                { id: "right-bottom", type: "leaf", sessionId: "sess_3" },
              ],
            },
            expect.objectContaining({ type: "leaf", sessionId: "sess_4" }),
          ],
        },
      ],
    });
  });

  it("creates a fallback pane layout that includes all live sessions", () => {
    expect(createFallbackPaneLayout(["sess_1", "sess_2", "sess_3"])).toEqual({
      id: "split-fallback-1",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "fallback-leaf-1", type: "leaf", leafKind: "session", sessionId: "sess_1" },
        {
          id: "split-fallback-2",
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { id: "fallback-leaf-2", type: "leaf", leafKind: "session", sessionId: "sess_2" },
            { id: "fallback-leaf-3", type: "leaf", leafKind: "session", sessionId: "sess_3" },
          ],
        },
      ],
    });
  });
});

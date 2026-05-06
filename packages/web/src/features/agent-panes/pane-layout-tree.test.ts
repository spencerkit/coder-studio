import { describe, expect, it } from "vitest";
import type { PaneNode } from "./atoms/pane-layout";
import {
  appendSessionToLayout,
  assignSessionToPane,
  closeDraftPaneById,
  closePaneBySessionId,
  createFallbackPaneLayout,
  splitPaneByPaneId,
  splitPaneBySessionId,
} from "./pane-layout-tree";

describe("pane-layout-tree", () => {
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

  it("creates a fallback pane layout that includes all live sessions", () => {
    expect(createFallbackPaneLayout(["sess_1", "sess_2", "sess_3"])).toEqual({
      id: "split-fallback-1",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "fallback-leaf-1", type: "leaf", sessionId: "sess_1" },
        {
          id: "split-fallback-2",
          type: "split",
          direction: "horizontal",
          ratio: 0.5,
          children: [
            { id: "fallback-leaf-2", type: "leaf", sessionId: "sess_2" },
            { id: "fallback-leaf-3", type: "leaf", sessionId: "sess_3" },
          ],
        },
      ],
    });
  });
});

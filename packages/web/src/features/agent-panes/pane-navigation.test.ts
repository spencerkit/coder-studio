import { describe, expect, it } from "vitest";
import type { PaneNode } from "./atoms/pane-layout";
import { findAdjacentSessionId } from "./pane-navigation";

describe("pane-navigation", () => {
  it("finds horizontal neighbors in a simple split", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess-left" },
        { id: "right", type: "leaf", sessionId: "sess-right" },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess-left", "right")).toBe("sess-right");
    expect(findAdjacentSessionId(layout, "sess-right", "left")).toBe("sess-left");
  });

  it("returns null when no candidate exists in the requested direction", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        { id: "left", type: "leaf", sessionId: "sess-left" },
        { id: "right", type: "leaf", sessionId: "sess-right" },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess-left", "left")).toBeNull();
    expect(findAdjacentSessionId(layout, "sess-right", "right")).toBeNull();
  });

  it("follows visible geometry in a 2x2 layout", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.5,
      children: [
        {
          id: "left-column",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { id: "top-left", type: "leaf", sessionId: "sess-top-left" },
            { id: "bottom-left", type: "leaf", sessionId: "sess-bottom-left" },
          ],
        },
        {
          id: "right-column",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { id: "top-right", type: "leaf", sessionId: "sess-top-right" },
            { id: "bottom-right", type: "leaf", sessionId: "sess-bottom-right" },
          ],
        },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess-top-left", "right")).toBe("sess-top-right");
    expect(findAdjacentSessionId(layout, "sess-top-left", "down")).toBe("sess-bottom-left");
    expect(findAdjacentSessionId(layout, "sess-bottom-right", "up")).toBe("sess-top-right");
    expect(findAdjacentSessionId(layout, "sess-bottom-right", "left")).toBe("sess-bottom-left");
  });

  it("ignores draft leaves when choosing the next session", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 1 / 3,
      children: [
        { id: "left", type: "leaf", sessionId: "sess-left" },
        {
          id: "right-stack",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { id: "right-top", type: "leaf" },
            { id: "right-bottom", type: "leaf", sessionId: "sess-bottom-right" },
          ],
        },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess-left", "right")).toBe("sess-bottom-right");
  });

  it("breaks ties by the smallest perpendicular center delta", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.4,
      children: [
        {
          id: "left-stack",
          type: "split",
          direction: "vertical",
          ratio: 0.4,
          children: [
            {
              id: "active-row",
              type: "split",
              direction: "horizontal",
              ratio: 0.5,
              children: [
                { id: "active", type: "leaf", sessionId: "sess-active" },
                { id: "draft", type: "leaf" },
              ],
            },
            { id: "bottom-left", type: "leaf", sessionId: "sess-bottom-left" },
          ],
        },
        {
          id: "right-stack",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { id: "top-right", type: "leaf", sessionId: "sess-top-right" },
            { id: "bottom-right", type: "leaf", sessionId: "sess-bottom-right" },
          ],
        },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess-active", "right")).toBe("sess-top-right");
  });

  it("prefers the nearest edge before perpendicular center distance", () => {
    const layout: PaneNode = {
      id: "root",
      type: "split",
      direction: "horizontal",
      ratio: 0.25,
      children: [
        {
          id: "left-stack",
          type: "split",
          direction: "vertical",
          ratio: 0.5,
          children: [
            { id: "active", type: "leaf", sessionId: "sess-active" },
            { id: "bottom-left", type: "leaf", sessionId: "sess-bottom-left" },
          ],
        },
        {
          id: "right-region",
          type: "split",
          direction: "horizontal",
          ratio: 1 / 3,
          children: [
            {
              id: "near-column",
              type: "split",
              direction: "vertical",
              ratio: 0.9,
              children: [
                { id: "near-right", type: "leaf", sessionId: "sess-near-right" },
                { id: "bottom-middle", type: "leaf", sessionId: "sess-bottom-middle" },
              ],
            },
            {
              id: "far-column",
              type: "split",
              direction: "vertical",
              ratio: 0.6,
              children: [
                { id: "far-right", type: "leaf", sessionId: "sess-far-right" },
                { id: "bottom-right", type: "leaf", sessionId: "sess-bottom-right" },
              ],
            },
          ],
        },
      ],
    };

    expect(findAdjacentSessionId(layout, "sess-active", "right")).toBe("sess-near-right");
  });
});

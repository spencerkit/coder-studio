// @vitest-environment jsdom

import type { CanvasAnchorCommentDocument } from "@coder-studio/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CanvasCommentLayer } from "./canvas-comment-layer";

const comments: CanvasAnchorCommentDocument = {
  version: 1,
  comments: [
    {
      id: "comment-open",
      elementIds: ["chart-point:prompt:10:00"],
      targets: [],
      selectionRect: { x: 112, y: 40, width: 28, height: 24 },
      body: "Explain this peak.",
      status: "open",
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    },
    {
      id: "comment-resolved",
      elementIds: ["chart-point:completion:11:00"],
      targets: [],
      selectionRect: { x: 220, y: 96, width: 24, height: 24 },
      body: "Resolved note.",
      status: "resolved",
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    },
  ],
};

describe("CanvasCommentLayer", () => {
  it("renders saved comments as anchored bubbles", () => {
    render(<CanvasCommentLayer document={comments} />);

    expect(screen.getByText("Explain this peak.")).toBeInTheDocument();
    expect(screen.getByText("Resolved note.")).toBeInTheDocument();
  });

  it("marks resolved comments with a weaker style hook", () => {
    render(<CanvasCommentLayer document={comments} />);

    expect(screen.getByTestId("canvas-comment-comment-resolved")).toHaveClass(
      "canvas-comment-layer__item--resolved"
    );
  });
});

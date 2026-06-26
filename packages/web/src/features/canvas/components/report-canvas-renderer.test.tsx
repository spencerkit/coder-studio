// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ReportCanvasRenderer } from "./report-canvas-renderer";

describe("ReportCanvasRenderer", () => {
  it("renders markdown blocks as formatted markdown content", () => {
    render(
      <ReportCanvasRenderer
        canvas={{
          kind: "report_canvas",
          title: "Audit",
          sections: [
            {
              type: "section",
              title: "Key Findings",
              blocks: [
                {
                  type: "markdown",
                  markdown:
                    "This **matters**. Review the [docs](https://example.com/docs).\n\n- First item\n- Second item\n\n```ts\nconst score = 1;\n```",
                },
              ],
            },
          ],
        }}
      />
    );

    expect(screen.getByText("Key Findings")).toBeInTheDocument();
    expect(screen.getByText("matters").closest("strong")).not.toBeNull();
    expect(screen.getByRole("link", { name: "docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs"
    );
    expect(screen.getByText("First item").closest("li")).not.toBeNull();
    expect(screen.getByText("Second item").closest("li")).not.toBeNull();
    expect(screen.getByText("const score = 1;").closest("code")).not.toBeNull();
  });
});

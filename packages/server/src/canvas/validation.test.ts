import { describe, expect, it } from "vitest";
import { validateCanvasSource } from "./validation.js";

describe("validateCanvasSource", () => {
  it("accepts a valid architecture canvas envelope", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Runtime Flow",
        document: {
          summary: "How requests move.",
          diagram: {
            dsl: "mermaid",
            source: ["WebUI[Web UI]", "Server[Runtime Server]", "WebUI -->|dispatch| Server"].join(
              "\n"
            ),
          },
          annotations: [{ title: "Boundary", body: "Server owns execution." }],
        },
      })
    );

    expect(result).toEqual({
      ok: true,
      document: expect.objectContaining({
        kind: "architecture_canvas",
        title: "Runtime Flow",
      }),
    });
  });

  it("accepts a valid report canvas envelope", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "report_canvas",
        title: "Audit",
        document: {
          summary: "Workspace audit.",
          stats: [{ label: "Packages", value: 6 }],
          sections: [
            {
              title: "Findings",
              blocks: [{ type: "markdown", markdown: "Server owns rendering." }],
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      ok: true,
      document: expect.objectContaining({
        kind: "report_canvas",
        title: "Audit",
      }),
    });
  });

  it("accepts a valid report canvas envelope with a chart block", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "report_canvas",
        title: "Audit",
        document: {
          summary: "Workspace audit.",
          stats: [{ label: "Packages", value: 6 }],
          sections: [
            {
              title: "Findings",
              blocks: [
                {
                  type: "chart",
                  kind: "bar",
                  title: "Package trends",
                  categories: ["Jan", "Feb"],
                  series: [{ name: "Packages", values: [6, 7] }],
                },
              ],
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      ok: true,
      document: expect.objectContaining({
        kind: "report_canvas",
        title: "Audit",
      }),
    });
  });

  it("reports a zod field path for invalid envelopes", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Broken",
        document: {
          summary: "How requests move.",
          diagram: {
            dsl: "mermaid",
            source: "",
          },
          annotations: [],
        },
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        category: "validation_error",
        message: expect.any(String),
        fieldPath: "document.diagram.source",
      },
    });
  });

  it("blocks raw html-like strings in source fields", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Broken",
        document: {
          summary: "How requests move.",
          diagram: {
            dsl: "mermaid",
            source: "<div>WebUI[Web]</div>",
          },
          annotations: [],
        },
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        category: "validation_error",
        message: "Canvas source must not contain raw HTML",
        fieldPath: "document.diagram.source",
      },
    });
  });

  it("rejects raw html-like strings in architecture summary fields", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "architecture_canvas",
        title: "Broken",
        document: {
          summary: "<section>How requests move.</section>",
          diagram: {
            dsl: "mermaid",
            source: "WebUI",
          },
          annotations: [],
        },
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        category: "validation_error",
        message: "Canvas source must not contain raw HTML",
        fieldPath: "document.summary",
      },
    });
  });

  it("rejects raw html-like strings in report markdown blocks", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "report_canvas",
        title: "Broken",
        document: {
          summary: "Workspace audit.",
          stats: [],
          sections: [
            {
              title: "Findings",
              blocks: [
                {
                  type: "markdown",
                  markdown: "<div>Server owns rendering.</div>",
                },
              ],
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        category: "validation_error",
        message: "Canvas source must not contain raw HTML",
        fieldPath: "document.sections.0.blocks.0.markdown",
      },
    });
  });

  it("rejects report chart series with mismatched values lengths", () => {
    const result = validateCanvasSource(
      JSON.stringify({
        version: 1,
        kind: "report_canvas",
        title: "Broken",
        document: {
          summary: "Workspace audit.",
          stats: [],
          sections: [
            {
              title: "Findings",
              blocks: [
                {
                  type: "chart",
                  kind: "line",
                  title: "Package trends",
                  categories: ["Jan", "Feb"],
                  series: [{ name: "Packages", values: [6] }],
                },
              ],
            },
          ],
        },
      })
    );

    expect(result).toEqual({
      ok: false,
      error: {
        category: "validation_error",
        message: expect.any(String),
        fieldPath: "document.sections.0.blocks.0.series.0.values",
      },
    });
  });
});

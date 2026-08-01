// @vitest-environment jsdom

import type { ReportChartBlock } from "@coder-studio/core";
import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const chartRendererMock = vi.hoisted(() => ({
  render: vi.fn(({ block }: { block: ReportChartBlock }) => (
    <div data-testid="report-canvas-chart-mock">{block.title}</div>
  )),
}));

vi.mock("./report-canvas-chart-renderer", () => ({
  ReportCanvasChartRenderer: (props: { block: ReportChartBlock }) =>
    chartRendererMock.render(props),
}));

const { ReportCanvasRenderer } = await import("./report-canvas-renderer");
const { createCanvasSceneRegistry } = await import("./canvas-scene-registry");

function createRect(
  input: Partial<DOMRect> & { left: number; top: number; width: number; height: number }
) {
  return {
    x: input.left,
    y: input.top,
    left: input.left,
    top: input.top,
    width: input.width,
    height: input.height,
    right: input.left + input.width,
    bottom: input.top + input.height,
    toJSON: () => ({}),
  } as DOMRect;
}

function SceneManifestHarness(props: {
  canvas: Parameters<typeof ReportCanvasRenderer>[0]["canvas"];
  onManifestChange: (manifest: {
    version: 1;
    elements: Array<{
      id: string;
      kind: string;
      rect: { x: number; y: number; width: number; height: number };
    }>;
  }) => void;
}) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [sceneRegistry] = useState(() => createCanvasSceneRegistry());

  useEffect(
    () => sceneRegistry.subscribe(props.onManifestChange),
    [props.onManifestChange, sceneRegistry]
  );

  return (
    <div data-scene-root="true" ref={rootRef}>
      <ReportCanvasRenderer
        canvas={props.canvas}
        sceneRegistry={sceneRegistry}
        sceneRootRef={rootRef}
      />
    </div>
  );
}

describe("ReportCanvasRenderer", () => {
  let getBoundingClientRectSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    chartRendererMock.render.mockClear();
    getBoundingClientRectSpy = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function mockGetBoundingClientRect(this: HTMLElement) {
        if (this.dataset.sceneRoot === "true") {
          return createRect({ left: 10, top: 20, width: 960, height: 720 });
        }

        switch (this.dataset.sceneId) {
          case "report-stat:section-0:block-0:item-0":
            return createRect({ left: 30, top: 44, width: 140, height: 76 });
          case "report-stat:section-0:block-0:item-1":
            return createRect({ left: 180, top: 44, width: 140, height: 76 });
          case "chart-block:section-0:block-1":
            return createRect({ left: 30, top: 136, width: 420, height: 240 });
          case "callout:section-0:block-2":
            return createRect({ left: 30, top: 392, width: 420, height: 104 });
          case "table-cell:section-0:block-3:row-0:col-0":
            return createRect({ left: 30, top: 512, width: 140, height: 44 });
          case "table-cell:section-0:block-3:row-0:col-1":
            return createRect({ left: 180, top: 512, width: 140, height: 44 });
          case "table-cell:section-0:block-3:row-1:col-0":
            return createRect({ left: 30, top: 564, width: 140, height: 44 });
          case "table-cell:section-0:block-3:row-1:col-1":
            return createRect({ left: 180, top: 564, width: 140, height: 44 });
          default:
            return createRect({ left: 0, top: 0, width: 0, height: 0 });
        }
      });
  });

  afterEach(() => {
    getBoundingClientRectSpy?.mockRestore();
    getBoundingClientRectSpy = undefined;
  });

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

  it("delegates chart blocks to the chart renderer", () => {
    render(
      <ReportCanvasRenderer
        canvas={{
          kind: "report_canvas",
          title: "Audit",
          sections: [
            {
              type: "section",
              title: "Usage",
              blocks: [
                {
                  type: "chart",
                  kind: "line",
                  title: "Token Consumption",
                  summary: "Prompt vs completion over the last 3 hours.",
                  unit: "tokens",
                  categories: ["09:00", "10:00", "11:00"],
                  series: [
                    { name: "Prompt", values: [1200, 1800, 900] },
                    { name: "Completion", values: [400, 700, 500] },
                  ],
                  showLegend: true,
                },
              ],
            },
          ],
        }}
      />
    );

    expect(chartRendererMock.render).toHaveBeenCalledTimes(1);
    expect(chartRendererMock.render).toHaveBeenCalledWith(
      expect.objectContaining({
        block: expect.objectContaining({
          kind: "line",
          title: "Token Consumption",
        }),
      })
    );
    expect(screen.getByTestId("report-canvas-chart-mock")).toHaveTextContent("Token Consumption");
  });

  it("registers semantic scene elements for stats, chart, callout, and table blocks", async () => {
    const onManifestChange = vi.fn();

    render(
      <SceneManifestHarness
        canvas={{
          kind: "report_canvas",
          title: "Audit",
          sections: [
            {
              type: "section",
              title: "Findings",
              blocks: [
                {
                  type: "stats",
                  items: [
                    { label: "Open Risks", value: "4", tone: "warning" },
                    { label: "Closed Risks", value: "12", tone: "success" },
                  ],
                },
                {
                  type: "chart",
                  kind: "line",
                  title: "Token Consumption",
                  summary: "Prompt vs completion over the last 3 hours.",
                  unit: "tokens",
                  categories: ["09:00", "10:00", "11:00"],
                  series: [
                    { name: "Prompt", values: [1200, 1800, 900] },
                    { name: "Completion", values: [400, 700, 500] },
                  ],
                  showLegend: true,
                },
                {
                  type: "callout",
                  tone: "warning",
                  title: "Risk",
                  body: "Prompt traffic spiked after 10:00.",
                },
                {
                  type: "table",
                  columns: ["Metric", "Owner"],
                  rows: [
                    ["Prompt Tokens", "Runtime"],
                    ["Completion Tokens", "Inference"],
                  ],
                },
              ],
            },
          ],
        }}
        onManifestChange={onManifestChange}
      />
    );

    await waitFor(() => {
      const manifest = onManifestChange.mock.calls[onManifestChange.mock.calls.length - 1]?.[0];
      expect(manifest).toBeDefined();
      expect(manifest.elements).toHaveLength(8);
      expect(manifest.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "report-stat:section-0:block-0:item-0",
            kind: "report-stat",
            rect: { x: 20, y: 24, width: 140, height: 76 },
          }),
          expect.objectContaining({
            id: "report-stat:section-0:block-0:item-1",
            kind: "report-stat",
            rect: { x: 170, y: 24, width: 140, height: 76 },
          }),
          expect.objectContaining({
            id: "chart-block:section-0:block-1",
            kind: "chart-block",
            rect: { x: 20, y: 116, width: 420, height: 240 },
          }),
          expect.objectContaining({
            id: "callout:section-0:block-2",
            kind: "callout",
            rect: { x: 20, y: 372, width: 420, height: 104 },
          }),
          expect.objectContaining({
            id: "table-cell:section-0:block-3:row-1:col-1",
            kind: "table-cell",
            rect: { x: 170, y: 544, width: 140, height: 44 },
          }),
        ])
      );
    });
  });
});

// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { useEffect, useRef, useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const echartsMock = vi.hoisted(() => {
  const chart = {
    dispose: vi.fn(),
    getWidth: vi.fn(() => 420),
    getHeight: vi.fn(() => 280),
    resize: vi.fn(),
    setOption: vi.fn(),
  };

  return {
    chart,
    init: vi.fn(() => chart),
  };
});

vi.mock("echarts", () => ({
  init: echartsMock.init,
}));

const { ReportCanvasChartRenderer } = await import("./report-canvas-chart-renderer");
const { createCanvasSceneRegistry } = await import("./canvas-scene-registry");

function createChartBlock(kind: "line" | "bar" | "sparkline") {
  return {
    type: "chart" as const,
    kind,
    title: "Token Consumption",
    summary: "Prompt vs completion over the last 3 hours.",
    unit: "tokens",
    categories: ["09:00", "10:00", "11:00"],
    series: [
      { name: "Prompt", values: [1200, 1800, 900] },
      { name: "Completion", values: [400, 700, 500] },
    ],
    showLegend: true,
  };
}

function SceneChartHarness(props: {
  kind: "line" | "bar" | "sparkline";
  onManifestChange: (manifest: {
    version: 1;
    elements: Array<{
      id: string;
      kind: string;
      payload?: Record<string, unknown>;
      rect: { x: number; y: number; width: number; height: number };
    }>;
  }) => void;
}) {
  const sceneRootRef = useRef<HTMLDivElement | null>(null);
  const [sceneRegistry] = useState(() => createCanvasSceneRegistry());

  useEffect(
    () => sceneRegistry.subscribe(props.onManifestChange),
    [props.onManifestChange, sceneRegistry]
  );

  return (
    <div data-scene-root="true" ref={sceneRootRef}>
      <ReportCanvasChartRenderer
        block={createChartBlock(props.kind)}
        sceneRegistry={sceneRegistry}
        sceneRootRef={sceneRootRef}
        semanticBaseId="chart-block:section-0:block-1"
      />
    </div>
  );
}

describe("ReportCanvasChartRenderer", () => {
  beforeEach(() => {
    echartsMock.init.mockClear();
    echartsMock.chart.dispose.mockClear();
    echartsMock.chart.getWidth.mockClear();
    echartsMock.chart.getHeight.mockClear();
    echartsMock.chart.resize.mockClear();
    echartsMock.chart.setOption.mockClear();
  });

  it("renders a line chart and disposes it on unmount", () => {
    const { unmount } = render(<ReportCanvasChartRenderer block={createChartBlock("line")} />);

    expect(screen.getByLabelText("Token Consumption line chart")).toBeInTheDocument();
    expect(echartsMock.init).toHaveBeenCalledTimes(1);
    expect(echartsMock.chart.setOption).toHaveBeenCalledTimes(1);

    const option = echartsMock.chart.setOption.mock.calls[
      echartsMock.chart.setOption.mock.calls.length - 1
    ]?.[0] as {
      legend?: { top?: number };
      series: Array<{ showSymbol?: boolean; type?: string }>;
      xAxis: { type?: string };
    };

    expect(option.legend).toMatchObject({ top: 0 });
    expect(option.series[0]).toMatchObject({
      showSymbol: true,
      type: "line",
    });
    expect(option.xAxis).toMatchObject({ type: "category" });

    unmount();

    expect(echartsMock.chart.dispose).toHaveBeenCalledTimes(1);
  });

  it("renders a bar chart with bar-specific series options", () => {
    render(<ReportCanvasChartRenderer block={createChartBlock("bar")} />);

    const option = echartsMock.chart.setOption.mock.calls[
      echartsMock.chart.setOption.mock.calls.length - 1
    ]?.[0] as {
      series: Array<{ itemStyle?: { borderRadius?: number[] }; type?: string }>;
    };

    expect(screen.getByTestId("report-canvas-chart-bar")).toBeInTheDocument();
    expect(option.series[0]).toMatchObject({
      type: "bar",
    });
    expect(option.series[0]?.itemStyle?.borderRadius).toEqual([8, 8, 0, 0]);
  });

  it("renders a sparkline with compact chrome", () => {
    render(<ReportCanvasChartRenderer block={createChartBlock("sparkline")} />);

    const option = echartsMock.chart.setOption.mock.calls[
      echartsMock.chart.setOption.mock.calls.length - 1
    ]?.[0] as {
      grid: {
        bottom?: number;
        containLabel?: boolean;
        left?: number;
        right?: number;
        top?: number;
      };
      legend?: unknown;
      series: Array<{ areaStyle?: { opacity?: number }; showSymbol?: boolean }>;
      xAxis: { axisLabel?: { show?: boolean }; axisLine?: { show?: boolean } };
      yAxis: { axisLabel?: { show?: boolean }; splitLine?: { show?: boolean } };
    };

    expect(screen.getByTestId("report-canvas-chart-sparkline")).toBeInTheDocument();
    expect(option.legend).toBeUndefined();
    expect(option.grid).toMatchObject({
      bottom: 0,
      containLabel: false,
      left: 0,
      right: 0,
      top: 0,
    });
    expect(option.series[0]).toMatchObject({
      areaStyle: { opacity: 0.14 },
      showSymbol: false,
    });
    expect(option.xAxis.axisLabel).toMatchObject({ show: false });
    expect(option.xAxis.axisLine).toMatchObject({ show: false });
    expect(option.yAxis.axisLabel).toMatchObject({ show: false });
    expect(option.yAxis.splitLine).toMatchObject({ show: false });
  });

  it("escapes tooltip content before returning html", () => {
    render(
      <ReportCanvasChartRenderer
        block={{
          ...createChartBlock("line"),
          categories: ["<Jan>", "Feb"],
          series: [
            {
              name: "<script>alert(1)</script>",
              values: [12, 18],
            },
          ],
          unit: "<tokens>",
          showLegend: false,
        }}
      />
    );

    const option = echartsMock.chart.setOption.mock.calls[
      echartsMock.chart.setOption.mock.calls.length - 1
    ]?.[0] as {
      tooltip: {
        formatter?: (params: unknown) => string;
      };
    };

    const tooltip = option.tooltip.formatter?.([
      {
        axisValueLabel: "<Jan>",
        marker: '<span class="marker">●</span>',
        seriesName: "<script>alert(1)</script>",
        value: 12,
      },
    ]);

    expect(tooltip).toContain("&lt;Jan&gt;");
    expect(tooltip).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(tooltip).toContain("&lt;tokens&gt;");
    expect(tooltip).not.toContain("<script>alert(1)</script>");
  });

  it("registers chart-series and chart-point semantic elements", async () => {
    const onManifestChange = vi.fn();

    render(<SceneChartHarness kind="line" onManifestChange={onManifestChange} />);

    await waitFor(() => {
      const manifest = onManifestChange.mock.calls[onManifestChange.mock.calls.length - 1]?.[0];
      expect(manifest).toBeDefined();
      expect(manifest.elements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: "chart-series:prompt:section-0:block-1",
            kind: "chart-series",
            payload: expect.objectContaining({
              seriesName: "Prompt",
              chartKind: "line",
            }),
          }),
          expect.objectContaining({
            id: "chart-series:completion:section-0:block-1",
            kind: "chart-series",
            payload: expect.objectContaining({
              seriesName: "Completion",
              chartKind: "line",
            }),
          }),
          expect.objectContaining({
            id: "chart-point:prompt:09:00",
            kind: "chart-point",
            payload: expect.objectContaining({
              category: "09:00",
              seriesName: "Prompt",
              value: 1200,
            }),
          }),
          expect.objectContaining({
            id: "chart-point:completion:11:00",
            kind: "chart-point",
            payload: expect.objectContaining({
              category: "11:00",
              seriesName: "Completion",
              value: 500,
            }),
          }),
        ])
      );
    });
  });
});

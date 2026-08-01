import type { ReportChartBlock } from "@coder-studio/core";
import * as echarts from "echarts";
import type { RefObject } from "react";
import { useEffect, useMemo, useRef } from "react";
import type { CanvasSceneRegistry } from "./canvas-scene-registry";

interface ReportCanvasChartRendererProps {
  block: ReportChartBlock;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
  semanticBaseId?: string;
}

const panelStyle = {
  border: "1px solid rgba(31,41,51,0.12)",
  borderRadius: "18px",
  padding: "16px",
  background: "linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(249,246,238,0.96) 100%)",
};

const headerStyle = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "12px",
};

const titleStyle = {
  margin: 0,
  fontSize: "1.04rem",
  lineHeight: 1.25,
};

const summaryStyle = {
  margin: "6px 0 0",
  color: "#52606d",
  lineHeight: 1.5,
};

const unitStyle = {
  borderRadius: "999px",
  padding: "6px 10px",
  background: "rgba(15,118,110,0.08)",
  color: "#0f766e",
  fontSize: "0.82rem",
  fontWeight: 600,
  whiteSpace: "nowrap",
};

const CHART_COLORS = ["#0f766e", "#2563eb", "#ea580c", "#64748b", "#16a34a", "#0ea5e9"];

const numberFormatter = new Intl.NumberFormat(undefined, {
  maximumFractionDigits: 2,
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return character;
    }
  });
}

function formatChartValue(value: unknown) {
  if (typeof value === "number") {
    return numberFormatter.format(value);
  }

  return String(value ?? "");
}

function buildTooltip(block: ReportChartBlock, params: unknown) {
  const items = Array.isArray(params) ? params : [params];
  const first = items[0] as
    | {
        axisValue?: unknown;
        axisValueLabel?: unknown;
      }
    | undefined;

  const category =
    typeof first?.axisValueLabel === "string"
      ? first.axisValueLabel
      : typeof first?.axisValue === "string" || typeof first?.axisValue === "number"
        ? String(first.axisValue)
        : block.title;

  const rows = items
    .filter(
      (item): item is { marker?: unknown; seriesName?: unknown; value?: unknown } =>
        typeof item === "object" && item !== null
    )
    .map((item) => {
      const seriesName = typeof item.seriesName === "string" ? item.seriesName : block.title;
      const marker = typeof item.marker === "string" ? item.marker : "";
      return `${marker}${escapeHtml(seriesName)}: ${escapeHtml(formatChartValue(item.value))}${
        block.unit ? ` ${escapeHtml(block.unit)}` : ""
      }`;
    });

  return [`<strong>${escapeHtml(category)}</strong>`, ...rows].join("<br />");
}

function getChartHeight(kind: ReportChartBlock["kind"]) {
  return kind === "sparkline" ? 118 : 280;
}

function buildChartOption(block: ReportChartBlock) {
  const isSparkline = block.kind === "sparkline";
  const shouldShowLegend = !isSparkline && (block.showLegend ?? block.series.length > 1);
  const seriesType = block.kind === "bar" ? "bar" : "line";

  return {
    aria: {
      enabled: true,
    },
    color: CHART_COLORS,
    animationDuration: 500,
    grid: isSparkline
      ? {
          bottom: 0,
          containLabel: false,
          left: 0,
          right: 0,
          top: 0,
        }
      : {
          bottom: 28,
          containLabel: true,
          left: 10,
          right: 12,
          top: shouldShowLegend ? 42 : 18,
        },
    legend: shouldShowLegend
      ? {
          itemHeight: 10,
          itemWidth: 14,
          left: 0,
          orient: "horizontal",
          top: 0,
        }
      : undefined,
    series: block.series.map((series) => ({
      data: series.values,
      emphasis: {
        focus: "series",
      },
      lineStyle:
        block.kind === "bar"
          ? undefined
          : {
              width: isSparkline ? 1.6 : 2.6,
            },
      name: series.name,
      showSymbol: block.kind === "line" && block.categories.length <= 12,
      smooth: block.kind !== "bar",
      symbolSize: isSparkline ? 4 : 6,
      type: seriesType,
      ...(block.kind === "bar"
        ? {
            barMaxWidth: 28,
            itemStyle: {
              borderRadius: [8, 8, 0, 0],
            },
          }
        : {}),
      ...(isSparkline
        ? {
            areaStyle: {
              opacity: 0.14,
            },
          }
        : {}),
    })),
    tooltip: {
      confine: true,
      trigger: "axis",
      formatter: (params: unknown) => buildTooltip(block, params),
    },
    xAxis: {
      axisLabel: {
        color: isSparkline ? "#8aa7b8" : "#52606d",
        hideOverlap: true,
        show: !isSparkline,
      },
      axisLine: {
        show: !isSparkline,
        lineStyle: {
          color: "rgba(31,41,51,0.16)",
        },
      },
      axisTick: {
        show: !isSparkline,
      },
      boundaryGap: block.kind === "bar",
      data: block.categories,
      splitLine: {
        show: false,
      },
      type: "category",
    },
    yAxis: {
      axisLabel: {
        color: isSparkline ? "#8aa7b8" : "#52606d",
        show: !isSparkline,
        formatter: (value: number) => formatChartValue(value),
      },
      axisLine: {
        show: false,
      },
      axisTick: {
        show: false,
      },
      name: isSparkline ? undefined : block.unit,
      nameLocation: "middle",
      nameGap: 36,
      nameTextStyle: {
        color: "#52606d",
      },
      splitLine: {
        lineStyle: {
          color: "rgba(31,41,51,0.10)",
          type: "dashed",
        },
        show: !isSparkline,
      },
      type: "value",
    },
  };
}

function slugifySegment(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9:_-]/g, "");
}

function registerChartSemanticElements(input: {
  block: ReportChartBlock;
  chartHeight: number;
  chartWidth: number;
  containerRect: DOMRect;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRoot: HTMLElement | null;
  semanticBaseId?: string;
}) {
  const {
    block,
    chartHeight,
    chartWidth,
    containerRect,
    sceneRegistry,
    sceneRoot,
    semanticBaseId,
  } = input;
  if (!sceneRegistry || !sceneRoot || !semanticBaseId || chartWidth <= 0 || chartHeight <= 0) {
    return;
  }

  const blockIdSuffix = semanticBaseId.replace(/^chart-block:/, "");
  const categoryCount = block.categories.length;
  const maxValue = Math.max(...block.series.flatMap((series) => series.values), 1);
  const rootRect = sceneRoot.getBoundingClientRect();
  const offsetX = containerRect.left - rootRect.left;
  const offsetY = containerRect.top - rootRect.top;
  const innerHeight = Math.max(chartHeight - 24, 1);
  const innerWidth = Math.max(chartWidth - 24, 1);
  const stepX = categoryCount > 1 ? innerWidth / (categoryCount - 1) : 0;

  block.series.forEach((series, seriesIndex) => {
    const seriesSlug = slugifySegment(series.name);
    const bandHeight = Math.max(24, innerHeight / Math.max(block.series.length, 1));
    const seriesTop = 12 + seriesIndex * bandHeight;

    sceneRegistry.upsertElement({
      id: `chart-series:${seriesSlug}:${blockIdSuffix}`,
      kind: "chart-series",
      rect: {
        x: offsetX,
        y: offsetY + seriesTop,
        width: innerWidth,
        height: Math.min(bandHeight, innerHeight),
      },
      label: series.name,
      payload: {
        chartKind: block.kind,
        seriesName: series.name,
      },
    });

    series.values.forEach((value, categoryIndex) => {
      const category = block.categories[categoryIndex] ?? String(categoryIndex);
      const categorySlug = slugifySegment(category);
      const pointX = 12 + (categoryCount > 1 ? categoryIndex * stepX : innerWidth / 2);
      const normalizedValue = maxValue > 0 ? value / maxValue : 0;
      const pointY = 12 + innerHeight - normalizedValue * innerHeight;
      const pointSize = block.kind === "bar" ? 18 : block.kind === "sparkline" ? 10 : 12;

      sceneRegistry.upsertElement({
        id: `chart-point:${seriesSlug}:${categorySlug}`,
        kind: "chart-point",
        rect: {
          x: Math.max(0, offsetX + pointX - pointSize / 2),
          y: Math.max(0, offsetY + pointY - pointSize / 2),
          width: pointSize,
          height: pointSize,
        },
        label: `${series.name} at ${category}`,
        payload: {
          category,
          chartKind: block.kind,
          seriesName: series.name,
          value,
        },
      });
    });
  });
}

function syncChartSemanticElements(input: {
  block: ReportChartBlock;
  chart: {
    getHeight?: () => number;
    getWidth?: () => number;
  };
  container: HTMLDivElement;
  sceneRegistry?: CanvasSceneRegistry;
  sceneRootRef?: RefObject<HTMLElement | null>;
  semanticBaseId?: string;
}) {
  if (!input.sceneRegistry || !input.sceneRootRef?.current || !input.semanticBaseId) {
    return;
  }

  const fallbackRect = input.container.getBoundingClientRect();
  registerChartSemanticElements({
    block: input.block,
    chartHeight: input.chart.getHeight?.() ?? fallbackRect.height,
    chartWidth: input.chart.getWidth?.() ?? fallbackRect.width,
    containerRect: fallbackRect,
    sceneRegistry: input.sceneRegistry,
    sceneRoot: input.sceneRootRef.current,
    semanticBaseId: input.semanticBaseId,
  });
}

export function ReportCanvasChartRenderer({
  block,
  sceneRegistry,
  sceneRootRef,
  semanticBaseId,
}: ReportCanvasChartRendererProps) {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const chartOption = useMemo(() => buildChartOption(block), [block]);

  useEffect(() => {
    const container = chartRef.current;
    if (!container) {
      return;
    }

    const chart = echarts.init(container);
    chart.setOption(chartOption);
    syncChartSemanticElements({
      block,
      chart,
      container,
      sceneRegistry,
      sceneRootRef,
      semanticBaseId,
    });

    const resizeChart = () => {
      chart.resize();
      syncChartSemanticElements({
        block,
        chart,
        container,
        sceneRegistry,
        sceneRootRef,
        semanticBaseId,
      });
    };

    window.addEventListener("resize", resizeChart);

    return () => {
      window.removeEventListener("resize", resizeChart);
      chart.dispose();
    };
  }, [block, chartOption, sceneRegistry, sceneRootRef, semanticBaseId]);

  return (
    <article style={panelStyle}>
      <header style={headerStyle}>
        <div>
          <h3 style={titleStyle}>{block.title}</h3>
          {block.summary ? <p style={summaryStyle}>{block.summary}</p> : null}
        </div>
        {block.unit ? <span style={unitStyle}>{block.unit}</span> : null}
      </header>
      <div
        aria-label={`${block.title} ${block.kind} chart`}
        data-testid={`report-canvas-chart-${block.kind}`}
        ref={chartRef}
        style={{
          height: getChartHeight(block.kind),
          marginTop: block.summary ? 2 : 8,
          width: "100%",
        }}
      />
    </article>
  );
}

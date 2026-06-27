import * as echarts from "echarts";
import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { dispatchCommandAtom } from "../../../../atoms/connection";
import { useTranslation } from "../../../../lib/i18n";
import type {
  WorkAnalysisDashboardRecord,
  WorkAnalysisTokenTrendPoint,
} from "../../../work-analysis/types";

interface AgentInstructionsTokenTrendProps {
  workspaceId?: string;
  workspacePath: string;
}

type TrendState =
  | { status: "loading" }
  | { status: "ready"; points: WorkAnalysisTokenTrendPoint[] }
  | { status: "empty" }
  | { status: "error" };

function formatTokenValue(value: number) {
  if (value >= 1_000_000) {
    return `${Number((value / 1_000_000).toFixed(1))}m`;
  }

  if (value >= 1_000) {
    return `${Number((value / 1_000).toFixed(1))}k`;
  }

  return String(value);
}

function getPointTimestamp(point: WorkAnalysisTokenTrendPoint) {
  return typeof point.hourStart === "number" ? point.hourStart : null;
}

function hasTokenData(points: readonly WorkAnalysisTokenTrendPoint[]) {
  return points.some((point) => point.totalTokens > 0 || point.sessionCount > 0);
}

function summarizePoints(points: readonly WorkAnalysisTokenTrendPoint[]) {
  return points.reduce(
    (summary, point) => ({
      peakTokens: Math.max(summary.peakTokens, point.totalTokens),
      sessionCount: summary.sessionCount + point.sessionCount,
      totalTokens: summary.totalTokens + point.totalTokens,
    }),
    {
      peakTokens: 0,
      sessionCount: 0,
      totalTokens: 0,
    }
  );
}

export function AgentInstructionsTokenTrend({
  workspaceId,
  workspacePath,
}: AgentInstructionsTokenTrendProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<TrendState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    async function loadTrend() {
      const result = await dispatch<WorkAnalysisDashboardRecord>("work.analysis.dashboard.get", {
        workspaceId,
        workspacePaths: [workspacePath],
        timeRange: { preset: "24h" },
      });

      if (cancelled) {
        return;
      }

      if (!result.ok || !result.data?.dashboard) {
        setState({ status: "error" });
        return;
      }

      const points = result.data.dashboard.trends.tokenHourly;
      setState(hasTokenData(points) ? { status: "ready", points } : { status: "empty" });
    }

    void loadTrend();

    return () => {
      cancelled = true;
    };
  }, [dispatch, workspaceId, workspacePath]);

  const chartData = useMemo(() => {
    if (state.status !== "ready") {
      return [];
    }

    return state.points
      .map((point): [number, number] | null => {
        const timestamp = getPointTimestamp(point);
        return typeof timestamp === "number" ? [timestamp, point.totalTokens] : null;
      })
      .filter((point): point is [number, number] => point !== null);
  }, [state]);

  const summary = useMemo(
    () => (state.status === "ready" ? summarizePoints(state.points) : null),
    [state]
  );

  useEffect(() => {
    const container = chartRef.current;
    if (!container || chartData.length === 0) {
      return;
    }

    const style = getComputedStyle(container);
    const textColor = style.getPropertyValue("--text-tertiary").trim() || "#8aa7b8";
    const gridColor = style.getPropertyValue("--border-subtle").trim() || "#214458";
    const accentColor = style.getPropertyValue("--status-success-fg").trim() || "#67d6b3";
    const chart = echarts.init(container);

    chart.setOption({
      animationDuration: 500,
      grid: {
        bottom: 8,
        containLabel: false,
        left: 4,
        right: 4,
        top: 8,
      },
      series: [
        {
          areaStyle: {
            color: `${accentColor}22`,
          },
          data: chartData,
          lineStyle: {
            color: accentColor,
            width: 2,
          },
          showSymbol: chartData.length <= 12,
          smooth: true,
          symbolSize: 5,
          type: "line",
        },
      ],
      tooltip: {
        confine: true,
        trigger: "axis",
      },
      xAxis: {
        axisLabel: {
          color: textColor,
          hideOverlap: true,
          show: false,
        },
        axisLine: {
          lineStyle: {
            color: gridColor,
          },
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          show: false,
        },
        type: "time",
      },
      yAxis: {
        axisLabel: {
          color: textColor,
          show: false,
        },
        axisLine: {
          show: false,
        },
        axisTick: {
          show: false,
        },
        splitLine: {
          lineStyle: {
            color: gridColor,
            type: "dashed",
          },
        },
        type: "value",
      },
    });

    const resizeChart = () => chart.resize();
    window.addEventListener("resize", resizeChart);

    return () => {
      window.removeEventListener("resize", resizeChart);
      chart.dispose();
    };
  }, [chartData]);

  return (
    <div className="workspace-agent-instructions__token-trend">
      <div className="workspace-agent-instructions__token-trend-header">
        <div>
          <p className="workspace-agent-instructions__token-trend-subtitle">
            {t("workspace.agent_instructions.token_trend.subtitle")}
          </p>
        </div>
        {summary ? (
          <strong className="workspace-agent-instructions__token-trend-total">
            {t("workspace.agent_instructions.token_trend.total", {
              value: formatTokenValue(summary.totalTokens),
            })}
          </strong>
        ) : null}
      </div>

      {state.status === "loading" ? (
        <div className="workspace-agent-instructions__token-trend-skeleton">
          {t("workspace.agent_instructions.token_trend.loading")}
        </div>
      ) : null}

      {state.status === "ready" ? (
        <>
          <div
            aria-label={t("workspace.agent_instructions.token_trend.chart_label")}
            className="workspace-agent-instructions__token-trend-chart"
            data-testid="agent-token-trend-chart"
            ref={chartRef}
          />
          <div className="workspace-agent-instructions__token-trend-footer">
            <span>
              {t("workspace.agent_instructions.token_trend.peak", {
                value: formatTokenValue(summary?.peakTokens ?? 0),
              })}
            </span>
            <span>
              {t("workspace.agent_instructions.token_trend.sessions", {
                count: summary?.sessionCount ?? 0,
              })}
            </span>
          </div>
        </>
      ) : null}

      {state.status === "empty" ? (
        <p className="workspace-agent-instructions__token-trend-state">
          {t("workspace.agent_instructions.token_trend.empty")}
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="workspace-agent-instructions__token-trend-state">
          {t("workspace.agent_instructions.token_trend.error")}
        </p>
      ) : null}
    </div>
  );
}

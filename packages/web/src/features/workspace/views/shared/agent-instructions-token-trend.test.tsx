// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { wsClientAtom } from "../../../../atoms/connection";
import { AgentInstructionsTokenTrend } from "./agent-instructions-token-trend";

const echartsMock = vi.hoisted(() => {
  const chart = {
    dispose: vi.fn(),
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

vi.mock("../../../../lib/i18n", () => ({
  useTranslation: () => (key: string, params?: Record<string, string | number>) => {
    const translations: Record<string, string> = {
      "workspace.agent_instructions.token_trend.title": "Token trend",
      "workspace.agent_instructions.token_trend.subtitle": "Current project · Last 24 hours",
      "workspace.agent_instructions.token_trend.loading": "Loading token trend...",
      "workspace.agent_instructions.token_trend.empty": "No token data in the last 24 hours.",
      "workspace.agent_instructions.token_trend.error": "Token trend unavailable.",
      "workspace.agent_instructions.token_trend.total": "Total {value}",
      "workspace.agent_instructions.token_trend.peak": "Peak {value}/h",
      "workspace.agent_instructions.token_trend.sessions": "{count} sessions",
      "workspace.agent_instructions.token_trend.chart_label":
        "Token consumption trend for the current project over the last 24 hours",
    };

    return (translations[key] ?? key)
      .replace("{value}", String(params?.value ?? ""))
      .replace("{count}", String(params?.count ?? ""));
  },
}));

function createStoreWithDispatch(dispatch: ReturnType<typeof vi.fn>) {
  const store = createStore();
  store.set(wsClientAtom, {
    sendCommand: dispatch,
    subscribe: vi.fn(() => () => {}),
  } as never);
  return store;
}

function buildDashboard(
  tokenHourly = [
    {
      hourStart: Date.UTC(2026, 5, 7, 8),
      inputTokens: 1000,
      outputTokens: 500,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 1500,
      sessionCount: 1,
      activeDurationMs: 60_000,
    },
    {
      hourStart: Date.UTC(2026, 5, 7, 9),
      inputTokens: 2000,
      outputTokens: 1000,
      cachedInputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 3000,
      sessionCount: 2,
      activeDurationMs: 120_000,
    },
  ]
) {
  return {
    version: 1,
    queryDigest: "digest",
    query: {
      workspacePaths: ["/repo/project"],
      timeRange: { preset: "24h" },
    },
    mode: "manual",
    requestedAt: Date.UTC(2026, 5, 7, 10),
    scanState: {
      mode: "manual",
      status: "succeeded",
      providerStatuses: [],
    },
    dashboard: {
      generatedAt: Date.UTC(2026, 5, 7, 10),
      timeRange: {
        startAt: Date.UTC(2026, 5, 6, 10),
        endAt: Date.UTC(2026, 5, 7, 10),
        label: "24h",
      },
      filters: {
        workspacePaths: ["/repo/project"],
        timeRange: { preset: "24h" },
      },
      kpis: [],
      trends: {
        tokenHourly,
        tokenDaily: [],
        hourHeatmap: [],
      },
      rankings: {
        projects: [],
        models: [],
        agents: [],
      },
      breakdowns: {
        tasks: [],
        tools: [],
      },
      quality: {
        providers: [],
        warnings: [],
      },
    },
  };
}

function renderTrend(dispatch: ReturnType<typeof vi.fn>, workspacePath = "/repo/project") {
  render(
    <Provider store={createStoreWithDispatch(dispatch)}>
      <AgentInstructionsTokenTrend workspacePath={workspacePath} />
    </Provider>
  );
}

describe("AgentInstructionsTokenTrend", () => {
  beforeEach(() => {
    echartsMock.init.mockClear();
    echartsMock.chart.dispose.mockClear();
    echartsMock.chart.resize.mockClear();
    echartsMock.chart.setOption.mockClear();
  });

  it("loads a 24h token trend for the current workspace path", async () => {
    const dispatch = vi.fn(async () => buildDashboard());

    renderTrend(dispatch);

    await waitFor(() => {
      expect(dispatch).toHaveBeenCalledWith(
        "work.analysis.dashboard.get",
        {
          workspacePaths: ["/repo/project"],
          timeRange: { preset: "24h" },
        },
        undefined
      );
    });
    expect(await screen.findByText("Total 4.5k")).toBeInTheDocument();
    expect(screen.getByText("Peak 3k/h")).toBeInTheDocument();
    expect(screen.getByText("3 sessions")).toBeInTheDocument();
    expect(screen.getByTestId("agent-token-trend-chart")).toBeInTheDocument();
  });

  it("initializes ECharts with hourly token data", async () => {
    const dispatch = vi.fn(async () => buildDashboard());

    renderTrend(dispatch);

    await waitFor(() => {
      expect(echartsMock.init).toHaveBeenCalled();
      expect(echartsMock.chart.setOption).toHaveBeenCalled();
    });

    const option = echartsMock.chart.setOption.mock.calls.at(-1)?.[0] as {
      series?: Array<{ data?: Array<[number, number]>; type?: string }>;
      xAxis?: { type?: string };
      yAxis?: { type?: string };
    };
    expect(option.xAxis).toMatchObject({ type: "time" });
    expect(option.yAxis).toMatchObject({ type: "value" });
    expect(option.series?.[0]).toMatchObject({
      data: [
        [Date.UTC(2026, 5, 7, 8), 1500],
        [Date.UTC(2026, 5, 7, 9), 3000],
      ],
      type: "line",
    });
  });

  it("renders an empty state when the dashboard has no token usage points", async () => {
    const dispatch = vi.fn(async () =>
      buildDashboard([
        {
          hourStart: Date.UTC(2026, 5, 7, 8),
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
          reasoningOutputTokens: 0,
          totalTokens: 0,
          sessionCount: 0,
          activeDurationMs: 0,
        },
      ])
    );

    renderTrend(dispatch);

    expect(await screen.findByText("No token data in the last 24 hours.")).toBeInTheDocument();
    expect(echartsMock.init).not.toHaveBeenCalled();
  });

  it("renders an error state without throwing when the dashboard request fails", async () => {
    const dispatch = vi.fn(async () => {
      throw new Error("boom");
    });

    renderTrend(dispatch);

    expect(await screen.findByText("Token trend unavailable.")).toBeInTheDocument();
    expect(echartsMock.init).not.toHaveBeenCalled();
  });
});

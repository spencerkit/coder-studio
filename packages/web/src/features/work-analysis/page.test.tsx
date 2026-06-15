import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { connectionStatusAtom, wsClientAtom } from "../../atoms/connection";
import {
  activeWorkspaceIdAtom,
  workspacesAtom,
  workspacesLoadStateAtom,
} from "../../atoms/workspaces";
import { buildLocalHourHeatmapPoints, WorkAnalyticsPage } from "./page";
import type {
  WorkAnalysisDashboardProjection,
  WorkAnalysisDashboardRecord,
  WorkAnalysisHourHeatPoint,
  WorkAnalysisSkillBreakdown,
  WorkAnalysisTimeRange,
  WorkAnalysisTokenTrendPoint,
} from "./types";

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

const viewportMock = vi.hoisted(() => ({
  value: "desktop" as "desktop" | "mobile",
}));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, reject, resolve };
}

vi.mock("echarts", () => ({
  init: echartsMock.init,
}));

vi.mock("../../components/ui/_internal/use-viewport", () => ({
  useViewport: () => viewportMock.value,
}));

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location-display">{`${location.pathname}${location.search}`}</div>;
}

function createStoreWithAnalysis(sendCommand: ReturnType<typeof vi.fn>) {
  const store = createStore();
  store.set(connectionStatusAtom, "connected");
  store.set(wsClientAtom, {
    sendCommand,
    subscribe: vi.fn(() => () => {}),
  } as never);
  store.set(activeWorkspaceIdAtom, "ws-1");
  store.set(workspacesLoadStateAtom, "ready");
  store.set(workspacesAtom, {
    "ws-1": {
      id: "ws-1",
      path: "/repo/project",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 240,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    },
  });
  return store;
}

function buildTrendPoint(
  hourStart: number,
  totalTokens: number,
  overrides: Partial<WorkAnalysisTokenTrendPoint> = {}
): WorkAnalysisTokenTrendPoint {
  return {
    hourStart,
    inputTokens: totalTokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
    sessionCount: 1,
    activeDurationMs: 60_000,
    ...overrides,
  };
}

function buildDailyTrendPoint(day: string, totalTokens: number): WorkAnalysisTokenTrendPoint {
  return {
    day,
    inputTokens: totalTokens,
    outputTokens: 0,
    cachedInputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens,
    sessionCount: 1,
    activeDurationMs: 60_000,
  };
}

function buildDashboard(
  overrides: {
    timeRange?: WorkAnalysisTimeRange;
    trendRange?: WorkAnalysisDashboardProjection["timeRange"];
    hourHeatmap?: WorkAnalysisHourHeatPoint[];
    providerStatuses?: WorkAnalysisDashboardRecord["scanState"]["providerStatuses"];
    totalTokens?: number;
    projects?: string[];
    skills?: WorkAnalysisSkillBreakdown[];
    tokenDaily?: WorkAnalysisTokenTrendPoint[];
    tokenHourly?: WorkAnalysisTokenTrendPoint[];
  } = {}
): WorkAnalysisDashboardRecord {
  const defaultTrendRange = {
    startAt: Date.UTC(2026, 4, 30, 10),
    endAt: Date.UTC(2026, 5, 6, 10),
    label: "7d",
  };
  const providerStatuses = overrides.providerStatuses ?? [
    {
      providerId: "codex",
      status: "supported",
      sessionCount: 2,
      parseErrorCount: 0,
      warningCount: 0,
    },
  ];

  return {
    version: 1,
    queryDigest: "dashboard-digest",
    query: { timeRange: overrides.timeRange ?? { preset: "7d" } },
    mode: "auto",
    requestedAt: Date.UTC(2026, 5, 6, 10),
    scanState: {
      mode: "auto",
      status: "succeeded",
      lastStartedAt: Date.UTC(2026, 5, 6, 9),
      lastCompletedAt: Date.UTC(2026, 5, 6, 9, 1),
      nextScheduledAt: Date.UTC(2026, 5, 6, 10),
      sourceDigest: "source-1",
      providerStatuses,
    },
    dashboard: {
      generatedAt: Date.UTC(2026, 5, 6, 9, 1),
      timeRange: overrides.trendRange ?? defaultTrendRange,
      filters: { timeRange: overrides.timeRange ?? { preset: "7d" } },
      kpis: [
        { key: "totalTokens", label: "Total tokens", value: overrides.totalTokens ?? 12_840_000 },
        { key: "inputOutput", label: "Input / Output", value: 11_800_000 },
        { key: "sessions", label: "Sessions", value: 428, helper: "390 with usage data" },
        { key: "activeTime", label: "Active time", value: 263_880_000 },
        {
          key: "topProjectShare",
          label: "Top project share",
          value: 0.462,
          helper: "/root/workspace/coder-studio",
        },
      ],
      trends: {
        tokenHourly: overrides.tokenHourly ?? [
          buildTrendPoint(Date.UTC(2026, 5, 1, 10), 1_140_000, {
            inputTokens: 900_000,
            outputTokens: 160_000,
            reasoningOutputTokens: 80_000,
            sessionCount: 24,
            activeDurationMs: 3_600_000,
          }),
        ],
        tokenDaily: overrides.tokenDaily ?? [],
        hourHeatmap: overrides.hourHeatmap ?? [],
      },
      rankings: {
        projects: (overrides.projects ?? ["/root/workspace/coder-studio"]).map(
          (projectPath, index) => ({
            key: projectPath,
            label: projectPath,
            totalTokens: 5_930_000 - index * 100_000,
            shareOfTokens: index === 0 ? 0.462 : 0.25,
            sessionCount: 188 - index,
            activeDurationMs: 0,
            subtitle: "188 sessions · Codex dominant",
          })
        ),
        models: [
          {
            key: "codex / gpt-5-codex",
            label: "codex / gpt-5-codex",
            totalTokens: 4_800_000,
            shareOfTokens: 0.374,
            sessionCount: 212,
            activeDurationMs: 0,
            subtitle: "reasoning output 18.1%",
          },
        ],
        agents: [
          {
            key: "codex",
            label: "codex",
            totalTokens: 6_100_000,
            shareOfTokens: 0.475,
            sessionCount: 212,
            activeDurationMs: 0,
            subtitle: "top in feature_dev and refactoring",
          },
        ],
      },
      breakdowns: { tasks: [], tools: [], skills: overrides.skills ?? [] },
      quality: {
        providers: providerStatuses,
        warnings: [],
      },
    },
  };
}

function renderStandaloneAnalytics(
  store: ReturnType<typeof createStoreWithAnalysis>,
  entry = "/analytics"
) {
  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/analytics" element={<WorkAnalyticsPage />} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}

describe("WorkAnalyticsPage", () => {
  beforeEach(() => {
    echartsMock.chart.dispose.mockClear();
    echartsMock.chart.resize.mockClear();
    echartsMock.chart.setOption.mockClear();
    echartsMock.init.mockClear();
    viewportMock.value = "desktop";
  });

  it("renders the standalone /analytics page without redirecting back into settings", async () => {
    const store = createStoreWithAnalysis(vi.fn());

    renderStandaloneAnalytics(store, "/analytics?workspacePath=%2Frepo%2Fproject");

    expect(await screen.findByTestId("work-analytics-page")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "工作分析" })).toBeInTheDocument();
    expect(screen.queryByTestId("location-display")).not.toBeInTheDocument();
  });

  it("renders a full-width token trend before the three contribution rankings", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "work.analysis.dashboard.get") {
        return buildDashboard();
      }
      return buildDashboard();
    });
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByRole("heading", { name: "Token 趋势" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "项目 token 贡献排行" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "模型 token 贡献排行" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Agent token 贡献排行" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "任务类型 Token 分布" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "工具调用 Token 归因" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Skill 调用归因" })).toBeInTheDocument();

    const trend = screen.getByTestId("token-trend-row");
    const rankings = screen.getByTestId("token-contribution-row");
    expect(trend.compareDocumentPosition(rankings) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(rankings.querySelectorAll("[data-ranking-column]")).toHaveLength(3);
    const compactRankings = document.querySelectorAll("[data-compact-ranking-panel]");
    expect(compactRankings).toHaveLength(2);
    for (const panel of compactRankings) {
      expect(panel).toHaveStyle({ alignContent: "start" });
    }
  });

  it("renders Skill attribution as count-only skill usage", async () => {
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        skills: [
          {
            key: "frontend-design",
            providerIds: ["codex"],
            label: "frontend-design",
            callCount: 40,
            sessionCount: 12,
            shareOfCalls: 0.714,
          },
          {
            key: "superpowers:systematic-debugging",
            providerIds: ["claude"],
            label: "superpowers:systematic-debugging",
            callCount: 16,
            sessionCount: 4,
            shareOfCalls: 0.286,
          },
        ],
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByRole("heading", { name: "Skill 调用归因" })).toBeInTheDocument();
    expect(screen.getByText("frontend-design")).toBeInTheDocument();
    expect(screen.getByText("superpowers:systematic-debugging")).toBeInTheDocument();
    expect(screen.getByText("40 次")).toBeInTheDocument();
    expect(screen.getByText("12 会话")).toBeInTheDocument();
    expect(screen.getByText("来源: Codex")).toBeInTheDocument();
    expect(
      screen.getByText("目前仅统计 Claude 日志中可识别的 Skill 调用次数。")
    ).toBeInTheDocument();
  });

  it("renders token trend as an ECharts time axis with token values", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByTestId("token-trend-chart")).toBeInTheDocument();
    expect(screen.getByText("横轴：时间")).toBeInTheDocument();
    expect(screen.getByText("纵轴：Token")).toBeInTheDocument();

    await waitFor(() => {
      expect(echartsMock.init).toHaveBeenCalled();
      expect(echartsMock.chart.setOption).toHaveBeenCalled();
    });

    const option = echartsMock.chart.setOption.mock.calls.at(-1)?.[0] as {
      series?: Array<{ data?: unknown[]; type?: string }>;
      tooltip?: { formatter?: (params: unknown) => string };
      xAxis?: { max?: number; min?: number; name?: string; type?: string };
      yAxis?: { name?: string; type?: string };
    };
    expect(option.xAxis).toMatchObject({
      max: Date.UTC(2026, 5, 6, 10),
      min: Date.UTC(2026, 4, 30, 10),
      name: "时间",
      type: "time",
    });
    expect(option.yAxis).toMatchObject({ name: "Token", type: "value" });
    expect(option.series?.[0]).toMatchObject({ type: "line" });
    expect(option.series?.[0]?.data).toContainEqual([Date.UTC(2026, 5, 1, 10), 1_140_000]);
    expect(screen.getByText("粒度：小时")).toBeInTheDocument();

    const tooltip = option.tooltip?.formatter?.([{ data: [Date.UTC(2026, 5, 1, 10), 1_140_000] }]);
    expect(tooltip).toContain("Token");
    expect(tooltip).toContain("会话数");
    expect(tooltip).toContain("活跃时间");
  });

  it("renders the full selected range using daily points when the range is longer than 30 days", async () => {
    const startAt = Date.UTC(2026, 2, 1);
    const endAt = Date.UTC(2026, 4, 30);
    const tokenDaily = Array.from({ length: 91 }, (_, index) =>
      buildDailyTrendPoint(
        new Date(startAt + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        index === 90 ? 9_000 : index
      )
    );
    const tokenHourly = Array.from({ length: 140 }, (_, index) =>
      buildTrendPoint(startAt + index * 60 * 60 * 1000, 100 + index)
    );
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        timeRange: { preset: "90d" },
        trendRange: { startAt, endAt, label: "90d" },
        tokenDaily,
        tokenHourly,
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store, "/analytics?range=90d");

    expect(await screen.findByTestId("token-trend-chart")).toBeInTheDocument();

    await waitFor(() => {
      expect(echartsMock.chart.setOption).toHaveBeenCalled();
    });

    const option = echartsMock.chart.setOption.mock.calls.at(-1)?.[0] as {
      series?: Array<{ data?: unknown[] }>;
      xAxis?: { max?: number; min?: number };
    };
    expect(option.xAxis).toMatchObject({ max: endAt, min: startAt });
    expect(option.series?.[0]?.data?.at(0)).toEqual([startAt, 0]);
    expect(option.series?.[0]?.data?.at(-1)).toEqual([endAt, 9_000]);
    expect(option.series?.[0]?.data).toHaveLength(91);
    expect(screen.getByText("粒度：日")).toBeInTheDocument();
  });

  it("aggregates token trend into six-hour buckets for ranges within 30 days", async () => {
    const startAt = Date.UTC(2026, 5, 1);
    const endAt = Date.UTC(2026, 5, 21);
    const tokenHourly = [
      buildTrendPoint(startAt + 1 * 60 * 60 * 1000, 100),
      buildTrendPoint(startAt + 5 * 60 * 60 * 1000, 200),
      buildTrendPoint(startAt + 6 * 60 * 60 * 1000, 300),
      buildTrendPoint(startAt + 11 * 60 * 60 * 1000, 400),
      buildTrendPoint(startAt + 12 * 60 * 60 * 1000, 500),
    ];
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        timeRange: { preset: "30d" },
        trendRange: { startAt, endAt, label: "30d" },
        tokenHourly,
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store, "/analytics?range=30d");

    expect(await screen.findByTestId("token-trend-chart")).toBeInTheDocument();

    await waitFor(() => {
      expect(echartsMock.chart.setOption).toHaveBeenCalled();
    });

    const option = echartsMock.chart.setOption.mock.calls.at(-1)?.[0] as {
      series?: Array<{ data?: unknown[] }>;
      xAxis?: { max?: number; min?: number };
    };
    expect(option.xAxis).toMatchObject({ max: endAt, min: startAt });
    expect(option.series?.[0]?.data).toContainEqual([startAt, 300]);
    expect(option.series?.[0]?.data).toContainEqual([startAt + 6 * 60 * 60 * 1000, 700]);
    expect(option.series?.[0]?.data).toContainEqual([startAt + 12 * 60 * 60 * 1000, 500]);
    expect(screen.getByText("粒度：6小时")).toBeInTheDocument();
  });

  it("keeps contribution ranking items pinned to the top with fixed spacing", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    await screen.findByRole("heading", { name: "项目 token 贡献排行" });

    const rankings = screen.getByTestId("token-contribution-row");
    for (const column of rankings.querySelectorAll("[data-ranking-column]")) {
      expect(column.getAttribute("style")).toContain("align-content: start");
      expect(column.querySelector("[data-ranking-list]")?.getAttribute("style")).toContain(
        "align-content: start"
      );
    }
  });

  it("keeps ranking and attribution panel headers fixed while overflowing content scrolls inside", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    await screen.findByRole("heading", { name: "项目 token 贡献排行" });

    const rankings = screen.getByTestId("token-contribution-row");
    for (const column of rankings.querySelectorAll("[data-ranking-column]")) {
      expect(column).toHaveStyle({
        height: "340px",
        overflow: "hidden",
      });
      expect(column.getAttribute("style")).toContain("grid-template-rows: auto minmax(0, 1fr)");
      expect(column.firstElementChild?.querySelector("h2")).not.toBeNull();
      expect(column.querySelector("[data-ranking-scroll]")).toHaveStyle({
        minHeight: "0",
        overflowY: "auto",
      });
    }

    for (const panel of document.querySelectorAll("[data-compact-ranking-panel]")) {
      expect(panel).toHaveStyle({
        height: "300px",
        overflow: "hidden",
      });
      expect(panel.querySelector("[data-compact-ranking-scroll]")).toHaveStyle({
        minHeight: "0",
        overflowY: "auto",
      });
    }

    const skillPanel = document.querySelector("[data-skill-attribution-panel]");
    expect(skillPanel).toHaveStyle({
      height: "300px",
      overflow: "hidden",
    });
    expect(skillPanel?.querySelector("[data-skill-attribution-scroll]")).toHaveStyle({
      minHeight: "0",
      overflowY: "auto",
    });
  });

  it("explains the 24 hour consumption distribution data scope", async () => {
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        hourHeatmap: [
          { hour: 3, totalTokens: 1_200_000, sessionCount: 14, intensity: 1 },
          { hour: 9, totalTokens: 300_000, sessionCount: 5, intensity: 0.25 },
        ],
        tokenHourly: [],
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByRole("heading", { name: "24 小时消耗分布" })).toBeInTheDocument();
    expect(
      screen.getByText("按浏览器本地时区聚合当前筛选范围内所有日期，不表示某一天的连续 24 小时。")
    ).toBeInTheDocument();
    expect(screen.getByText("03:00-03:59")).toBeInTheDocument();
    expect(screen.getByText("1.2M")).toBeInTheDocument();
    expect(screen.getByText("80.0%")).toBeInTheDocument();
    expect(screen.getByText("峰值时段：03:00，1.2M tokens，占 80.0%。")).toBeInTheDocument();
    expect(screen.getByText("低消耗")).toBeInTheDocument();
    expect(screen.getByText("高消耗")).toBeInTheDocument();
  });

  it("uses a responsive grid for the 24 hour distribution so cards can wrap on narrow layouts", async () => {
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        hourHeatmap: [
          { hour: 3, totalTokens: 1_200_000, sessionCount: 14, intensity: 1 },
          { hour: 9, totalTokens: 300_000, sessionCount: 5, intensity: 0.25 },
        ],
        tokenHourly: [],
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    const grid = await screen.findByLabelText("24 小时 token 消耗分布");
    expect(grid.getAttribute("style")).toContain(
      "grid-template-columns: repeat(auto-fit, minmax(140px, 1fr))"
    );
  });

  it("groups hourly token consumption by the browser local timezone", () => {
    const points = buildLocalHourHeatmapPoints({
      hourly: [
        buildTrendPoint(Date.UTC(2026, 5, 1, 3), 1_200_000, { sessionCount: 14 }),
        buildTrendPoint(Date.UTC(2026, 5, 2, 3), 300_000, { sessionCount: 5 }),
      ],
      timeZone: "Asia/Shanghai",
    });

    expect(points.find((point) => point.hour === 3)?.totalTokens).toBe(0);
    expect(points.find((point) => point.hour === 11)?.totalTokens).toBe(1_500_000);
    expect(points.find((point) => point.hour === 11)?.sessionCount).toBe(19);
    expect(points.find((point) => point.hour === 11)?.intensity).toBe(1);
  });

  it("does not display the active workspace path in the global analysis header", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByRole("heading", { name: "工作分析" })).toBeInTheDocument();
    expect(screen.queryByText("/repo/project")).not.toBeInTheDocument();
  });

  it("renders scan provider sources in the header instead of a bottom data quality card", async () => {
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        providerStatuses: [
          {
            providerId: "claude",
            status: "supported",
            sessionCount: 60,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "codex",
            status: "supported",
            sessionCount: 10,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "gemini",
            status: "no_logs",
            sessionCount: 0,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "cursor",
            status: "no_logs",
            sessionCount: 0,
            parseErrorCount: 0,
            warningCount: 0,
          },
          {
            providerId: "opencode",
            status: "partial",
            sessionCount: 0,
            parseErrorCount: 0,
            warningCount: 1,
            warnings: [
              {
                code: "sqlite_query_failed",
                message: "Failed to query OpenCode SQLite database: missing table message",
              },
            ],
          },
        ],
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    const dataSource = await screen.findByTestId("work-analysis-data-source");
    expect(dataSource).toHaveTextContent("数据来源");
    expect(dataSource).toHaveTextContent("Claude 60");
    expect(dataSource).toHaveTextContent("Codex 10");
    expect(dataSource).toHaveTextContent("Gemini 无记录");
    expect(dataSource).toHaveTextContent("Cursor 无记录");
    expect(dataSource).toHaveTextContent("OpenCode 0 · 解析异常");
    expect(screen.getByTitle(/sqlite_query_failed/)).toHaveAttribute(
      "title",
      expect.stringContaining("Failed to query OpenCode SQLite database")
    );
    expect(screen.queryByRole("heading", { name: "数据质量" })).not.toBeInTheDocument();
  });

  it("uses the settings theme tokens instead of standalone light-card colors", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    const { container } = renderStandaloneAnalytics(store);

    const root = await screen.findByTestId("work-analysis-root");
    const trend = screen.getByTestId("token-trend-row");
    expect(root.getAttribute("style")).toContain("var(--text-primary)");
    expect(trend.getAttribute("style")).toContain("var(--surface-panel)");
    expect(container.innerHTML).not.toMatch(
      /--color-|#ffffff|#f6f8fb|#eef2f7|#d8dee8|#647084|#172033|#2563eb/
    );
  });

  it("places separate time and directory filter triggers in the header actions beside refresh", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByRole("heading", { name: "工作分析" })).toBeInTheDocument();

    const headerActions = screen.getByTestId("work-analysis-header-actions");
    expect(within(headerActions).getByRole("button", { name: /时间筛选/ })).toBeInTheDocument();
    expect(within(headerActions).getByRole("button", { name: /目录筛选/ })).toBeInTheDocument();
    expect(within(headerActions).getByRole("button", { name: "立即刷新" })).toBeInTheDocument();
    expect(within(headerActions).getByRole("button", { name: "强制刷新" })).toBeInTheDocument();
    const refreshHelp = within(headerActions).getByRole("button", { name: "刷新方式说明" });
    fireEvent.mouseEnter(refreshHelp);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "立即刷新：只补齐未统计的小时索引"
    );
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      "强制刷新：清空小时索引后全量重扫历史日志"
    );
    expect(within(headerActions).queryByRole("button", { name: /^筛选：/ })).toBeNull();
    expect(screen.queryByRole("combobox", { name: "时间范围" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: "/root/workspace/coder-studio" })).toBeNull();
  });

  it("opens the time popover and changes the time range with one click", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/analytics"]}>
          <LocationProbe />
          <Routes>
            <Route path="/analytics" element={<WorkAnalyticsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /时间筛选/ }));

    const popover = screen.getByRole("dialog", { name: "筛选时间范围" });
    const rangeGroup = within(popover).getByRole("radiogroup", { name: "时间范围" });
    expect(within(popover).queryByRole("combobox", { name: "时间范围" })).toBeNull();
    expect(within(rangeGroup).getByRole("radio", { name: "最近 30 天" })).toHaveAttribute(
      "aria-checked",
      "true"
    );
    expect(within(popover).queryByRole("checkbox")).toBeNull();

    fireEvent.click(within(rangeGroup).getByRole("radio", { name: "最近 7 天" }));

    await Promise.all([
      waitFor(() => {
        expect(screen.getByTestId("location-display")).toHaveTextContent("/analytics?range=7d");
      }),
      waitFor(() => {
        expect(sendCommand).toHaveBeenCalledWith(
          "work.analysis.dashboard.get",
          { timeRange: { preset: "7d" } },
          undefined
        );
      }),
    ]);
    expect(screen.queryByRole("dialog", { name: "筛选时间范围" })).toBeNull();
  }, 10_000);

  it("renders the newly fetched dashboard data after changing the time filter", async () => {
    const sendCommand = vi.fn(async (_op: string, args: unknown) => {
      const query = args as { timeRange?: WorkAnalysisTimeRange };
      return buildDashboard({
        timeRange: query.timeRange,
        totalTokens: query.timeRange?.preset === "7d" ? 7_000_000 : 30_000_000,
      });
    });
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByText("30M")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /时间筛选/ }));
    fireEvent.click(screen.getByRole("radio", { name: "最近 7 天" }));

    expect(await screen.findByText("7M")).toBeInTheDocument();
    expect(screen.queryByText("30M")).toBeNull();
  });

  it("opens the custom start and end DateTimePicker controls from the time popover", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    fireEvent.click(await screen.findByRole("button", { name: /时间筛选/ }));

    const popover = screen.getByRole("dialog", { name: "筛选时间范围" });
    fireEvent.click(within(popover).getByRole("radio", { name: "自定义" }));

    const startControl = await within(popover).findByRole("button", { name: "开始时间" });
    const endControl = within(popover).getByRole("button", { name: "结束时间" });
    expect(startControl.tagName).toBe("BUTTON");
    expect(endControl.tagName).toBe("BUTTON");

    fireEvent.click(startControl);
    expect(screen.getByRole("dialog", { name: "开始时间" })).toBeInTheDocument();

    const confirmButton = screen.getByRole("button", { name: "确认" });
    fireEvent.pointerDown(confirmButton);
    fireEvent.click(confirmButton);
    expect(screen.getByRole("dialog", { name: "筛选时间范围" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "开始时间" })).toBeNull();
  });

  it("closes the open custom DateTimePicker when another custom DateTimePicker opens", async () => {
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    fireEvent.click(await screen.findByRole("button", { name: /时间筛选/ }));

    const popover = screen.getByRole("dialog", { name: "筛选时间范围" });
    fireEvent.click(within(popover).getByRole("radio", { name: "自定义" }));

    const startControl = await within(popover).findByRole("button", { name: "开始时间" });
    const endControl = within(popover).getByRole("button", { name: "结束时间" });

    fireEvent.click(startControl);
    expect(screen.getByRole("dialog", { name: "开始时间" })).toBeInTheDocument();

    fireEvent.click(endControl);
    expect(screen.queryByRole("dialog", { name: "开始时间" })).toBeNull();
    expect(screen.getByRole("dialog", { name: "结束时间" })).toBeInTheDocument();
  });

  it("clears stale dashboard data while loading a changed time filter", async () => {
    const pendingSevenDayDashboard = createDeferred<WorkAnalysisDashboardRecord>();
    const sendCommand = vi.fn(async (_op: string, args: unknown) => {
      const query = args as { timeRange?: WorkAnalysisTimeRange };
      if (query.timeRange?.preset === "7d") {
        return pendingSevenDayDashboard.promise;
      }

      return buildDashboard({
        timeRange: query.timeRange,
        totalTokens: 30_000_000,
      });
    });
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByText("30M")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /时间筛选/ }));
    fireEvent.click(screen.getByRole("radio", { name: "最近 7 天" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText("30M")).toBeNull();
    expect(screen.getByText("正在读取或补齐索引")).toBeInTheDocument();

    pendingSevenDayDashboard.resolve(
      buildDashboard({ timeRange: { preset: "7d" }, totalTokens: 7_000_000 })
    );

    expect(await screen.findByText("7M")).toBeInTheDocument();
  });

  it("shows automatic scan state while the first dashboard request is rebuilding the index", async () => {
    const pendingDashboard = createDeferred<WorkAnalysisDashboardRecord>();
    const sendCommand = vi.fn(() => pendingDashboard.promise);
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    expect(await screen.findByRole("heading", { name: "工作分析" })).toBeInTheDocument();
    expect(screen.getByText("扫描中")).toBeInTheDocument();
    expect(screen.getByText("自动扫描")).toBeInTheDocument();
    expect(screen.getByText("正在读取或补齐索引")).toBeInTheDocument();
    expect(screen.queryByText("待机")).toBeNull();

    pendingDashboard.resolve(buildDashboard());
  });

  it("keeps both filter entries as popovers instead of the mobile sheet fallback", async () => {
    viewportMock.value = "mobile";
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    fireEvent.click(await screen.findByRole("button", { name: /时间筛选/ }));

    expect(screen.getByRole("dialog", { name: "筛选时间范围" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "筛选时间范围 sheet" })).toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "筛选时间范围" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: /目录筛选/ }));

    expect(screen.getByRole("dialog", { name: "筛选目录" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "筛选目录 sheet" })).toBeNull();
  });

  it("supports directory multi-select and reset from the directory popover", async () => {
    const sendCommand = vi.fn(async (_op: string, args: unknown) => {
      const query = args as { workspacePaths?: string[]; timeRange?: WorkAnalysisTimeRange };
      return buildDashboard({
        projects: query.workspacePaths ?? ["/repo/a", "/repo/b"],
        timeRange: query.timeRange,
      });
    });
    const store = createStoreWithAnalysis(sendCommand);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/analytics"]}>
          <LocationProbe />
          <Routes>
            <Route path="/analytics" element={<WorkAnalyticsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    fireEvent.click(await screen.findByRole("button", { name: /目录筛选/ }));

    const popover = screen.getByRole("dialog", { name: "筛选目录" });
    expect(within(popover).queryByRole("combobox", { name: "时间范围" })).toBeNull();
    const projectA = await within(popover).findByRole("checkbox", { name: "/repo/a" });
    const projectB = await within(popover).findByRole("checkbox", { name: "/repo/b" });
    expect(projectA).toHaveAttribute("aria-checked", "true");
    expect(projectB).toHaveAttribute("aria-checked", "true");

    fireEvent.click(projectA);

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent(
        "/analytics?workspacePath=%2Frepo%2Fa"
      );
      expect(within(popover).getByRole("checkbox", { name: "/repo/a" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
      expect(within(popover).getByRole("checkbox", { name: "/repo/b" })).toHaveAttribute(
        "aria-checked",
        "false"
      );
      expect(screen.getByRole("button", { name: /目录筛选/ })).toHaveTextContent("1 个目录");
    });

    fireEvent.click(within(popover).getByRole("checkbox", { name: "/repo/b" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent(
        "/analytics?workspacePath=%2Frepo%2Fa&workspacePath=%2Frepo%2Fb"
      );
      expect(within(popover).getByRole("checkbox", { name: "/repo/b" })).toHaveAttribute(
        "aria-checked",
        "true"
      );
    });

    fireEvent.click(within(popover).getByRole("button", { name: "全部目录" }));

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/analytics");
    });
    expect(screen.getByRole("button", { name: /目录筛选/ })).toHaveTextContent("全部目录");
  }, 15_000);

  it("refreshes the dashboard index from the primary action", async () => {
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "work.analysis.dashboard.refresh") {
        return buildDashboard();
      }
      return buildDashboard();
    });
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    const headerActions = await screen.findByTestId("work-analysis-header-actions");
    fireEvent.click(within(headerActions).getByRole("button", { name: "立即刷新" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "work.analysis.dashboard.refresh",
        {
          timeRange: { preset: "30d" },
        },
        undefined
      );
    });
  }, 10_000);

  it("shows an inline refresh activity rail while the dashboard refresh is pending", async () => {
    const pendingRefresh = createDeferred<WorkAnalysisDashboardRecord>();
    const sendCommand = vi.fn((op: string) => {
      if (op === "work.analysis.dashboard.refresh") {
        return pendingRefresh.promise;
      }
      return Promise.resolve(buildDashboard());
    });
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    fireEvent.click(await screen.findByRole("button", { name: "立即刷新" }));

    expect(await screen.findByRole("status", { name: "正在刷新工作分析索引" })).toHaveTextContent(
      "正在补齐小时索引"
    );
    expect(screen.getByRole("button", { name: "刷新中" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByText("页面数据保持可读")).toBeInTheDocument();

    pendingRefresh.resolve(buildDashboard({ totalTokens: 14_000_000 }));

    await waitFor(() => {
      expect(screen.queryByRole("status", { name: "正在刷新工作分析索引" })).toBeNull();
    });
    expect(screen.getByRole("button", { name: "立即刷新" })).toBeInTheDocument();
  });

  it("clears and rebuilds the hourly index from the header action", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const sendCommand = vi.fn(async (op: string) => {
      if (op === "work.analysis.dashboard.rebuild") {
        return buildDashboard({ projects: ["/repo/rebuilt"], totalTokens: 9_000 });
      }
      return buildDashboard();
    });
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    fireEvent.click(await screen.findByRole("button", { name: "强制刷新" }));

    const dialog = await screen.findByRole("dialog", { name: "强制刷新工作分析索引？" });
    expect(
      within(dialog).getByText("将清空工作分析小时索引并重新扫描历史日志。")
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("这不会删除原始日志，但强制刷新期间统计数据会短暂刷新。")
    ).toBeInTheDocument();
    expect(confirm).not.toHaveBeenCalled();
    expect(sendCommand.mock.calls.some(([op]) => op === "work.analysis.dashboard.rebuild")).toBe(
      false
    );

    fireEvent.click(within(dialog).getByRole("button", { name: "确认强制刷新" }));

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "work.analysis.dashboard.rebuild",
        {
          timeRange: { preset: "30d" },
        },
        undefined
      );
    });
    expect(confirm).not.toHaveBeenCalled();
    expect(await screen.findByText("/repo/rebuilt")).toBeInTheDocument();

    confirm.mockRestore();
  });

  it("does not rebuild the hourly index when the custom confirmation is cancelled", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const sendCommand = vi.fn(async () => buildDashboard());
    const store = createStoreWithAnalysis(sendCommand);

    renderStandaloneAnalytics(store);

    fireEvent.click(await screen.findByRole("button", { name: "强制刷新" }));

    const dialog = await screen.findByRole("dialog", { name: "强制刷新工作分析索引？" });
    fireEvent.click(within(dialog).getByRole("button", { name: "取消" }));

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "强制刷新工作分析索引？" })
      ).not.toBeInTheDocument();
    });
    expect(sendCommand.mock.calls.some(([op]) => op === "work.analysis.dashboard.rebuild")).toBe(
      false
    );
    expect(confirm).not.toHaveBeenCalled();

    confirm.mockRestore();
  });

  it("keeps an explicit 7 day range from the URL", async () => {
    const sendCommand = vi.fn(async () =>
      buildDashboard({
        timeRange: { preset: "7d" },
      })
    );
    const store = createStoreWithAnalysis(sendCommand);

    render(
      <Provider store={store}>
        <MemoryRouter initialEntries={["/analytics?range=7d"]}>
          <LocationProbe />
          <Routes>
            <Route path="/analytics" element={<WorkAnalyticsPage />} />
          </Routes>
        </MemoryRouter>
      </Provider>
    );

    await screen.findByRole("heading", { name: "工作分析" });

    await waitFor(() => {
      expect(screen.getByTestId("location-display")).toHaveTextContent("/analytics?range=7d");
    });

    await waitFor(() => {
      expect(sendCommand).toHaveBeenCalledWith(
        "work.analysis.dashboard.get",
        {
          timeRange: { preset: "7d" },
        },
        undefined
      );
    });
  });
});

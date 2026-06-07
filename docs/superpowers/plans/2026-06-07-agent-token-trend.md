# Agent Token Trend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact 24-hour token consumption trend chart at the top of the expanded AGENT.MD sidebar panel.

**Architecture:** Keep the feature frontend-only by querying the existing `work.analysis.dashboard.get` command with the current workspace path and `{ preset: "24h" }`. Add a focused `AgentInstructionsTokenTrend` child component beside the existing Agent.md panel component, and let `AgentInstructionsSection` render it before the project/system Agent.md groups. Use ECharts already present in `@coder-studio/web`; no new dependency or server command is needed.

**Tech Stack:** React 19, Jotai command dispatch atom, ECharts, Vitest, Testing Library, existing CSS token system.

---

## File Structure

- Create `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.tsx`: self-contained chart component that loads 24h work-analysis data, normalizes totals, renders loading/ready/empty/error states, and manages ECharts lifecycle.
- Create `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx`: focused tests for dispatch payload, data rendering, empty state, and error state.
- Modify `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`: import and render `AgentInstructionsTokenTrend` as the first expanded body block when `workspace?.path` exists.
- Modify `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`: add the token trend translation keys, mock the child component, and assert placement before the project Agent.md group.
- Modify `packages/web/src/styles/components.css`: add token-backed classes for the compact trend block and responsive behavior.
- Modify `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`: add user-facing labels for title, subtitle, empty/error/loading, total, peak, and sessions.

---

### Task 1: Token Trend Component Behavior

**Files:**
- Create: `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.tsx`
- Create: `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx`:

```tsx
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

function buildDashboard(tokenHourly = [
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
]) {
  return {
    ok: true,
    data: {
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
      expect(dispatch).toHaveBeenCalledWith("work.analysis.dashboard.get", {
        workspacePaths: ["/repo/project"],
        timeRange: { preset: "24h" },
      });
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
    const dispatch = vi.fn(async () => ({
      ok: false,
      error: { code: "command_error", message: "boom" },
    }));

    renderTrend(dispatch);

    expect(await screen.findByText("Token trend unavailable.")).toBeInTheDocument();
    expect(echartsMock.init).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the component test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx
```

Expected: FAIL because `./agent-instructions-token-trend` does not exist.

- [ ] **Step 3: Implement the minimal component**

Create `packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.tsx`:

```tsx
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

export function AgentInstructionsTokenTrend({ workspacePath }: AgentInstructionsTokenTrendProps) {
  const t = useTranslation();
  const dispatch = useAtomValue(dispatchCommandAtom);
  const chartRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<TrendState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });

    async function loadTrend() {
      const result = await dispatch<WorkAnalysisDashboardRecord>("work.analysis.dashboard.get", {
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
  }, [dispatch, workspacePath]);

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
    <section className="workspace-agent-instructions__token-trend">
      <div className="workspace-agent-instructions__token-trend-header">
        <div>
          <h3 className="workspace-agent-instructions__token-trend-title">
            {t("workspace.agent_instructions.token_trend.title")}
          </h3>
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
    </section>
  );
}
```

- [ ] **Step 4: Run the component test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the component behavior**

Run:

```bash
git add packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.tsx packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx
git commit -m "feat(workspace): add agent token trend component"
```

Expected: commit succeeds.

---

### Task 2: Panel Integration and Placement

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`

- [ ] **Step 1: Write the failing placement test**

In `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`, add this mock near the existing mocks:

```tsx
vi.mock("./agent-instructions-token-trend", () => ({
  AgentInstructionsTokenTrend: ({ workspacePath }: { workspacePath: string }) => (
    <section data-testid="agent-token-trend" data-workspace-path={workspacePath}>
      Token trend mock
    </section>
  ),
}));
```

Add this test in the `describe("AgentInstructionsSection", () => { ... })` block after the existing expanded-default test:

```tsx
  it("renders the token trend as the first expanded body block for the current workspace", async () => {
    renderSection({});

    const trend = await screen.findByTestId("agent-token-trend");
    const projectHeading = await screen.findByRole("heading", { level: 3, name: "Project Agent.md" });

    expect(trend).toHaveAttribute("data-workspace-path", "/repo/project");
    expect(trend.compareDocumentPosition(projectHeading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
```

- [ ] **Step 2: Run the section test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: FAIL because `agent-token-trend` is not rendered.

- [ ] **Step 3: Render the token trend at the top of the expanded panel body**

Modify `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`.

Add the import:

```tsx
import { AgentInstructionsTokenTrend } from "./agent-instructions-token-trend";
```

Add this as the first child inside `<div className="workspace-agent-instructions__body">`, before the error notice:

```tsx
          {workspace?.path ? <AgentInstructionsTokenTrend workspacePath={workspace.path} /> : null}
```

- [ ] **Step 4: Run the section test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit the panel integration**

Run:

```bash
git add packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx
git commit -m "feat(workspace): show token trend in agent panel"
```

Expected: commit succeeds.

---

### Task 3: Styling and Localization

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing style token guard**

In `packages/web/src/styles/components.theme.test.ts`, add this test near the existing workspace agent instruction or monitoring style guard tests:

```ts
  it("keeps the agent token trend chart on shared theme tokens", () => {
    const tokenTrend = getLastRuleBlock(".workspace-agent-instructions__token-trend");
    const chart = getLastRuleBlock(".workspace-agent-instructions__token-trend-chart");
    const skeleton = getLastRuleBlock(".workspace-agent-instructions__token-trend-skeleton");

    expect(tokenTrend).toContain("border: 1px solid var(--border-subtle)");
    expect(tokenTrend).toContain("background: var(--surface-subtle)");
    expect(chart).toContain("height: 72px");
    expect(skeleton).toContain("color: var(--text-tertiary)");
  });
```

- [ ] **Step 2: Run the style test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/styles/components.theme.test.ts
```

Expected: FAIL because the new CSS selectors do not exist.

- [ ] **Step 3: Add CSS for the compact chart block**

In `packages/web/src/styles/components.css`, add these rules after the existing `.workspace-agent-instructions__status-action` rule and before `.workspace-agent-instructions__system-list`:

```css
.workspace-agent-instructions__token-trend {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: var(--gap-tight);
  padding: var(--sp-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  background: var(--surface-subtle);
}

.workspace-agent-instructions__token-trend-header {
  display: flex;
  min-width: 0;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--gap-tight);
}

.workspace-agent-instructions__token-trend-title {
  margin: 0;
  color: var(--text-primary);
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
}

.workspace-agent-instructions__token-trend-subtitle {
  margin: var(--sp-0-5) 0 0;
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
}

.workspace-agent-instructions__token-trend-total {
  flex: 0 0 auto;
  color: var(--text-primary);
  font-size: var(--type-body-5-size);
  line-height: var(--type-body-5-line-height);
  font-weight: var(--type-body-5-weight);
  white-space: nowrap;
}

.workspace-agent-instructions__token-trend-chart {
  width: 100%;
  height: 72px;
  min-width: 0;
}

.workspace-agent-instructions__token-trend-footer {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--gap-compact);
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
}

.workspace-agent-instructions__token-trend-skeleton,
.workspace-agent-instructions__token-trend-state {
  display: flex;
  min-height: 72px;
  align-items: center;
  justify-content: center;
  margin: 0;
  color: var(--text-tertiary);
  font-size: var(--type-body-6-size);
  line-height: var(--type-body-6-line-height);
  text-align: center;
}
```

- [ ] **Step 4: Add localization strings**

In `packages/web/src/locales/en.json`, under `workspace.agent_instructions`, add:

```json
"token_trend": {
  "title": "Token Trend",
  "subtitle": "Current project · Last 24 hours",
  "loading": "Loading token trend...",
  "empty": "No token data in the last 24 hours.",
  "error": "Token trend unavailable.",
  "total": "Total {value}",
  "peak": "Peak {value}/h",
  "sessions": "{count} sessions",
  "chart_label": "Token consumption trend for the current project over the last 24 hours"
}
```

In `packages/web/src/locales/zh.json`, under `workspace.agent_instructions`, add:

```json
"token_trend": {
  "title": "Token 消耗趋势",
  "subtitle": "当前项目 · 最近 24 小时",
  "loading": "正在加载 token 趋势...",
  "empty": "最近 24 小时暂无 token 数据。",
  "error": "Token 趋势暂不可用。",
  "total": "总量 {value}",
  "peak": "峰值 {value}/h",
  "sessions": "{count} 个会话",
  "chart_label": "当前项目最近 24 小时 Token 消耗趋势图"
}
```

- [ ] **Step 5: Run style and focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/styles/components.theme.test.ts src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit styling and localization**

Run:

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/components.theme.test.ts packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "style(workspace): polish agent token trend"
```

Expected: commit succeeds.

---

### Task 4: Final Verification

**Files:**
- Read: `docs/superpowers/specs/2026-06-07-agent-token-trend-design.md`
- Read: `docs/superpowers/plans/2026-06-07-agent-token-trend.md`

- [ ] **Step 1: Run focused web tests**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-token-trend.test.tsx src/features/workspace/views/shared/agent-instructions-section.test.tsx src/styles/components.theme.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run web typecheck**

Run:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
```

Expected: PASS.

- [ ] **Step 3: Review the git diff against the spec**

Run:

```bash
git diff --stat HEAD~3..HEAD
git diff HEAD~3..HEAD -- packages/web/src/features/workspace/views/shared/agent-instructions-token-trend.tsx packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx packages/web/src/styles/components.css packages/web/src/locales/en.json packages/web/src/locales/zh.json
```

Expected: diff shows only the planned frontend chart, integration, style, and locale changes.

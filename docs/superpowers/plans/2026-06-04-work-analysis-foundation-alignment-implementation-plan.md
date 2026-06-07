# Work Analysis Foundation Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade `/analytics` from summary cards into a token-first, event-driven analytics surface with real workspace discovery, trend charts, efficiency signals, compare views, yield views, and budget/export support aligned to the approved foundation design.

**Architecture:** Extend provider log parsing into a canonical event stream, derive stable analytics contracts from those events, then upgrade the web analytics page to consume the shared contract for charts, rankings, and drill-down tables. Keep workspace filtering result-driven, preserve token-first semantics, and surface provider capability gaps explicitly.

**Tech Stack:** TypeScript, pnpm monorepo, Vitest, Playwright, React, Vite, Jotai, existing server work-analysis pipeline, existing web `/analytics` feature

---

## File Structure

### Server

- Modify: `packages/server/src/work-analysis/log-sources/types.ts`
  - Expand provider parse output into canonical event records and capability flags.
- Modify: `packages/server/src/work-analysis/log-sources/claude.ts`
  - Extract ordered turn and usage signals from Claude logs.
- Modify: `packages/server/src/work-analysis/log-sources/codex.ts`
  - Extract ordered turn and usage signals from Codex logs.
- Modify: `packages/server/src/work-analysis/types.ts`
  - Add analytics contract fields for trends, share series, efficiency signals, compare tables, yield samples, and budget forecast payloads.
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
  - Validate new server response shape.
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
  - Build canonical event aggregates and expose richer analytics payloads.
- Create: `packages/server/src/work-analysis/metrics/trends.ts`
  - Build day buckets and share series.
- Create: `packages/server/src/work-analysis/metrics/efficiency.ts`
  - Compute one-shot, retry, self-correction, read:edit, command-to-edit, and cache-hit metrics.
- Modify: `packages/server/src/work-analysis/metrics/compare.ts`
  - Return chart-friendly and table-friendly compare structures.
- Modify: `packages/server/src/work-analysis/metrics/yield.ts`
  - Add yield scorecards and sample session lists.
- Modify: `packages/server/src/work-analysis/metrics/token-budgets.ts`
  - Add active-day average, forecast, and threshold detail.
- Modify: `packages/server/src/work-analysis/metrics/token-efficiency.ts`
  - Reconcile older optimize/token waste helpers with the new efficiency contract.
- Modify: `packages/server/src/work-analysis/optimize/detect-findings.ts`
  - Add low-yield and retry-heavy findings using canonical events.
- Modify: `packages/server/src/work-analysis/service.ts`
  - Return enriched snapshots without changing command routing semantics.

### Server Tests

- Modify: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
  - Cover day trends, workspace discovery, capability signaling, and compare payload shape.
- Create: `packages/server/src/__tests__/work-analysis-efficiency-metrics.test.ts`
  - Cover retry, one-shot, command-to-edit, read:edit, and cache-hit calculations.
- Modify: `packages/server/src/__tests__/work-analysis-efficiency-and-optimize.test.ts`
  - Cover new optimize detectors and yield sample outputs.
- Modify: `packages/server/src/__tests__/work-analysis-service.test.ts`
  - Cover enriched snapshot fields.
- Modify: `packages/server/src/__tests__/work-analysis-commands.test.ts`
  - Cover contract shape exposed by commands.

### Web

- Modify: `packages/web/src/features/work-analysis/types.ts`
  - Match the enriched server contract.
- Modify: `packages/web/src/features/work-analysis/format.ts`
  - Add chart/table formatting helpers for trends, shares, efficiency, and budgets.
- Modify: `packages/web/src/features/work-analysis/page.tsx`
  - Add chart-ready overview, compare, efficiency, yield, and budget sections.
- Modify: `packages/web/src/features/work-analysis/use-work-analysis-controller.ts`
  - Preserve filter state and expose derived chart inputs if needed.
- Modify: `packages/web/src/locales/en.json`
  - Add analytics chart, legend, scorecard, and table labels.
- Modify: `packages/web/src/locales/zh.json`
  - Add corresponding Chinese labels.

### Web Tests

- Modify: `packages/web/src/features/work-analysis/page.test.tsx`
  - Assert chart headings, tab content, and capability notices render from enriched data.
- Modify: `packages/web/src/features/settings/components/session-analysis-settings.tsx`
  - Keep launcher + lightweight summary aligned with the richer analytics surface.
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
  - Keep settings entry behavior stable.

### Acceptance

- Modify: `e2e/specs/settings/analysis.spec.ts`
  - Assert discovered workspace list still appears and analytics page exposes richer sections.

---

### Task 1: Lock The Canonical Event Contract

**Files:**
- Modify: `packages/server/src/work-analysis/log-sources/types.ts`
- Modify: `packages/server/src/work-analysis/log-sources/claude.ts`
- Modify: `packages/server/src/work-analysis/log-sources/codex.ts`
- Test: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`

- [ ] **Step 1: Write the failing analyzer test for canonical event-driven workspace discovery and daily trend inputs**

```ts
it("collects ordered canonical events and discovered workspace paths from provider logs", () => {
  const result = runBasicAnalysis({
    sessions: [
      makeClaudeSession({
        workspacePath: "/root/workspace/a",
        turns: [
          makeTurn({ type: "message_turn", timestamp: 1000, totalTokens: 120 }),
          makeTurn({ type: "command", timestamp: 1500 }),
          makeTurn({ type: "edit", timestamp: 1700 }),
        ],
      }),
      makeCodexSession({
        workspacePath: "/root/workspace/b",
        turns: [
          makeTurn({ type: "message_turn", timestamp: 2000, totalTokens: 80 }),
          makeTurn({ type: "tool_call", timestamp: 2100 }),
        ],
      }),
    ],
  });

  expect(result.coverage.discoveredWorkspacePaths).toEqual([
    "/root/workspace/a",
    "/root/workspace/b",
  ]);
  expect(result.activity.daily.length).toBeGreaterThan(0);
  expect(result.capabilityMatrix.providers).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ providerId: "claude" }),
      expect.objectContaining({ providerId: "codex" }),
    ])
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts -t "collects ordered canonical events and discovered workspace paths from provider logs"`

Expected: FAIL because `activity.daily` or canonical-event-derived fields are missing.

- [ ] **Step 3: Write the canonical event types and provider extraction**

```ts
export interface WorkAnalysisEvent {
  type:
    | "session_boundary"
    | "message_turn"
    | "tool_call"
    | "tool_result"
    | "command"
    | "edit"
    | "plan"
    | "agent_spawn"
    | "git_signal"
    | "usage";
  sessionId: string;
  providerId: string;
  modelId?: string;
  workspacePath?: string;
  timestamp?: number;
  timestampSource: "explicit" | "inferred";
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningTokens?: number;
    totalTokens?: number;
  };
  rawRefs: string[];
}
```

```ts
return {
  ...session,
  discoveredWorkspacePath: workspacePath,
  events: extractedEvents.sort((left, right) => (left.timestamp ?? 0) - (right.timestamp ?? 0)),
  capabilities: {
    tokenUsage: hasUsage ? "full" : "partial",
    modelIdentity: hasModel ? "full" : "partial",
    timestamps: hasExplicitTimestamps ? "full" : "partial",
  },
};
```

- [ ] **Step 4: Run the targeted test to verify it passes**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts -t "collects ordered canonical events and discovered workspace paths from provider logs"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/work-analysis/log-sources/types.ts \
  packages/server/src/work-analysis/log-sources/claude.ts \
  packages/server/src/work-analysis/log-sources/codex.ts \
  packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts
git commit -m "feat: extract canonical analytics events from provider logs"
```

### Task 2: Add Trend, Compare, And Budget Metrics To The Server Contract

**Files:**
- Create: `packages/server/src/work-analysis/metrics/trends.ts`
- Modify: `packages/server/src/work-analysis/metrics/compare.ts`
- Modify: `packages/server/src/work-analysis/metrics/token-budgets.ts`
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
- Test: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
- Test: `packages/server/src/__tests__/work-analysis-service.test.ts`

- [ ] **Step 1: Write failing tests for daily trends, share series, compare tables, and forecast budgets**

```ts
it("returns chart-friendly trend and share payloads", () => {
  const result = runBasicAnalysis(makeMultiDayFixture());

  expect(result.activity.daily).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        day: "2026-06-01",
        totalTokens: expect.any(Number),
        sessionCount: expect.any(Number),
      }),
    ])
  );
  expect(result.compare.workspaces[0]).toEqual(
    expect.objectContaining({
      workspacePath: expect.any(String),
      totalTokens: expect.any(Number),
      sharePercent: expect.any(Number),
    })
  );
  expect(result.budgets.forecast30d).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-service.test.ts`

Expected: FAIL because new trend/share/budget fields do not exist yet.

- [ ] **Step 3: Implement minimal trend, compare, and budget payloads**

```ts
export interface WorkAnalysisDailyBucket {
  day: string;
  totalTokens: number;
  sessionCount: number;
}

export function buildDailyBuckets(events: WorkAnalysisEvent[]): WorkAnalysisDailyBucket[] {
  const buckets = new Map<string, WorkAnalysisDailyBucket>();
  for (const event of events) {
    if (!event.timestamp || !event.usage?.totalTokens) continue;
    const day = new Date(event.timestamp).toISOString().slice(0, 10);
    const bucket = buckets.get(day) ?? { day, totalTokens: 0, sessionCount: 0 };
    bucket.totalTokens += event.usage.totalTokens;
    buckets.set(day, bucket);
  }
  return [...buckets.values()].sort((left, right) => left.day.localeCompare(right.day));
}
```

```ts
budgets: {
  rolling7d,
  rolling30d,
  activeDayAverage,
  forecast30d: Math.round(activeDayAverage * 30),
  thresholds: {
    focus: buildBudgetStatus(rolling30d, 25_731_068),
    current: buildBudgetStatus(rolling30d, 34_308_090),
    stretch: buildBudgetStatus(rolling30d, 42_885_113),
  },
},
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-service.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/work-analysis/metrics/trends.ts \
  packages/server/src/work-analysis/metrics/compare.ts \
  packages/server/src/work-analysis/metrics/token-budgets.ts \
  packages/server/src/work-analysis/types.ts \
  packages/server/src/work-analysis/basic-schema.ts \
  packages/server/src/work-analysis/basic-analyzer.ts \
  packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts \
  packages/server/src/__tests__/work-analysis-service.test.ts
git commit -m "feat: add analytics trend compare and budget contracts"
```

### Task 3: Add Efficiency, Optimize, And Yield Signals

**Files:**
- Create: `packages/server/src/work-analysis/metrics/efficiency.ts`
- Modify: `packages/server/src/work-analysis/metrics/token-efficiency.ts`
- Modify: `packages/server/src/work-analysis/metrics/yield.ts`
- Modify: `packages/server/src/work-analysis/optimize/detect-findings.ts`
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
- Test: `packages/server/src/__tests__/work-analysis-efficiency-metrics.test.ts`
- Test: `packages/server/src/__tests__/work-analysis-efficiency-and-optimize.test.ts`

- [ ] **Step 1: Write failing tests for retry, one-shot, read:edit, and low-yield expensive sessions**

```ts
it("computes efficiency scorecards from canonical events", () => {
  const metrics = buildEfficiencyMetrics([
    makeSessionWithEvents({
      events: [
        event("message_turn", { totalTokens: 300 }),
        event("command"),
        event("edit"),
        event("git_signal"),
      ],
    }),
    makeSessionWithEvents({
      events: [event("message_turn", { totalTokens: 800 }), event("message_turn", { totalTokens: 500 })],
    }),
  ]);

  expect(metrics.oneShotRate).toBeGreaterThan(0);
  expect(metrics.retryRate).toBeGreaterThan(0);
  expect(metrics.readToEditRatio).toBeGreaterThan(0);
});
```

```ts
it("flags high-cost low-yield sessions in optimize findings", () => {
  const result = runBasicAnalysis(makeLowYieldFixture());

  expect(result.optimize.findings).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "high-cost-low-yield",
        severity: "high",
      }),
    ])
  );
  expect(result.yield.lowYieldSessions.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-efficiency-metrics.test.ts packages/server/src/__tests__/work-analysis-efficiency-and-optimize.test.ts`

Expected: FAIL because the efficiency metric builder and low-yield findings are incomplete.

- [ ] **Step 3: Implement minimal efficiency and yield derivation**

```ts
export interface WorkAnalysisEfficiencyMetrics {
  oneShotRate: number;
  retryRate: number;
  selfCorrectionRate: number;
  readToEditRatio: number;
  commandToEditRatio: number;
  cacheHitShare: number;
  gitAwareSessionRate: number;
}
```

```ts
const expensiveSessions = sessions
  .filter((session) => session.totalTokens >= HIGH_COST_THRESHOLD)
  .map((session) => ({
    sessionId: session.id,
    totalTokens: session.totalTokens,
    hasEdit: session.editCount > 0,
    hasGit: session.gitSignalCount > 0,
  }));

const lowYieldSessions = expensiveSessions.filter((session) => !session.hasEdit && !session.hasGit);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-efficiency-metrics.test.ts packages/server/src/__tests__/work-analysis-efficiency-and-optimize.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/work-analysis/metrics/efficiency.ts \
  packages/server/src/work-analysis/metrics/token-efficiency.ts \
  packages/server/src/work-analysis/metrics/yield.ts \
  packages/server/src/work-analysis/optimize/detect-findings.ts \
  packages/server/src/work-analysis/basic-analyzer.ts \
  packages/server/src/__tests__/work-analysis-efficiency-metrics.test.ts \
  packages/server/src/__tests__/work-analysis-efficiency-and-optimize.test.ts
git commit -m "feat: add efficiency and low-yield analytics signals"
```

### Task 4: Upgrade The Web Analytics Surface For Overview And Compare

**Files:**
- Modify: `packages/web/src/features/work-analysis/types.ts`
- Modify: `packages/web/src/features/work-analysis/format.ts`
- Modify: `packages/web/src/features/work-analysis/page.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/features/work-analysis/page.test.tsx`

- [ ] **Step 1: Write failing page tests for trend, share, and compare sections**

```tsx
it("renders overview trends and compare rankings from analytics data", async () => {
  renderWorkAnalyticsPage({
    analysis: makeAnalyticsRecord({
      basicResult: {
        activity: { daily: [{ day: "2026-06-01", totalTokens: 3000, sessionCount: 4 }] },
        compare: {
          workspaces: [{ workspacePath: "/root/workspace/a", totalTokens: 3000, sharePercent: 0.6 }],
        },
      },
    }),
  });

  expect(screen.getByText("Daily Token Trend")).toBeInTheDocument();
  expect(screen.getByText("/root/workspace/a")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/web/src/features/work-analysis/page.test.tsx -t "renders overview trends and compare rankings from analytics data"`

Expected: FAIL because the current page does not render those sections.

- [ ] **Step 3: Implement minimal overview and compare sections**

```tsx
<div style={surfaceStyle}>
  <strong>{t("settings.analysis.daily_token_trend")}</strong>
  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
    {basicResult.activity.daily.map((bucket) => (
      <li key={bucket.day}>
        {bucket.day}: {formatTokenMetric(bucket.totalTokens)} tokens, {formatInteger(bucket.sessionCount)} sessions
      </li>
    ))}
  </ul>
</div>
```

```tsx
<div style={surfaceStyle}>
  <strong>{t("settings.analysis.workspace_ranking")}</strong>
  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
    {compare?.workspaces.map((entry) => (
      <li key={entry.workspacePath}>
        {entry.workspacePath}: {formatTokenMetric(entry.totalTokens)} tokens, {formatPercent(entry.sharePercent)}
      </li>
    ))}
  </ul>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/web/src/features/work-analysis/page.test.tsx -t "renders overview trends and compare rankings from analytics data"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/work-analysis/types.ts \
  packages/web/src/features/work-analysis/format.ts \
  packages/web/src/features/work-analysis/page.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json \
  packages/web/src/features/work-analysis/page.test.tsx
git commit -m "feat: add overview and compare analytics sections"
```

### Task 5: Upgrade The Web Analytics Surface For Efficiency, Yield, And Budgets

**Files:**
- Modify: `packages/web/src/features/work-analysis/page.tsx`
- Modify: `packages/web/src/features/work-analysis/format.ts`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/features/work-analysis/page.test.tsx`

- [ ] **Step 1: Write failing tests for efficiency scorecards, low-yield tables, and budget forecast**

```tsx
it("renders efficiency scorecards and budget forecast", async () => {
  renderWorkAnalyticsPage({
    analysis: makeAnalyticsRecord({
      basicResult: {
        efficiency: { oneShotRate: 0.42, retryRate: 0.18, readToEditRatio: 2.4, commandToEditRatio: 1.3 },
        yield: { lowYieldSessions: [{ sessionId: "s-1", totalTokens: 1200, labels: ["no_edit"] }] },
        budgets: { forecast30d: 40000, thresholds: { current: { status: "over", percentUsed: 1.1 } } },
      },
    }),
  });

  expect(screen.getByText("One-Shot Rate")).toBeInTheDocument();
  expect(screen.getByText("Forecast 30 Days")).toBeInTheDocument();
  expect(screen.getByText("s-1")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run packages/web/src/features/work-analysis/page.test.tsx -t "renders efficiency scorecards and budget forecast"`

Expected: FAIL because the current tabs do not render those fields.

- [ ] **Step 3: Implement minimal efficiency, yield, and budget sections**

```tsx
<div style={surfaceStyle}>
  <strong>{t("settings.analysis.efficiency_scorecards")}</strong>
  <ul style={{ margin: 0, paddingInlineStart: 18 }}>
    <li>{t("settings.analysis.one_shot_rate")}: {formatPercent(basicResult.efficiency.oneShotRate)}</li>
    <li>{t("settings.analysis.retry_rate")}: {formatPercent(basicResult.efficiency.retryRate)}</li>
    <li>{t("settings.analysis.read_to_edit_ratio")}: {basicResult.efficiency.readToEditRatio.toFixed(2)}</li>
  </ul>
</div>
```

```tsx
<div style={surfaceStyle}>
  <strong>{t("settings.analysis.forecast_30d")}</strong>
  <span>{formatTokenMetric(basicResult.budgets.forecast30d)}</span>
</div>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run packages/web/src/features/work-analysis/page.test.tsx -t "renders efficiency scorecards and budget forecast"`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/work-analysis/page.tsx \
  packages/web/src/features/work-analysis/format.ts \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json \
  packages/web/src/features/work-analysis/page.test.tsx
git commit -m "feat: add efficiency yield and budget analytics views"
```

### Task 6: Keep Settings Entry And Acceptance Coverage Stable

**Files:**
- Modify: `packages/web/src/features/settings/components/session-analysis-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `e2e/specs/settings/analysis.spec.ts`

- [ ] **Step 1: Write failing tests for the settings launcher summary and richer analytics acceptance**

```tsx
it("keeps the settings analysis section focused on launch + summary", async () => {
  renderSettingsPageWithAnalysisSummary();

  expect(screen.getByRole("button", { name: /open analytics/i })).toBeInTheDocument();
  expect(screen.queryByText(/daily token trend/i)).not.toBeInTheDocument();
});
```

```ts
await expect(page.getByRole("tab", { name: translatePatternForE2E("settings.analysis.tab_compare") })).toBeVisible();
await expect(page.getByText(/workspace-b$/)).toBeVisible();
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run packages/web/src/features/settings/components/settings-page.test.tsx`

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/settings/analysis.spec.ts`

Expected: At least one assertion fails until launcher text and richer analytics expectations are aligned.

- [ ] **Step 3: Implement the minimal settings and acceptance updates**

```tsx
<Notice message={t("settings.analysis.analytics_hint")} />
<Button type="button" onClick={openAnalytics}>
  {t("settings.analysis.open_analytics")}
</Button>
```

```ts
await expect(
  page.getByRole("tablist", {
    name: translatePatternForE2E("settings.analysis.analytics_sections"),
  })
).toBeVisible();
await expect(page.getByText(translatePatternForE2E("settings.analysis.coverage_summary_title"))).toBeVisible();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run packages/web/src/features/settings/components/settings-page.test.tsx`

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/settings/analysis.spec.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/settings/components/session-analysis-settings.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  e2e/specs/settings/analysis.spec.ts
git commit -m "test: keep analytics launcher and acceptance coverage aligned"
```

### Task 7: Full Verification And Real-Log Screenshot Pass

**Files:**
- Modify: `docs/superpowers/plans/2026-06-04-work-analysis-foundation-alignment-implementation-plan.md`
  - Check off completed tasks during execution only.
- Output: `e2e/test-results/work-analytics-real-overview.png`
- Output: `e2e/test-results/work-analytics-real-compare.png`
- Output: `e2e/test-results/work-analytics-real-yield.png`
- Output: `e2e/test-results/work-analytics-real-budgets.png`

- [ ] **Step 1: Run focused server and web verification**

Run: `pnpm vitest run packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-commands.test.ts packages/server/src/__tests__/work-analysis-efficiency-metrics.test.ts packages/server/src/__tests__/work-analysis-efficiency-and-optimize.test.ts packages/server/src/__tests__/work-analysis-service.test.ts packages/web/src/features/work-analysis/page.test.tsx packages/web/src/features/settings/components/settings-page.test.tsx`

Expected: PASS, or document exact failures before continuing.

- [ ] **Step 2: Run acceptance coverage**

Run: `pnpm --dir e2e exec playwright test --config playwright.config.ts e2e/specs/settings/analysis.spec.ts`

Expected: PASS with discovered workspace paths still visible.

- [ ] **Step 3: Capture real-log screenshots from the live analytics page**

```bash
HOST=127.0.0.1 PORT=4273 STATE_DIR=/tmp/coder-studio-analytics-state \
RUNTIME_DIR=/tmp/coder-studio-analytics-runtime NO_AUTH=true \
pnpm exec tsx packages/server/src/server.ts
```

```bash
HOST=127.0.0.1 VITE_BACKEND_HTTP_URL=http://127.0.0.1:4273 \
VITE_BACKEND_WS_URL=ws://127.0.0.1:4273/ws \
pnpm --dir packages/web exec vite --host 127.0.0.1 --port 5273
```

```bash
pnpm --dir e2e exec node --input-type=module - <<'EOF'
import { chromium } from '@playwright/test';
import path from 'node:path';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1400 } });
const outDir = path.resolve('../e2e/test-results');
await page.goto('http://127.0.0.1:5273/analytics', { waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: '运行基础分析' }).click();
await page.getByRole('tablist', { name: '工作分析分区' }).waitFor({ state: 'visible', timeout: 180000 });
await page.screenshot({ path: path.join(outDir, 'work-analytics-real-overview.png'), fullPage: true });
for (const [label, file] of [['对比', 'work-analytics-real-compare.png'], ['产出', 'work-analytics-real-yield.png'], ['预算', 'work-analytics-real-budgets.png']]) {
  await page.getByRole('tab', { name: label }).click();
  await page.waitForTimeout(900);
  await page.screenshot({ path: path.join(outDir, file), fullPage: true });
}
await browser.close();
EOF
```

- [ ] **Step 4: Verify the screenshots and branch state**

Run: `file e2e/test-results/work-analytics-real-*.png && git status -sb`

Expected: PNG files exist and branch contains only intended changes plus known local untracked files.

- [ ] **Step 5: Commit**

```bash
git add .
git reset AGENTS.md AGENTS.override.md CLAUDE.local.md GEMINI.md docs/superpowers/plans/2026-06-04-workspace-history.md
git commit -m "chore: verify work analysis foundation alignment"
```

## Self-Review

### Spec Coverage

- canonical event model: Task 1
- derived metrics layer: Tasks 2 and 3
- materialized analytics contract: Tasks 2 and 3 via analyzer/service/schema updates
- overview / compare / efficiency / yield / budgets surface: Tasks 4 and 5
- settings launcher and acceptance continuity: Task 6
- real-log validation and screenshots: Task 7

No spec requirement is currently uncovered.

### Placeholder Scan

- No `TBD`, `TODO`, or deferred implementation placeholders remain.
- Every task includes concrete files, commands, and at least one representative code block.

### Type Consistency

- `activity.daily`, `compare.workspaces`, `efficiency`, `yield.lowYieldSessions`, and `budgets.forecast30d` are used consistently across server and web tasks.
- Canonical event terminology is consistent across provider parsing, metrics, and analyzer steps.


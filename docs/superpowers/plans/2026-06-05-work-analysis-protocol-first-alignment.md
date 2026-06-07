# Work Analysis Protocol-First Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a backend-first V2 work-analysis snapshot contract and migrate the analytics UI to consume domain-oriented snapshot data while preserving the current basic analysis workflow.

**Architecture:** Keep `WorkBasicAnalysisResult` as the transport envelope for this round, add a `snapshotV2` domain contract inside it, and derive V2 from the same normalized session/event inputs already used by `basic-analyzer`. Update the web analytics page to prefer `snapshotV2` domains for overview, breakdown, sessions, efficiency, optimize, delivery, capabilities, and data-source rendering, while retaining legacy fallbacks until the old fields can be deleted safely.

**Tech Stack:** TypeScript, Zod, Vitest, React, Jotai, pnpm

---

## File Map

- Modify: `packages/server/src/work-analysis/types.ts`
  Responsibility: define V2 domain snapshot interfaces and attach them to `WorkBasicAnalysisResult`.
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
  Responsibility: validate the new `snapshotV2` contract shape.
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
  Responsibility: derive `snapshotV2` domains from collected sessions and keep legacy fields populated.
- Modify: `packages/server/src/work-analysis/exporters/basic-export.ts`
  Responsibility: ensure exported basic analysis includes V2 payload without special handling regressions.
- Modify: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
  Responsibility: cover V2 domain derivation on analyzer output.
- Modify: `packages/server/src/__tests__/work-analysis-service.test.ts`
  Responsibility: cover service-level propagation of `snapshotV2`.
- Modify: `packages/web/src/features/work-analysis/types.ts`
  Responsibility: mirror the server-side V2 contract in the web client types.
- Modify: `packages/web/src/features/work-analysis/page.tsx`
  Responsibility: read V2 domains first, then fall back to legacy fields.
- Modify: `packages/web/src/features/work-analysis/page.test.tsx`
  Responsibility: cover V2-first rendering paths and fallback behavior.

### Task 1: Add The V2 Snapshot Contract

**Files:**
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
- Modify: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`

- [ ] **Step 1: Write the failing analyzer contract test**

```ts
it("builds snapshotV2 domains from basic analysis inputs", () => {
  const result = analyzeWorkBasic({
    query: { timeRange: { preset: "7d" }, workspacePaths: ["/repo/app"] },
    timeRange: { startAt: 1, endAt: 2, label: "Last 7 days" },
    availableWorkspacePaths: ["/repo/app", "/repo/lib"],
    sessions: [buildSessionFixture()],
    dataSources: {
      providers: [
        {
          providerId: "codex",
          status: "supported",
          sessionCount: 1,
          parseErrorCount: 0,
          warningCount: 0,
        },
      ],
    },
    skillInventory: { installedSkills: [], mounts: [] },
  });

  expect(result.snapshotV2?.version).toBe(2);
  expect(result.snapshotV2?.query.availableWorkspacePaths).toEqual(["/repo/app", "/repo/lib"]);
  expect(result.snapshotV2?.overview.totals.totalTokens).toBe(175);
  expect(result.snapshotV2?.breakdowns.byWorkspace[0]?.label).toBe("/repo/app");
  expect(result.snapshotV2?.sessions.featured.topByTotalTokens[0]?.sessionId).toBe("session-1");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts -t "builds snapshotV2 domains from basic analysis inputs"`
Expected: FAIL with `snapshotV2` missing from `WorkBasicAnalysisResult`

- [ ] **Step 3: Add V2 types in the server contract**

```ts
export interface WorkBasicAnalysisResultV2 {
  version: 2;
  query: {
    timeRangeLabel: string;
    selectedWorkspacePaths: string[];
    availableWorkspacePaths: string[];
  };
  overview: WorkAnalysisOverviewDomain;
  breakdowns: WorkAnalysisBreakdownsDomain;
  sessions: WorkAnalysisSessionsDomain;
  efficiency: WorkAnalysisEfficiencyDomain;
  optimize: WorkAnalysisOptimizeDomain;
  delivery: WorkAnalysisDeliveryDomain;
  capabilities: WorkAnalysisCapabilitiesDomain;
  dataSources: WorkAnalysisDataSourcesDomain;
  exports: WorkAnalysisExportsDomain;
}

export interface WorkBasicAnalysisResult {
  availableWorkspacePaths: string[];
  snapshotV2?: WorkBasicAnalysisResultV2;
  // existing legacy fields remain in place during migration
}
```

- [ ] **Step 4: Extend the Zod schema for `snapshotV2`**

```ts
const snapshotV2Schema = z.object({
  version: z.literal(2),
  query: z.object({
    timeRangeLabel: z.string(),
    selectedWorkspacePaths: z.array(z.string()),
    availableWorkspacePaths: z.array(z.string()),
  }),
  overview: overviewDomainSchema,
  breakdowns: breakdownsDomainSchema,
  sessions: sessionsDomainSchema,
  efficiency: efficiencyDomainSchema,
  optimize: optimizeDomainSchema,
  delivery: deliveryDomainSchema,
  capabilities: capabilitiesDomainSchema,
  dataSources: dataSourcesDomainSchema,
  exports: exportsDomainSchema,
});

export const workBasicAnalysisResultSchema = z.object({
  availableWorkspacePaths: z.array(z.string()),
  snapshotV2: snapshotV2Schema.optional(),
  // existing legacy schema continues below
});
```

- [ ] **Step 5: Run the analyzer test to verify it now reaches implementation failure**

Run: `pnpm vitest packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts -t "builds snapshotV2 domains from basic analysis inputs"`
Expected: FAIL on `snapshotV2` assertions rather than schema/type errors

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/work-analysis/types.ts packages/server/src/work-analysis/basic-schema.ts packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts docs/superpowers/plans/2026-06-05-work-analysis-protocol-first-alignment.md
git commit -m "test: define work analysis snapshot v2 contract"
```

### Task 2: Derive V2 Domains In The Analyzer And Service

**Files:**
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
- Modify: `packages/server/src/work-analysis/exporters/basic-export.ts`
- Modify: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
- Modify: `packages/server/src/__tests__/work-analysis-service.test.ts`

- [ ] **Step 1: Add failing analyzer and service expectations for populated V2 domains**

```ts
expect(result.snapshotV2?.overview.activity.byDay[0]).toMatchObject({
  day: "2026-06-01",
  sessionCount: 1,
});
expect(result.snapshotV2?.delivery.budgets.forecast30d).toBe(0);
expect(result.snapshotV2?.capabilities.providers[0]?.providerId).toBe("codex");
expect(serviceResult.basicResult?.snapshotV2?.dataSources.providers[0]?.status).toBe("supported");
```

- [ ] **Step 2: Run the focused server tests and confirm failure**

Run: `pnpm vitest packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-service.test.ts`
Expected: FAIL because `snapshotV2` is absent or incomplete

- [ ] **Step 3: Implement V2 derivation in `basic-analyzer.ts`**

```ts
const snapshotV2 = {
  version: 2 as const,
  query: {
    timeRangeLabel: input.timeRange.label,
    selectedWorkspacePaths: input.query.workspacePaths ?? [],
    availableWorkspacePaths: [...input.availableWorkspacePaths],
  },
  overview: buildOverviewDomain(...),
  breakdowns: buildBreakdownsDomain(...),
  sessions: buildSessionsDomain(...),
  efficiency: buildEfficiencyDomain(...),
  optimize: buildOptimizeDomain(...),
  delivery: buildDeliveryDomain(...),
  capabilities: buildCapabilitiesDomain(...),
  dataSources: buildDataSourcesDomain(...),
  exports: { artifactFormats: ["json", "csv"] },
};

return workBasicAnalysisResultSchema.parse({
  availableWorkspacePaths: [...input.availableWorkspacePaths],
  snapshotV2,
  // existing legacy payload remains populated here
});
```

- [ ] **Step 4: Keep exporter and service behavior aligned**

```ts
export function buildBasicAnalysisExports(result: WorkBasicAnalysisResult, generatedAt: number) {
  const payload = {
    version: 1 as const,
    exportedAt: generatedAt,
    result,
  };

  return {
    generatedAt,
    artifacts: [
      buildJsonArtifact(payload),
      buildCsvArtifact(result.snapshotV2 ?? result),
    ],
  };
}
```

- [ ] **Step 5: Run focused server tests to verify pass**

Run: `pnpm vitest packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-service.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/server/src/work-analysis/basic-analyzer.ts packages/server/src/work-analysis/exporters/basic-export.ts packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-service.test.ts
git commit -m "feat: derive work analysis snapshot v2 domains"
```

### Task 3: Migrate The Analytics Page To V2-First Consumption

**Files:**
- Modify: `packages/web/src/features/work-analysis/types.ts`
- Modify: `packages/web/src/features/work-analysis/page.tsx`
- Modify: `packages/web/src/features/work-analysis/page.test.tsx`

- [ ] **Step 1: Add a failing page test for V2-first rendering**

```tsx
it("prefers snapshotV2 domain data when present", async () => {
  renderWorkAnalyticsPage({
    basicResult: {
      availableWorkspacePaths: ["/repo/project", "/repo/lib"],
      snapshotV2: {
        version: 2,
        query: {
          timeRangeLabel: "Last 7 days",
          selectedWorkspacePaths: ["/repo/project"],
          availableWorkspacePaths: ["/repo/project", "/repo/lib"],
        },
        overview: {
          totals: { totalTokens: 9148820, inputTokens: 1, outputTokens: 1, cachedInputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0, reasoningOutputTokens: 0, sessionCount: 397, workspaceCount: 4, providerCount: 2, taskTypeCount: 6 },
          activity: { totalDurationMs: 1, averageDurationMs: 1, byDay: [], byHour: [] },
          shares: { topDimension: "workspace", items: [] },
          coverage: { sessionCount: 397, workspaceCount: 4, providerCount: 2, timeRangeLabel: "Last 7 days" },
        },
        breakdowns: { byWorkspace: [], byProvider: [], byModel: [], byTask: [], byTool: [], byCommand: [] },
        sessions: { featured: { topByTotalTokens: [], topByOutputTokens: [], lowYield: [], longest: [], latest: [] } },
        efficiency: { overall: { sessionCount: 397, averageTokensPerSession: 23045, averageInputTokensPerSession: 0, averageOutputTokensPerSession: 0, averageTokensPerToolUse: 0, commandSessionRate: 0, cacheParticipationRate: 0, editSignalCoverageRate: 0, highTokenSessionRate: 0, toolHeavySessionCount: 0, oneShotRate: 0, retryRate: 0, selfCorrectionRate: 0, readToEditRatio: 0, commandToEditRatio: 0, cacheHitShare: 0, gitAwareSessionRate: 0 }, byProvider: [], byTask: [] },
        optimize: { totalFindings: 0, totalEstimatedWastedTokens: 0, findings: [] },
        delivery: { yield: { sessionCount: 0, shippedSessionCount: 0, shippedSessionRate: 0, editSessionCount: 0, commandSessionCount: 0, gitSessionCount: 0, artifactSessionCount: 0, shippedTokens: 0, shippedTokenShare: 0, averageTokensPerShippedSession: 0, averageTokensPerNonShippedSession: 0, outputToInputRatio: 0, artifactSignalPerThousandTokens: 0, gitAwareSessionRate: 0 }, budgets: { thresholds: [], forecast30d: 0, totalTokens: 9148820 } },
        capabilities: { providers: [], skillInventory: { installedCount: 0, mountedCount: 0, unmountedCount: 0 } },
        dataSources: { providers: [] },
        exports: { artifactFormats: ["json", "csv"] },
      },
    },
  });

  expect(await screen.findByText(/9,148,820/i)).toBeInTheDocument();
  expect(screen.getByText("/repo/lib")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the page test and verify it fails**

Run: `pnpm vitest packages/web/src/features/work-analysis/page.test.tsx -t "prefers snapshotV2 domain data when present"`
Expected: FAIL because the page only reads legacy fields

- [ ] **Step 3: Add web-side V2 types and page selectors**

```ts
const snapshotV2 = basicResult?.snapshotV2;
const overview = snapshotV2?.overview;
const breakdowns = snapshotV2?.breakdowns;
const delivery = snapshotV2?.delivery;
const sessions = snapshotV2?.sessions;
const capabilities = snapshotV2?.capabilities;
const dataSources = snapshotV2?.dataSources;

const availableWorkspacePaths =
  snapshotV2?.query.availableWorkspacePaths ?? basicResult?.availableWorkspacePaths ?? [];
const compareWorkspaces =
  breakdowns?.byWorkspace.map(toWorkspaceRankingEntry) ??
  legacyCompareWorkspaces;
const topTokenSessions =
  sessions?.featured.topByTotalTokens ?? basicResult?.usage?.topSessionsByTotalTokens ?? [];
```

- [ ] **Step 4: Keep compatibility fallback paths intact**

```ts
const totalTokens =
  overview?.totals.totalTokens ?? basicResult?.usage?.totals?.totalTokens ?? 0;
const yieldSummary = delivery?.yield ?? basicResult?.yield;
const budgets = delivery?.budgets ?? basicResult?.budgets;
const providerCapabilities = capabilities?.providers ?? basicResult?.capabilityMatrix?.providers ?? [];
const providerSources = dataSources?.providers ?? basicResult?.dataSources?.providers ?? [];
```

- [ ] **Step 5: Run focused web tests to verify pass**

Run: `pnpm vitest packages/web/src/features/work-analysis/page.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/work-analysis/types.ts packages/web/src/features/work-analysis/page.tsx packages/web/src/features/work-analysis/page.test.tsx
git commit -m "feat: consume work analysis snapshot v2 in analytics page"
```

### Task 4: Focused Verification And Real-Data Validation

**Files:**
- Modify as needed: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
- Modify as needed: `packages/web/src/features/work-analysis/page.test.tsx`

- [ ] **Step 1: Run focused automated verification**

Run: `pnpm vitest packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/server/src/__tests__/work-analysis-service.test.ts packages/web/src/features/work-analysis/page.test.tsx`
Expected: PASS

- [ ] **Step 2: Run broader repository checks that are relevant to the touched surface**

Run: `pnpm ci:test -- --runInBand`
Expected: PASS for touched areas, or document unrelated pre-existing failures clearly if repo debt blocks full green

- [ ] **Step 3: Run the app against real local logs and verify V2 data appears**

```bash
pnpm dev
```

Expected:
- workspace filter lists all discovered log workspaces, not just opened workspaces
- overview token totals reflect real logs
- rankings show real provider/workspace/task splits
- top sessions and token-focused cards render from V2 domains

- [ ] **Step 4: Capture acceptance screenshots after real-data validation**

Run: `pnpm exec playwright test e2e/specs/settings/analysis.spec.ts --project=chromium`
Expected: PASS, with updated screenshots showing the full analytics page sections instead of a cropped single viewport

- [ ] **Step 5: Commit verification-only follow-ups if needed**

```bash
git add packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts packages/web/src/features/work-analysis/page.test.tsx
git commit -m "test: cover work analysis snapshot v2 verification"
```

## Self-Review

- Spec coverage:
  - unified V2 snapshot contract: Task 1
  - backend domain derivation: Task 2
  - frontend domain-based consumption: Task 3
  - verification and real-data validation: Task 4
- Placeholder scan:
  - No `TODO` or deferred implementation placeholders left in tasks.
- Type consistency:
  - `snapshotV2`, `overview`, `breakdowns`, `sessions`, `delivery`, `capabilities`, `dataSources`, and `exports` are named consistently across server and web tasks.

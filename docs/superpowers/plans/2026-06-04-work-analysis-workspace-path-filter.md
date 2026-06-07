# Work Analysis Workspace Path Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign work analysis so provider logs are scanned by time range first, all discovered `workspacePath` values become selectable result filters, and opened workspaces are no longer a prerequisite.

**Architecture:** Rewrite the work-analysis query model from `workspaceIds` to optional `workspacePaths`, remove discover-time workspace whitelists from provider log collection, and shift path filtering into `WorkAnalysisService` after provider sessions are collected. Update analyzer/result types to expose `availableWorkspacePaths`, then rebuild the settings UI around result-driven path multi-select with default-all behavior.

**Tech Stack:** TypeScript, Vitest, Playwright, React, Jotai, Zod

---

### Task 1: Rewrite Work Analysis Query Types And Command Schema

**Files:**
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/commands/work-analysis.ts`
- Modify: `packages/server/src/work-analysis/query.ts`
- Modify: `packages/server/src/__tests__/work-analysis-commands.test.ts`
- Test: `packages/server/src/__tests__/work-analysis-query.test.ts`

- [ ] **Step 1: Write the failing query helper test for path-based input**

```ts
it("normalizes workspacePaths instead of workspaceIds", () => {
  expect(
    normalizeWorkAnalysisQuery({
      workspacePaths: ["/repo/b", "/repo/a", "/repo/a"],
      timeRange: { preset: "7d" },
    })
  ).toEqual({
    workspacePaths: ["/repo/a", "/repo/b"],
    timeRange: { preset: "7d" },
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-query.test.ts`
Expected: FAIL because `workspacePaths` is not part of the query type or normalization result.

- [ ] **Step 3: Write the failing command schema test**

```ts
it("dispatches work.analysis.runBasic with workspacePaths", async () => {
  const ctx = {
    workAnalysisService: {
      runBasic: vi.fn().mockResolvedValue({ ok: true }),
    },
  };

  const result = await dispatchCommand({
    op: "work.analysis.runBasic",
    args: {
      workspacePaths: ["/repo/a"],
      timeRange: { preset: "7d" },
    },
    ctx,
  });

  expect(ctx.workAnalysisService.runBasic).toHaveBeenCalledWith({
    workspacePaths: ["/repo/a"],
    timeRange: { preset: "7d" },
  });
  expect(result).toEqual({ ok: true });
});
```

- [ ] **Step 4: Run command test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-commands.test.ts`
Expected: FAIL because schema still requires `workspaceIds`.

- [ ] **Step 5: Implement the minimal query/type rewrite**

```ts
export interface WorkAnalysisQuery {
  workspacePaths?: string[];
  timeRange: WorkAnalysisTimeRange;
}

export function normalizeWorkAnalysisQuery(input: WorkAnalysisQuery): WorkAnalysisQuery {
  const workspacePaths = input.workspacePaths
    ? [...new Set(input.workspacePaths)].sort((left, right) => left.localeCompare(right))
    : undefined;

  return {
    ...(workspacePaths && workspacePaths.length > 0 ? { workspacePaths } : {}),
    timeRange: "preset" in input.timeRange ? input.timeRange : { ...input.timeRange },
  };
}
```

- [ ] **Step 6: Update the command schema**

```ts
const workAnalysisQuerySchema = z.object({
  workspacePaths: z.array(z.string().trim().min(1)).optional(),
  timeRange: z.union([
    z.object({ preset: z.enum(["24h", "7d", "30d", "90d"]) }),
    z.object({ startAt: z.number(), endAt: z.number() }),
  ]),
});
```

- [ ] **Step 7: Run focused server tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-query.test.ts src/__tests__/work-analysis-commands.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/server/src/work-analysis/types.ts \
  packages/server/src/work-analysis/query.ts \
  packages/server/src/commands/work-analysis.ts \
  packages/server/src/__tests__/work-analysis-query.test.ts \
  packages/server/src/__tests__/work-analysis-commands.test.ts
git commit -m "refactor: switch work analysis queries to workspace paths"
```

### Task 2: Remove Discover-Time Workspace Whitelists From Provider Collection

**Files:**
- Modify: `packages/server/src/work-analysis/log-sources/types.ts`
- Modify: `packages/server/src/work-analysis/log-sources/collector.ts`
- Modify: `packages/server/src/work-analysis/log-sources/codex.ts`
- Modify: `packages/server/src/work-analysis/log-sources/claude.ts`
- Modify: `packages/server/src/work-analysis/log-sources/gemini.ts`
- Modify: `packages/server/src/work-analysis/log-sources/cursor.ts`
- Modify: `packages/server/src/work-analysis/log-sources/opencode.ts`
- Modify: `packages/server/src/__tests__/work-analysis-log-collector.test.ts`
- Modify: `packages/server/src/__tests__/work-analysis-log-sources-file-adapters.test.ts`
- Modify: `packages/server/src/__tests__/work-analysis-log-source-opencode.test.ts`

- [ ] **Step 1: Write the failing collector test for all discovered paths**

```ts
it("collects sessions without a workspace path allowlist", async () => {
  const source = {
    providerId: "codex",
    discover: vi.fn().mockResolvedValue({
      providerId: "codex",
      status: "supported",
      sessions: [
        { providerId: "codex", sessionId: "s1", workspacePath: "/repo/a", startedAt: 1, lastActiveAt: 2, sourceRef: "a", userTurnCount: 0, assistantTurnCount: 0, toolUseCount: 0, parseErrorCount: 0, timestampQuality: "explicit" },
        { providerId: "codex", sessionId: "s2", workspacePath: "/repo/b", startedAt: 3, lastActiveAt: 4, sourceRef: "b", userTurnCount: 0, assistantTurnCount: 0, toolUseCount: 0, parseErrorCount: 0, timestampQuality: "explicit" },
      ],
      sourceRefs: [],
      parseErrorCount: 0,
      warnings: [],
    }),
  };

  const collector = createWorkLogCollector({ sources: [source as ProviderWorkLogSource] });
  const result = await collector({ timeRange: { startAt: 0, endAt: 10, label: "7d" } });

  expect(result.sessions.map((session) => session.workspacePath)).toEqual(["/repo/a", "/repo/b"]);
});
```

- [ ] **Step 2: Run collector test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-collector.test.ts`
Expected: FAIL because collector and source input still require `workspacePaths`.

- [ ] **Step 3: Rewrite source discover input to time-range only**

```ts
export interface ProviderWorkLogDiscoverInput {
  timeRange: ResolvedWorkAnalysisTimeRange;
}
```

- [ ] **Step 4: Remove workspace allowlist checks from adapters**

```ts
const workspacePath = metadata?.payload?.cwd ?? metadata?.cwd;
if (!workspacePath) {
  return;
}

sessions.push({
  providerId: "codex",
  sessionId,
  workspacePath,
  startedAt,
  lastActiveAt,
  sourceRef,
  userTurnCount,
  assistantTurnCount,
  toolUseCount,
  parseErrorCount,
  timestampQuality,
});
```

- [ ] **Step 5: Update adapter tests to expect sessions from non-opened paths**

```ts
expect(discovery.sessions.map((session) => session.workspacePath)).toContain("/repo/not-opened");
```

- [ ] **Step 6: Run provider collection tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-log-collector.test.ts src/__tests__/work-analysis-log-sources-file-adapters.test.ts src/__tests__/work-analysis-log-source-opencode.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/work-analysis/log-sources/types.ts \
  packages/server/src/work-analysis/log-sources/collector.ts \
  packages/server/src/work-analysis/log-sources/codex.ts \
  packages/server/src/work-analysis/log-sources/claude.ts \
  packages/server/src/work-analysis/log-sources/gemini.ts \
  packages/server/src/work-analysis/log-sources/cursor.ts \
  packages/server/src/work-analysis/log-sources/opencode.ts \
  packages/server/src/__tests__/work-analysis-log-collector.test.ts \
  packages/server/src/__tests__/work-analysis-log-sources-file-adapters.test.ts \
  packages/server/src/__tests__/work-analysis-log-source-opencode.test.ts
git commit -m "refactor: collect provider work logs without workspace prefilter"
```

### Task 3: Move Workspace Path Filtering Into WorkAnalysisService And Analyzer

**Files:**
- Modify: `packages/server/src/work-analysis/service.ts`
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/storage/repositories/work-analysis-repo.ts`
- Modify: `packages/server/src/__tests__/work-analysis-service.test.ts`
- Modify: `packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts`
- Modify: `packages/server/src/__tests__/work-analysis-repo.test.ts`

- [ ] **Step 1: Write the failing service test for result-level path filtering**

```ts
it("filters collected sessions by workspacePaths after discovery", async () => {
  const collector = vi.fn().mockResolvedValue({
    sessions: [
      { providerId: "codex", sessionId: "a", workspacePath: "/repo/a", startedAt: 1, lastActiveAt: 2, sourceRef: "a", userTurnCount: 1, assistantTurnCount: 1, toolUseCount: 0, parseErrorCount: 0, timestampQuality: "explicit" },
      { providerId: "codex", sessionId: "b", workspacePath: "/repo/b", startedAt: 3, lastActiveAt: 4, sourceRef: "b", userTurnCount: 1, assistantTurnCount: 1, toolUseCount: 0, parseErrorCount: 0, timestampQuality: "explicit" },
    ],
    providers: [],
  });

  const service = buildService({ collector });
  const result = await service.runBasic({ workspacePaths: ["/repo/b"], timeRange: { preset: "7d" } });

  expect(result.basicResult?.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
  expect(result.basicResult?.workSurface.workspacePaths).toEqual(["/repo/b"]);
});
```

- [ ] **Step 2: Run service test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-service.test.ts`
Expected: FAIL because service still resolves `workspaceIds` and analyzer still emits workspace ids.

- [ ] **Step 3: Write the failing analyzer test for path semantics**

```ts
it("emits workspacePaths and availableWorkspacePaths", () => {
  const result = analyzeWorkLogs({
    query: { workspacePaths: ["/repo/b"], timeRange: { preset: "7d" } },
    sessions: [sessionA, sessionB],
    availableWorkspacePaths: ["/repo/a", "/repo/b"],
    dataSources: { providers: [] },
  });

  expect(result.availableWorkspacePaths).toEqual(["/repo/a", "/repo/b"]);
  expect(result.workSurface.workspacePaths).toEqual(["/repo/b"]);
});
```

- [ ] **Step 4: Run analyzer test to verify it fails**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-basic-analyzer.test.ts`
Expected: FAIL because result types still expose `workspaceIds`.

- [ ] **Step 5: Implement service-level path filtering**

```ts
const availableWorkspacePaths = [...new Set(collection.sessions.map((session) => session.workspacePath))]
  .sort((left, right) => left.localeCompare(right));

const filteredSessions =
  normalized.workspacePaths && normalized.workspacePaths.length > 0
    ? collection.sessions.filter((session) => normalized.workspacePaths!.includes(session.workspacePath))
    : collection.sessions;
```

- [ ] **Step 6: Rewrite analyzer result shape**

```ts
return workBasicAnalysisResultSchema.parse({
  availableWorkspacePaths: [...input.availableWorkspacePaths],
  workSurface: {
    workspacePaths:
      input.query.workspacePaths && input.query.workspacePaths.length > 0
        ? [...input.query.workspacePaths]
        : [...input.availableWorkspacePaths],
  },
  // existing summary fields...
});
```

- [ ] **Step 7: Update repo normalization for the new result shape**

```ts
...(record.basicResult === undefined
  ? {}
  : {
      basicResult: {
        ...record.basicResult,
        availableWorkspacePaths: [...record.basicResult.availableWorkspacePaths],
        workSurface: {
          workspacePaths: [...record.basicResult.workSurface.workspacePaths],
        },
      },
    }),
```

- [ ] **Step 8: Run focused server tests to verify they pass**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-service.test.ts src/__tests__/work-analysis-basic-analyzer.test.ts src/__tests__/work-analysis-repo.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add packages/server/src/work-analysis/service.ts \
  packages/server/src/work-analysis/basic-analyzer.ts \
  packages/server/src/work-analysis/basic-schema.ts \
  packages/server/src/work-analysis/types.ts \
  packages/server/src/storage/repositories/work-analysis-repo.ts \
  packages/server/src/__tests__/work-analysis-service.test.ts \
  packages/server/src/__tests__/work-analysis-basic-analyzer.test.ts \
  packages/server/src/__tests__/work-analysis-repo.test.ts
git commit -m "refactor: filter work analysis by discovered workspace paths"
```

### Task 4: Rebuild Settings UI Around Result-Driven Path Multi-Select

**Files:**
- Modify: `packages/web/src/features/work-analysis/types.ts`
- Modify: `packages/web/src/features/settings/components/session-analysis-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing settings-page test for initial unfiltered request**

```ts
it("requests work analysis without workspaceIds on first load", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "settings.get") return {};
    if (op === "provider.list") return DEFAULT_PROVIDER_LIST;
    if (op === "work.analysis.get") {
      return {
        id: "analysis-1",
        queryDigest: "digest-1",
        workspacePaths: undefined,
        timeRange: { preset: "7d" },
        basicStatus: "succeeded",
        deepStatus: "idle",
        basicResult: {
          availableWorkspacePaths: ["/repo/a", "/repo/b"],
          // remaining required summary fields...
        },
      };
    }
    return {};
  });

  renderSettingsPage(createConnectedStore(sendCommand), { initialEntry: "/settings?section=analysis" });

  await waitFor(() => {
    expect(sendCommand).toHaveBeenCalledWith(
      "work.analysis.get",
      { timeRange: { preset: "7d" } },
      undefined
    );
  });
});
```

- [ ] **Step 2: Run settings test to verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx --testNamePattern "without workspaceIds on first load"`
Expected: FAIL because UI still sends `workspaceIds`.

- [ ] **Step 3: Write the failing settings-page test for result-driven path options**

```ts
it("renders workspace path filters from analysis results and re-queries with selected paths", async () => {
  const sendCommand = vi.fn().mockImplementation(async (op: string) => {
    if (op === "settings.get") return {};
    if (op === "provider.list") return DEFAULT_PROVIDER_LIST;
    if (op === "work.analysis.get") {
      return {
        id: "analysis-1",
        queryDigest: "digest-1",
        timeRange: { preset: "7d" },
        basicStatus: "succeeded",
        deepStatus: "idle",
        basicResult: {
          availableWorkspacePaths: ["/repo/a", "/repo/b"],
          // remaining required summary fields...
        },
      };
    }
    return {};
  });

  renderSettingsPage(createConnectedStore(sendCommand), { initialEntry: "/settings?section=analysis" });

  expect(await screen.findByText("/repo/a")).toBeInTheDocument();
  expect(screen.getByText("/repo/b")).toBeInTheDocument();

  fireEvent.click(screen.getByLabelText("/repo/a"));

  await waitFor(() => {
    expect(sendCommand).toHaveBeenLastCalledWith(
      "work.analysis.get",
      { workspacePaths: ["/repo/b"], timeRange: { preset: "7d" } },
      undefined
    );
  });
});
```

- [ ] **Step 4: Run the focused UI test to verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx --testNamePattern "renders workspace path filters from analysis results"`
Expected: FAIL because UI still renders `orderedWorkspaces`.

- [ ] **Step 5: Rewrite the work-analysis client types**

```ts
export interface WorkBasicAnalysisResult {
  availableWorkspacePaths: string[];
  workSurface: {
    workspacePaths: string[];
  };
  // existing fields...
}
```

- [ ] **Step 6: Rewrite settings state around result-driven paths**

```tsx
const [selectedWorkspacePaths, setSelectedWorkspacePaths] = useState<string[]>([]);
const [hasCustomizedWorkspacePaths, setHasCustomizedWorkspacePaths] = useState(false);

const query = useMemo(() => {
  if (!timeRange) {
    return null;
  }

  return selectedWorkspacePaths.length > 0 && hasCustomizedWorkspacePaths
    ? { workspacePaths: selectedWorkspacePaths, timeRange }
    : { timeRange };
}, [hasCustomizedWorkspacePaths, selectedWorkspacePaths, timeRange]);
```

- [ ] **Step 7: Populate path filters from analysis result and default to all**

```tsx
useEffect(() => {
  const availableWorkspacePaths = analysis?.basicResult?.availableWorkspacePaths ?? [];
  if (hasCustomizedWorkspacePaths || availableWorkspacePaths.length === 0) {
    return;
  }
  setSelectedWorkspacePaths(availableWorkspacePaths);
}, [analysis, hasCustomizedWorkspacePaths]);
```

- [ ] **Step 8: Update path filter copy**

```json
"workspace": "Workspace Paths",
"empty_workspace_paths": "No provider log directories were found for the selected time range."
```

- [ ] **Step 9: Run the full settings-page test file**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add packages/web/src/features/work-analysis/types.ts \
  packages/web/src/features/settings/components/session-analysis-settings.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: filter work analysis by discovered workspace paths"
```

### Task 5: Add End-To-End Coverage For Undiscovered-By-App Workspaces

**Files:**
- Modify: `e2e/fixtures/phase2-i18n.ts`
- Create: `e2e/fixtures/seed-work-analysis-settings-db.ts`
- Modify: `e2e/specs/settings/analysis.spec.ts`

- [ ] **Step 1: Write the failing e2e assertion for multiple discovered paths**

```ts
await expect(page.getByText("/tmp/path-a")).toBeVisible();
await expect(page.getByText("/tmp/path-b")).toBeVisible();
```

- [ ] **Step 2: Run the Playwright spec to verify it fails**

Run: `pnpm --dir e2e exec playwright test specs/settings/analysis.spec.ts --config playwright.config.ts`
Expected: FAIL because the seed and UI only expose the currently opened workspace path.

- [ ] **Step 3: Update the seed to write two provider-log-discovered paths**

```ts
workAnalysisRepo.upsert({
  // ...
  basicResult: {
    availableWorkspacePaths: ["/tmp/path-a", "/tmp/path-b"],
    workSurface: { workspacePaths: ["/tmp/path-a", "/tmp/path-b"] },
    // remaining required fields...
  },
});
```

- [ ] **Step 4: Extend the e2e flow to narrow to a single path**

```ts
await page.getByLabel("/tmp/path-a").uncheck();
await expect(
  page.getByText(
    translatePatternForE2E("settings.analysis.log_coverage_summary", {
      workspaceCount: "1",
      sessionCount: "1",
      providerCount: "1",
    })
  )
).toBeVisible();
```

- [ ] **Step 5: Re-run the Playwright spec to verify it passes**

Run: `pnpm --dir e2e exec playwright test specs/settings/analysis.spec.ts --config playwright.config.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add e2e/fixtures/phase2-i18n.ts \
  e2e/fixtures/seed-work-analysis-settings-db.ts \
  e2e/specs/settings/analysis.spec.ts
git commit -m "test: cover work analysis path filtering in settings e2e"
```

### Task 6: Run Final Verification

**Files:**
- Modify: none
- Test: `packages/server/src/__tests__/work-analysis-*.test.ts`
- Test: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Test: `e2e/specs/settings/analysis.spec.ts`

- [ ] **Step 1: Run focused server regression**

Run: `pnpm --filter @coder-studio/server exec vitest run src/__tests__/work-analysis-query.test.ts src/__tests__/work-analysis-commands.test.ts src/__tests__/work-analysis-log-collector.test.ts src/__tests__/work-analysis-log-sources-file-adapters.test.ts src/__tests__/work-analysis-log-source-opencode.test.ts src/__tests__/work-analysis-basic-analyzer.test.ts src/__tests__/work-analysis-service.test.ts src/__tests__/work-analysis-repo.test.ts`
Expected: PASS

- [ ] **Step 2: Run server typecheck**

Run: `pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit`
Expected: PASS

- [ ] **Step 3: Run focused web regression**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx`
Expected: PASS

- [ ] **Step 4: Run the settings analysis Playwright spec**

Run: `pnpm --dir e2e exec playwright test specs/settings/analysis.spec.ts --config playwright.config.ts`
Expected: PASS

- [ ] **Step 5: Commit any final test-only adjustments**

```bash
git add -A
git commit -m "test: finalize work analysis workspace path filter coverage"
```

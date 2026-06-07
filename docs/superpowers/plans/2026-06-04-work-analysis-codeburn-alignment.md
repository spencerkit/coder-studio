# Work Analysis CodeBurn Alignment Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `工作分析` 基础分析 so it aligns with CodeBurn-style local usage analytics: token aggregation, cost estimation, provider/model/workspace breakdowns, and dashboard-grade presentation.

**Spec reference:** `docs/superpowers/specs/2026-06-04-work-analysis-codeburn-alignment-design.md`

**Architecture:** Introduce a normalized provider usage schema, add a provider capability matrix, implement Codex and Claude token extraction first, expand the basic analysis result model to include usage and rankings, then rebuild the frontend as a dashboard instead of a settings-style summary block.

**Tech Stack:** TypeScript, Vitest, Playwright, React, Jotai, Zod

---

### Task 1: Audit Provider Usage Capability And Lock A V1 Support Matrix

**Files:**
- Add: `docs/superpowers/research/2026-06-04-work-analysis-provider-usage-capability-matrix.md`
- Add tests/fixtures as discovered
- Modify if needed: provider adapter tests under `packages/server/src/__tests__/`

- [ ] **Step 1: Inspect real and fixture-backed provider log shapes**

Audit these adapters:

- `codex`
- `claude`
- `gemini`
- `cursor`
- `opencode`

Record for each provider:

- workspace path availability
- timestamp quality
- model identity availability
- token usage availability
- cache usage availability
- reasoning usage availability
- cost-estimation feasibility

- [ ] **Step 2: Write the research matrix document**

The output must explicitly classify each capability as:

- `full`
- `partial`
- `none`

- [ ] **Step 3: Add or update focused tests that capture any newly discovered usage fields**

Do not implement product code yet. This task is to freeze scope and verify field presence.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/research/2026-06-04-work-analysis-provider-usage-capability-matrix.md \
  packages/server/src/__tests__
git commit -m "docs: audit provider usage capability for work analysis"
```

### Task 2: Introduce A Normalized Usage Schema In Work Log Sessions

**Files:**
- Modify: `packages/server/src/work-analysis/log-sources/types.ts`
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: provider adapters as needed
- Add tests under `packages/server/src/__tests__/`

- [ ] **Step 1: Write failing adapter tests for normalized usage**

Start with Codex and Claude only.

Codex test should expect extraction of:

- `inputTokens`
- `cachedInputTokens`
- `outputTokens`
- `reasoningOutputTokens`
- `totalTokens`

Claude test should expect extraction of:

- `inputTokens`
- `outputTokens`
- `cacheCreationInputTokens`
- `cacheReadInputTokens`

- [ ] **Step 2: Add normalized usage types**

Add a usage structure to `WorkLogSession`.

- [ ] **Step 3: Implement Codex usage extraction**

Parse `token_count` events from real Codex JSONL.

- [ ] **Step 4: Implement Claude usage extraction**

Parse `message.usage` from Claude JSONL records.

- [ ] **Step 5: Keep unsupported providers explicitly empty**

Do not fake usage for Gemini/Cursor/OpenCode in this task.

- [ ] **Step 6: Run focused tests**

Run adapter-focused Vitest coverage.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/work-analysis/log-sources/types.ts \
  packages/server/src/work-analysis/types.ts \
  packages/server/src/work-analysis/log-sources/codex.ts \
  packages/server/src/work-analysis/log-sources/claude.ts \
  packages/server/src/__tests__
git commit -m "feat: normalize provider usage in work log sessions"
```

### Task 3: Add Capability Matrix And Usage Aggregation To Basic Analysis

**Files:**
- Modify: `packages/server/src/work-analysis/basic-analyzer.ts`
- Modify: `packages/server/src/work-analysis/basic-schema.ts`
- Modify: `packages/server/src/work-analysis/types.ts`
- Modify: `packages/server/src/work-analysis/service.ts`
- Modify: `packages/server/src/storage/repositories/work-analysis-repo.ts`
- Modify tests under `packages/server/src/__tests__/`

- [ ] **Step 1: Write failing analyzer tests for usage totals**

Cover:

- total input/output/cached/reasoning/total tokens
- provider breakdown
- workspace breakdown
- model breakdown
- top sessions by tokens

- [ ] **Step 2: Add a provider capability matrix to the basic result**

Populate it based on adapter-supported fields, not guesses.

- [ ] **Step 3: Extend the basic result schema**

Add:

- usage totals
- breakdowns
- rankings
- capability matrix

- [ ] **Step 4: Implement aggregation logic**

Ensure:

- missing usage fields do not poison totals
- totals are deterministic
- rankings only include sessions with meaningful values

- [ ] **Step 5: Add optional estimated cost support behind a local price table abstraction**

If price mapping is not available yet, keep `estimatedCostUsd` absent.

- [ ] **Step 6: Run focused server tests**

Run analyzer/service/repo tests.

- [ ] **Step 7: Commit**

```bash
git add packages/server/src/work-analysis/basic-analyzer.ts \
  packages/server/src/work-analysis/basic-schema.ts \
  packages/server/src/work-analysis/types.ts \
  packages/server/src/work-analysis/service.ts \
  packages/server/src/storage/repositories/work-analysis-repo.ts \
  packages/server/src/__tests__
git commit -m "feat: aggregate usage analytics in basic work analysis"
```

### Task 4: Rebuild The Basic Analysis UI As A Dashboard

**Files:**
- Modify: `packages/web/src/features/work-analysis/types.ts`
- Modify: `packages/web/src/features/settings/components/session-analysis-settings.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify/add tests under `packages/web/src/features/settings/components/`

- [ ] **Step 1: Write failing UI tests for dashboard sections**

Cover these sections:

- KPI summary
- workspace breakdown
- provider breakdown
- model breakdown
- provider capability / data quality area

- [ ] **Step 2: Replace the current summary-list rendering with dashboard sections**

Requirements:

- filters remain at the top
- results dominate the page
- long prose is minimized
- data is grouped into cards/sections

- [ ] **Step 3: Show token/cost metrics prominently**

At minimum:

- total tokens
- input tokens
- output tokens
- cached tokens
- estimated cost when available

- [ ] **Step 4: Show workspace and provider rankings**

This is mandatory for alignment with the new product direction.

- [ ] **Step 5: Show explicit provider capability messaging**

Users must understand why some providers contribute sessions but not tokens.

- [ ] **Step 6: Run focused web tests**

Run the settings page/component tests.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/work-analysis/types.ts \
  packages/web/src/features/settings/components/session-analysis-settings.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json \
  packages/web/src/features/settings/components
git commit -m "feat: redesign work analysis basic view as usage dashboard"
```

### Task 5: Update Docs And Real-Data E2E Coverage

**Files:**
- Modify: `docs/help/work-analysis.md`
- Modify/add: `e2e/fixtures/*`
- Modify/add: `e2e/specs/settings/analysis.spec.ts`

- [ ] **Step 1: Rewrite the help doc**

The doc must stop describing:

- opened workspace as a prerequisite
- basic analysis as a light textual summary

It must describe:

- result-driven workspace path filtering
- token/cost/usage dashboard semantics
- provider capability differences

- [ ] **Step 2: Add E2E coverage for real dashboard rendering**

The E2E should validate:

- multiple discovered paths
- token KPI rendering
- provider breakdown rendering

- [ ] **Step 3: Capture acceptance screenshots**

Need at least:

- multi-workspace real-data screenshot
- dashboard screenshot with token-oriented sections

- [ ] **Step 4: Commit**

```bash
git add docs/help/work-analysis.md e2e/fixtures e2e/specs/settings/analysis.spec.ts
git commit -m "docs: align work analysis help and e2e coverage with dashboard analytics"
```

---

## Verification Checklist

- [ ] Codex real logs contribute token totals
- [ ] Claude real logs contribute token totals
- [ ] Missing-token providers are explicitly marked, not silently flattened
- [ ] Dashboard shows workspace/provider/model breakdowns
- [ ] Basic analysis looks and behaves like analytics, not settings copy
- [ ] Docs and E2E reflect the new semantics

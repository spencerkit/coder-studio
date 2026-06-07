# Work Analysis Hourly Dashboard Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a first working version of the work analysis dashboard with cached dashboard projection, manual refresh, automatic hourly scheduling, a full-width token trend, and three token contribution rankings.

**Architecture:** Add a dashboard projection contract beside the existing `runBasic` path. Reuse current provider log collection and basic analysis derivation for the first slice, but persist dashboard cache and scan state separately so the UI can load without requiring users to run analysis first.

**Tech Stack:** TypeScript, Zod, Vitest, React, Jotai, CSS-in-TS inline styles, pnpm

---

## File Map

- Modify: `packages/server/src/work-analysis/types.ts`
  - Add dashboard query, projection, scan state, KPI, trend, ranking, and quality types.
- Modify: `packages/server/src/storage/repositories/work-analysis-repo.ts`
  - Persist dashboard cache alongside existing query records.
- Modify: `packages/server/src/work-analysis/service.ts`
  - Add `getDashboard`, `refreshDashboard`, and auto-scan scheduling.
- Modify: `packages/server/src/commands/work-analysis.ts`
  - Register `work.analysis.dashboard.get` and `work.analysis.dashboard.refresh`.
- Modify: `packages/server/src/__tests__/work-analysis-service.test.ts`
  - Add dashboard refresh/cache tests.
- Modify: `packages/web/src/features/work-analysis/types.ts`
  - Mirror dashboard types.
- Modify: `packages/web/src/features/work-analysis/use-work-analysis-controller.ts`
  - Load dashboard projection and expose refresh state.
- Modify: `packages/web/src/features/work-analysis/page.tsx`
  - Replace current report/tab UI with flat dashboard layout.
- Modify: `packages/web/src/features/work-analysis/page.test.tsx`
  - Assert full-width trend and three contribution rankings render.

## Tasks

- [ ] Write failing service tests for dashboard refresh, cache read, and failure preservation.
- [ ] Implement dashboard cache persistence in `WorkAnalysisRepo`.
- [ ] Implement dashboard projection builder in `WorkAnalysisService` using current basic analysis output.
- [ ] Add dashboard commands.
- [ ] Write failing page test for token trend plus project/model/agent contribution rankings.
- [ ] Replace the work analysis page with the approved flat dashboard layout.
- [ ] Add controller support for dashboard get/refresh.
- [ ] Run focused server and web tests.
- [ ] Run typecheck/build if available.

## Verification Commands

```bash
pnpm vitest packages/server/src/__tests__/work-analysis-service.test.ts
pnpm vitest packages/web/src/features/work-analysis/page.test.tsx
pnpm -w test -- --runInBand
```

If the workspace test runner does not support the final aggregate command, use the focused server/web commands plus the package build commands reported in `package.json`.

# Conversion-First Activation Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Improve retention by making return visits legible and by offering higher-order next steps after activation succeeds.

**Architecture:** Phase 4 productizes the return experience with `home.summary`, a welcome-page returning state, and resume routing. It then layers in Supervisor quick-start templates so the user who has already activated can more easily graduate into long-running workflows.

**Tech Stack:** TypeScript, React, Vitest, shared DTOs, server commands, bootstrap flow, supervisor UI

---

## Phase Scope

**Depends on:**

- Phase 1 setup/mobile DTO foundation
- preferably Phase 2 first-task launch, since return state is more valuable once sessions exist

**Includes master tasks:**

- [Task 6](./2026-05-14-conversion-first-activation.md#task-6-add-the-returning-home-summary-and-resume-behavior): returning summary and resume behavior
- [Task 7](./2026-05-14-conversion-first-activation.md#task-7-add-supervisor-quick-start-templates-and-run-the-final-regression-sweep): Supervisor quick-start templates

**Exit criteria:**

- server can return `home.summary`
- welcome page can render a returning summary card
- user can resume into the last relevant workspace/session path
- Supervisor dialog supports preset objective templates
- core activation regression suite is still green

## Deliverables

- `HomeSummaryDto`
- `packages/server/src/commands/home.ts`
- `ReturnSummaryCard`
- bootstrap and route-gate updates for resume
- Supervisor quick-start chips/templates

## Tracking Checklist

- [ ] Add `HomeSummaryDto`
- [ ] Implement `home.summary`
- [ ] Update bootstrap to hydrate returning state
- [ ] Render returning summary on welcome
- [ ] Wire resume CTA into workspace routing
- [ ] Add Supervisor objective templates
- [ ] Render quick-start template chips in the dialog
- [ ] Pass targeted home-summary, welcome, and Supervisor tests
- [ ] Run the final core activation regression sweep
- [ ] Commit Phase 4 changes

## Files In Play

**Return and resume**

- Create: `packages/server/src/commands/home.ts`
- Create: `packages/server/src/commands/home.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/web/src/hooks/use-bootstrap.ts`
- Modify: `packages/web/src/features/welcome/index.tsx`
- Create: `packages/web/src/features/welcome/components/return-summary-card.tsx`
- Create: `packages/web/src/features/welcome/components/return-summary-card.test.tsx`
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`

**Supervisor**

- Modify: `packages/web/src/features/supervisor/actions/use-objective-dialog-state.ts`
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`
- Modify: `packages/web/src/features/supervisor/components/supervisor-card.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

## Verification

Run these before closing the phase:

```bash
pnpm exec vitest run \
  packages/server/src/commands/home.test.ts \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/welcome/components/return-summary-card.test.tsx \
  packages/web/src/features/supervisor/components/supervisor-card.test.tsx \
  packages/web/src/features/setup/views/setup-page.test.tsx \
  packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx \
  packages/server/src/commands/setup.test.ts
```

Expected outcome: return/resume and Supervisor templates are green, and the core activation path has not regressed.

## Watchouts

- Keep return state short and decisive; it should reduce cognitive load, not add a dashboard.
- Resume routing must respect the actual last-viewed target instead of inventing a parallel navigation state.
- Supervisor quick-start is valuable only after activation; do not move it earlier in the funnel.

## Detailed Execution Source

Use the detailed step-by-step instructions in the master plan:

- [Task 6 detailed steps](./2026-05-14-conversion-first-activation.md#task-6-add-the-returning-home-summary-and-resume-behavior)
- [Task 7 detailed steps](./2026-05-14-conversion-first-activation.md#task-7-add-supervisor-quick-start-templates-and-run-the-final-regression-sweep)

## Suggested Commit Boundary

```bash
git commit -m "feat: add return summary and supervisor quick start"
```

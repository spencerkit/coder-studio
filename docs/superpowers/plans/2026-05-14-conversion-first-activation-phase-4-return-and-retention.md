# Conversion-First Activation Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Improve retention by making return visits legible and by offering higher-order next steps after activation succeeds.

**Architecture:** Phase 4 productizes the return experience with `home.summary`, a welcome-page returning state, and resume routing. It then layers in Supervisor quick-start templates so already-activated users can move into longer-running workflows more easily. This work is independent of diagnostics and does not rely on a separate onboarding state machine.

**Tech Stack:** TypeScript, React, Vitest, shared DTOs, server commands, bootstrap flow, supervisor UI

---

## Phase Scope

**Depends on:**

- Phase 1 diagnostics foundation
- preferably Phase 2 first-value launch behavior, because return state is more meaningful once sessions exist

**Includes master tasks:**

- [Task 4](./2026-05-14-conversion-first-activation.md#task-4-add-a-returning-summary-and-resume-behavior): returning summary and resume behavior
- [Task 5](./2026-05-14-conversion-first-activation.md#task-5-add-supervisor-quick-start-after-activation): Supervisor quick-start templates

**Exit criteria:**

- server can return `home.summary`
- welcome can render a returning summary card
- the user can resume the last relevant workspace or session target
- Supervisor dialog supports preset objective templates
- the broader activation regression suite remains green

## Deliverables

- `HomeSummaryDto`
- `packages/server/src/commands/home.ts`
- `ReturnSummaryCard`
- bootstrap and route-gate updates for resume behavior
- Supervisor quick-start templates and localized copy

## Tracking Checklist

- [ ] Add `HomeSummaryDto`
- [ ] Implement `home.summary`
- [ ] Hydrate returning state during bootstrap
- [ ] Render returning summary on welcome
- [ ] Wire the resume CTA into workspace routing
- [ ] Add Supervisor objective templates
- [ ] Render quick-start template chips in the dialog
- [ ] Pass targeted home-summary, welcome, and Supervisor tests
- [ ] Run the final activation regression sweep
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
  packages/web/src/features/diagnostics/index.test.tsx \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx
```

Expected outcome: return/resume and Supervisor templates are green, and the inline-first activation path plus diagnostics helper behavior has not regressed.

## Watchouts

- Keep return state short and decisive; it should reduce cognitive load, not add a dashboard.
- Resume routing must respect the actual last-viewed target instead of inventing a parallel navigation state.
- Supervisor quick-start is valuable only after activation; do not move it earlier in the funnel.
- Do not make return behavior depend on prior diagnostics entry; it should work from real usage history alone.

## Detailed Execution Source

Use the implementation guidance in the master plan:

- [Task 4](./2026-05-14-conversion-first-activation.md#task-4-add-a-returning-summary-and-resume-behavior)
- [Task 5](./2026-05-14-conversion-first-activation.md#task-5-add-supervisor-quick-start-after-activation)

## Suggested Commit Boundary

```bash
git commit -m "feat: add return summary and supervisor quick start"
```

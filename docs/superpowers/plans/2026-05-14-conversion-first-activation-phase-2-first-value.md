# Conversion-First Activation Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Turn setup from a shell into a real activation flow that gets the user environment-ready, provider-ready, and into a first useful AI task.

**Architecture:** Phase 2 is the core conversion lift. It uses the Phase 1 readiness contract to drive the `Environment Doctor`, extracts workspace directory selection into a reusable surface, and moves provider readiness plus starter-task session creation into setup so the user can reach first value without bouncing across product areas.

**Tech Stack:** TypeScript, React, Jotai, Vitest, existing workspace and provider launch flows

---

## Phase Scope

**Depends on:**

- Phase 1 foundation and readiness commands

**Includes master tasks:**

- [Task 3](./2026-05-14-conversion-first-activation.md#task-3-build-the-environment-doctor-ui-and-extract-a-reusable-directory-picker): Environment Doctor UI and shared directory picker
- [Task 4](./2026-05-14-conversion-first-activation.md#task-4-move-provider-readiness-and-first-task-launch-into-setup): provider readiness and starter-task launch

**Exit criteria:**

- setup can progress from goal selection to doctor state
- failing readiness checks are visible with clear next actions
- workspace root selection no longer leaks `/home/spencer`
- setup can show provider readiness inline
- a ready provider can create a first session from a starter draft

## Deliverables

- `use-setup-flow` and `use-setup-status`
- `SetupGoalStep`, `SetupDoctorStep`, and `SetupLaunchStep`
- reusable directory-picker component shared with workspace launch
- provider-launch path that accepts `draft`
- starter templates for first-task launch

## Tracking Checklist

- [ ] Add setup flow state for `goal`, `doctor`, `launch`, and `success`
- [ ] Fetch and map `setup.status` into UI state
- [ ] Render failing doctor checks and fix actions
- [ ] Extract a reusable directory picker for setup and workspace launch
- [ ] Remove hardcoded `/home/spencer` from root-path behavior
- [ ] Add provider-state vocabulary shared across setup, settings, and draft launcher
- [ ] Extend provider launch to support `draft`
- [ ] Add starter templates such as `Explain this project`
- [ ] Ensure a ready provider can create the first session from setup
- [ ] Pass targeted setup, workspace-launch, and provider tests
- [ ] Commit Phase 2 changes

## Files In Play

**Setup**

- Create: `packages/web/src/features/setup/actions/use-setup-flow.ts`
- Create: `packages/web/src/features/setup/actions/use-setup-status.ts`
- Create: `packages/web/src/features/setup/views/setup-goal-step.tsx`
- Create: `packages/web/src/features/setup/views/setup-doctor-step.tsx`
- Create: `packages/web/src/features/setup/views/setup-launch-step.tsx`
- Create: `packages/web/src/features/setup/components/setup-directory-picker.tsx`
- Modify: `packages/web/src/features/setup/views/setup-page.tsx`
- Modify: `packages/web/src/features/setup/views/setup-page.test.tsx`

**Workspace and provider**

- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`
- Modify: `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- Create: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.test.tsx`

## Verification

Run these before closing the phase:

```bash
pnpm exec vitest run \
  packages/web/src/features/setup/views/setup-page.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx \
  packages/web/src/features/settings/components/provider-settings.test.tsx
```

Expected outcome: setup can reach doctor and launch steps, root-path cleanup is covered, and first-task session launch works with `draft`.

## Watchouts

- This is the highest-ROI phase; do not dilute it with mobile polish or return-state work yet.
- Keep the doctor state model aligned with the DTO names from Phase 1.
- Avoid introducing a second provider-status vocabulary; reuse the same states everywhere.

## Detailed Execution Source

Use the detailed step-by-step instructions in the master plan:

- [Task 3 detailed steps](./2026-05-14-conversion-first-activation.md#task-3-build-the-environment-doctor-ui-and-extract-a-reusable-directory-picker)
- [Task 4 detailed steps](./2026-05-14-conversion-first-activation.md#task-4-move-provider-readiness-and-first-task-launch-into-setup)

## Suggested Commit Boundary

```bash
git commit -m "feat: ship activation doctor and first-task launch"
```

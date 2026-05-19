# Conversion-First Activation Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Deliver first value through the existing workspace and agent launch surfaces while keeping diagnostics secondary.

**Architecture:** Phase 2 builds on the diagnostics foundation from Phase 1, but it does not introduce a new wizard. Desktop and mobile launch behavior stay inline-first. The launcher, draft entry points, and provider settings share one provider-state vocabulary. Diagnostics remains the deeper environment report for blocked or high-risk cases, with the original workspace or session intent preserved.

**Tech Stack:** TypeScript, React, Jotai, Vitest, existing workspace and provider launch flows

---

## Phase Scope

**Depends on:**

- Phase 1 diagnostics foundation

**Includes master task:**

- [Task 2](./2026-05-14-conversion-first-activation.md#task-2-keep-agent-and-workspace-flows-inline-first): inline launch recovery and workspace fallback behavior

**Exit criteria:**

- healthy provider launches go direct
- missing provider CLI with supported auto-install stays inline
- missing prerequisites or unsupported install paths show inline guidance plus a diagnostics affordance
- blocked workspace opens route into diagnostics with the selected path preserved
- desktop and mobile launch surfaces use the same provider-state vocabulary
- diagnostics can recheck and continue the original intent

## Deliverables

- inline provider launch recovery on desktop and mobile
- shared provider-state copy across launcher and settings surfaces
- workspace browse/root-path cleanup
- diagnostics continuation for `workspace_open` and `session_start`
- targeted regression coverage for inline install, manual recovery, and fallback routing

## Tracking Checklist

- [x] Keep direct launch behavior when runtime checks are already green
- [x] Keep inline install behavior when the provider CLI is missing and auto-install is supported
- [x] Show inline manual guidance when install cannot proceed automatically
- [x] Offer diagnostics as a secondary action from launcher help states
- [x] Preserve the selected workspace path when routing failed opens into diagnostics
- [x] Remove hardcoded root-path assumptions from workspace browse behavior
- [x] Keep provider-state labels and logic aligned across desktop, mobile, and settings surfaces
- [x] Pass focused launcher, workspace, diagnostics, and provider-settings tests
- [ ] Commit Phase 2 changes

## Status

Completed in the current worktree except for the final commit boundary.

Implemented outcomes:

- healthy launches still go direct from desktop draft launchers and the mobile agent sheet
- missing provider CLI with supported auto-install stays inline via the shared launcher state model
- unsupported install or missing prerequisite cases show inline guidance plus a diagnostics affordance
- failed workspace opens route to diagnostics with the selected path preserved
- diagnostics can recheck and continue both `workspace_open` and `session_start` intents
- provider runtime status and diagnostics entry points are aligned across launcher and Settings surfaces
- workspace browse now expands `~` and returns dynamic `rootPaths` instead of relying on hardcoded assumptions

Verified on 2026-05-17 with:

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/diagnostics-commands.test.ts \
  packages/server/src/__tests__/workspace-commands.test.ts \
  packages/server/src/__tests__/session-commands.test.ts \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx \
  packages/web/src/features/settings/components/provider-settings.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/diagnostics/index.test.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx
```

## Files In Play

**Launch recovery**

- Modify: `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- Create: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/agent-panes/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.tsx`
- Modify: `packages/web/src/features/settings/components/provider-settings.test.tsx`

**Workspace fallback**

- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

**Diagnostics refinement**

- Modify: `packages/web/src/features/diagnostics/page.tsx`
- Modify: `packages/web/src/features/diagnostics/index.test.tsx`

## Verification

Run these before closing the phase:

```bash
pnpm exec vitest run \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  packages/web/src/features/settings/components/provider-settings.test.tsx \
  packages/web/src/features/diagnostics/index.test.tsx
```

Expected outcome: the first-value path stays direct, inline recovery remains in the launcher, and diagnostics only appears as a deeper fallback when needed.

## Watchouts

- Do not redirect healthy launches into diagnostics.
- Do not let diagnostics replace inline install or inline prerequisite guidance.
- Do not let desktop and mobile launch surfaces drift into separate provider-state models.
- Keep the diagnostics page useful as a full environment report, but highlight the issues that matter most to the current intent.

## Detailed Execution Source

Use the implementation guidance in the master plan:

- [Task 2](./2026-05-14-conversion-first-activation.md#task-2-keep-agent-and-workspace-flows-inline-first)

## Suggested Commit Boundary

```bash
git commit -m "feat: keep activation inline-first with diagnostics fallback"
```

# Conversion-First Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a conversion-first product path that gets a new user to first useful AI work quickly, then promotes phone continuation and later resume without forcing a dedicated onboarding funnel.

**Architecture:** Activation is inline-first. `Welcome`, workspace open, and agent launch remain the normal path. A dedicated `/diagnostics` page plus `diagnostics.get` / `diagnostics.recheck` provide full-environment visibility only when the user is blocked, highly likely to fail, or explicitly opens diagnostics from Settings. Phone continuation and return/resume build on the same primitives instead of introducing a parallel environment-preparation system.

**Tech Stack:** TypeScript, React, React Router, Jotai, Vitest, Zod, existing websocket command dispatch, existing workspace/provider/supervisor state

---

## What This Plan Is

This file is the coordination index for the activation rollout.

The detailed execution source lives in the phase plans:

- Phase 1: [Conversion-First Activation Phase 1 Implementation Plan](./2026-05-14-conversion-first-activation-phase-1-foundation.md)
- Phase 2: [Conversion-First Activation Phase 2 Implementation Plan](./2026-05-14-conversion-first-activation-phase-2-first-value.md)
- Phase 3: [Conversion-First Activation Phase 3 Implementation Plan](./2026-05-14-conversion-first-activation-phase-3-mobile-continuation.md)
- Phase 4: [Conversion-First Activation Phase 4 Implementation Plan](./2026-05-14-conversion-first-activation-phase-4-return-and-retention.md)

This master plan deliberately stays shorter than the phase plans so it does not drift into a second, stale implementation script.

## Scope Check

This rollout still spans three sequential product slices:

- P0: first successful task
- P1: cross-device continuation
- P2: return and resume

They remain in one activation program because each phase builds on the same product model:

- healthy flows stay direct
- recovery stays inline whenever possible
- diagnostics is a secondary helper, not the front door
- phone continuation appears only after explicit user intent
- return and resume build on real usage state, not on a separate onboarding state machine

## Product Rules

- `Open Workspace` remains the primary first-run action.
- Starting an agent remains direct when the runtime is healthy.
- If a provider CLI is missing and auto-install is supported, installation stays inline.
- If prerequisites are missing or auto-install is unavailable, the launcher shows inline recovery and offers diagnostics as a secondary path.
- If a workspace open fails, the product may hand off to diagnostics with the selected path preserved.
- `Continue on Phone` should appear only after the user asks for phone continuation from Settings or another explicit entry point.
- Diagnostics should show a full environment report, but the entry context should determine the header, highlighted issues, and continuation action.
- Return and resume should build on actual workspace, session, and Supervisor history rather than on activation-state bookkeeping.

## Phase Breakdown

### Phase 1: Foundation

Reference:

- [Conversion-First Activation Phase 1 Implementation Plan](./2026-05-14-conversion-first-activation-phase-1-foundation.md)

Purpose:

- establish the quiet diagnostics foundation
- add diagnostics routing on desktop and mobile
- add manual diagnostics entry from Settings
- add the shared diagnostics contract and server command facade
- keep workspace open and agent launch inline-first

Primary outcome:

- the product can surface a full environment report when needed without forcing a dedicated onboarding step

### Phase 2: First Value

Reference:

- [Conversion-First Activation Phase 2 Implementation Plan](./2026-05-14-conversion-first-activation-phase-2-first-value.md)

Purpose:

- preserve direct first-value flows
- keep provider install and prerequisite guidance inline
- align desktop and mobile launcher behavior
- route blocked workspace or session flows into diagnostics only when deeper inspection is needed
- remove credibility-damaging workspace path assumptions

Primary outcome:

- the user reaches a useful agent session through the existing product surfaces, with diagnostics acting as a fallback instead of a gate

### Phase 3: Phone Continuation

Reference:

- [Conversion-First Activation Phase 3 Implementation Plan](./2026-05-14-conversion-first-activation-phase-3-mobile-continuation.md)

Purpose:

- productize `Continue on Phone` as an explicit but optional next step
- expose host/auth/mobile readiness in product language
- reuse diagnostics for deeper phone-continuation troubleshooting
- preserve workspace or session context while preparing continuation

Primary outcome:

- users can move from desktop to phone with a clear, productized path instead of relying on docs or hidden environment knowledge

### Phase 4: Return And Retention

Reference:

- [Conversion-First Activation Phase 4 Implementation Plan](./2026-05-14-conversion-first-activation-phase-4-return-and-retention.md)

Purpose:

- summarize recent activity for returning users
- resume the last relevant workspace or session target
- add Supervisor quick-start templates for longer-running work

Primary outcome:

- returning users can understand what happened and continue work quickly

## Master Task Map

### Task 2: Keep Agent And Workspace Flows Inline-First

Execution source:

- [Conversion-First Activation Phase 2 Implementation Plan](./2026-05-14-conversion-first-activation-phase-2-first-value.md)

Intent:

- keep healthy workspace and agent flows direct
- keep supported provider install and repair inline
- use diagnostics only as the deeper fallback for blocked workspace or session starts

### Task 3: Productize Phone Continuation Without A Gate

Execution source:

- [Conversion-First Activation Phase 3 Implementation Plan](./2026-05-14-conversion-first-activation-phase-3-mobile-continuation.md)

Intent:

- expose `Continue on Phone` only from explicit user intent
- use diagnostics to explain host, auth, and reachability blockers
- preserve workspace or session context while preparing continuation

### Task 4: Add A Returning Summary And Resume Behavior

Execution source:

- [Conversion-First Activation Phase 4 Implementation Plan](./2026-05-14-conversion-first-activation-phase-4-return-and-retention.md)

Intent:

- summarize recent work for returning users
- resume the actual last relevant workspace or session target

### Task 5: Add Supervisor Quick Start After Activation

Execution source:

- [Conversion-First Activation Phase 4 Implementation Plan](./2026-05-14-conversion-first-activation-phase-4-return-and-retention.md)

Intent:

- help already-activated users move into longer-running workflows
- keep Supervisor quick starts clearly after first value, not before it

## Core Surfaces

### Diagnostics

Key files:

- `packages/core/src/domain/diagnostics.ts`
- `packages/server/src/commands/diagnostics.ts`
- `packages/web/src/features/diagnostics/*`
- `packages/web/src/shells/desktop-shell.tsx`
- `packages/web/src/shells/mobile-shell/index.tsx`

Role:

- full-environment diagnostics surface
- explicit recovery path for blocked workspace, session, and phone-continuation flows
- manual health-check entry from Settings

### Inline Launch Recovery

Key files:

- `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- `packages/web/src/features/settings/components/provider-settings.tsx`

Role:

- keep direct launch behavior for healthy sessions
- keep supported installation flows inline
- keep unsupported or manual-recovery cases understandable

### Workspace Recovery

Key files:

- `packages/server/src/commands/workspace.ts`
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`

Role:

- keep workspace browsing credible and action-oriented
- preserve user-selected path context when recovery is needed

### Return And Resume

Key files:

- `packages/server/src/commands/home.ts`
- `packages/web/src/hooks/use-bootstrap.ts`
- `packages/web/src/features/welcome/index.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-route-gate.tsx`

Role:

- make prior work legible on return
- resume the actual last relevant target

## Verification Baseline

Run focused tests during each phase, then finish with:

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/diagnostics-commands.test.ts \
  packages/server/src/commands/home.test.ts \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/diagnostics/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/features/welcome/components/return-summary-card.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx \
  packages/web/src/features/supervisor/components/supervisor-card.test.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx
```

Expected outcome:

- healthy flows stay direct
- inline recovery remains intact
- diagnostics works as a full-environment helper
- phone continuation is explicit and contextual
- returning users can resume work cleanly

## Watchouts

- Do not reintroduce a dedicated onboarding route as a required first step.
- Do not redirect healthy workspace or agent flows into diagnostics.
- Do not let diagnostics replace inline install or inline manual recovery.
- Do not advertise phone continuation before the user expresses that intent.
- Do not make return/resume depend on prior diagnostics entry.

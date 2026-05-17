# Conversion-First Activation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Ship the activation foundation without forcing users into a visible onboarding funnel. The product should stay quiet in healthy flows, recover inline when possible, and expose a diagnostics surface only when users need deeper environment visibility.

**Architecture:** Phase 1 does not introduce a mandatory onboarding step. Instead, it establishes two layers: the normal product flow continues inline, while `/diagnostics` becomes a secondary full-environment diagnostics surface. Workspace open and agent launch keep their native behavior first, then link or redirect into diagnostics only at explicit failure points.

**Tech Stack:** TypeScript, React, React Router, Jotai, Vitest, websocket command dispatch, Zod

---

## Phase Scope

**Includes master tasks:**

- quiet diagnostics route and navigation surface
- full-environment diagnostics command contract
- inline provider launch recovery for desktop and mobile
- failure-path routing from blocked workspace open into diagnostics

**Does not include yet:**

- mandatory onboarding wizard
- proactive environment interruption before user intent
- provider auth gating as a product-level entry requirement
- broader welcome-page funnel redesign

**Exit criteria:**

- no required onboarding step in the primary activation path
- `/diagnostics` exists on desktop and mobile
- diagnostics can be opened manually from Settings
- agent launch keeps inline install/manual recovery behavior
- diagnostics acts as a secondary helper surface, not the default launch path
- diagnostics returns full environment checks for workspace, providers, auth, and mobile access

## Product Definition

### Core Principle

Environment help should behave like a quiet assistant, not a gate. It should help confirm and repair issues when needed, but it should not interrupt healthy flows or force users through an explicit ceremony.

### Primary Flows

- Opening a workspace should continue to use the existing workspace flow.
- Starting an agent should continue to use the existing launcher flow.
- If the runtime is healthy, the product should proceed directly.
- If a recoverable issue exists, the product should try to handle it inline first.
- If the issue needs deeper inspection, the product should offer diagnostics as a secondary path.

### Diagnostics Role

- `/diagnostics` is a full environment diagnostics page.
- It is manually reachable from Settings.
- It can also be reached from explicit failure points such as failed workspace open or blocked session launch.
- It should present environment state clearly, support recheck, and help users understand what is wrong.
- It should not own the normal provider install or session start flow.

## Deliverables

- new diagnostics route on desktop and mobile shells
- diagnostics navigation helper and route intent model
- settings entry for manual diagnostics access
- server diagnostics command surface for full environment inspection
- inline desktop and mobile provider launch recovery with diagnostics as secondary affordance
- workspace-open failure handoff into diagnostics

## Tracking Checklist

- [x] Add `/diagnostics` to desktop and mobile routing
- [x] Add a manual Diagnostics entry in Settings
- [x] Define diagnostics route intent and query parsing helpers
- [x] Add shared diagnostics DTOs in `packages/core`
- [x] Implement server-side full environment diagnostics commands
- [x] Render a diagnostics page with contextual header, checks, docs links, and recheck action
- [x] Keep workspace-open failure redirect into diagnostics
- [x] Keep provider launch inline when runtime is healthy
- [x] Keep provider install inline when CLI is missing and auto-install is supported
- [x] Show inline manual recovery when prerequisites are missing or auto-install is unavailable
- [x] Expose diagnostics as a secondary link from inline launch-help states
- [x] Add and pass focused web and server tests
- [ ] Commit Phase 1 changes

## Status

Completed in the current worktree except for the final commit boundary.

Implemented outcomes:

- diagnostics is available on both desktop and mobile shells
- Settings exposes Diagnostics as its own section entry rather than a buried inline link
- diagnostics reports a full environment view while keeping contextual entry copy and continuation behavior
- blocked workspace and provider/session flows can hand off into diagnostics with intent preserved
- healthy launches and supported auto-install cases still stay inline

Verified on 2026-05-17 with:

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/diagnostics-commands.test.ts \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/diagnostics/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

## Files In Play

**Web**

- Modify: `packages/web/src/features/agent-panes/actions/use-provider-launcher.ts`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Create: `packages/web/src/features/diagnostics/index.ts`
- Create: `packages/web/src/features/diagnostics/navigation.ts`
- Create: `packages/web/src/features/diagnostics/page.tsx`

**Core and server**

- Create: `packages/core/src/domain/diagnostics.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/commands/diagnostics.ts`

**Tests**

- Create: `packages/server/src/__tests__/diagnostics-commands.test.ts`
- Create: `packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx`
- Create: `packages/web/src/features/diagnostics/index.test.tsx`
- Modify: `packages/web/src/features/agent-panes/index.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

## Verification

Run these before closing the phase:

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/diagnostics-commands.test.ts \
  packages/web/src/features/agent-panes/actions/use-provider-launcher.test.tsx \
  packages/web/src/features/agent-panes/index.test.tsx \
  packages/web/src/features/diagnostics/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/shells/mobile-shell/index.test.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-agent-sheet.test.tsx \
  packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected outcome: diagnostics is available as a quiet support surface, workspace and agent flows stay inline-first, and explicit failure paths can hand off to a full environment report.

## Watchouts

- Do not reintroduce a mandatory onboarding funnel.
- Do not redirect healthy provider launches into diagnostics.
- Do not let diagnostics take ownership of normal provider install/session continuation.
- Do not gate product access on provider auth readiness.
- Keep diagnostics useful but low-emphasis when users do not need it.

## Detailed Execution Source

Use the detailed step-by-step instructions in the contextual diagnostics implementation plan:

- [Contextual Diagnostics Assistant plan](./2026-05-15-contextual-diagnostics-assistant.md)

## Suggested Commit Boundary

```bash
git commit -m "feat: add quiet diagnostics foundation for activation"
```

# Conversion-First Activation Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Ship the new activation entry point so a new user can move from `Welcome` to `/setup`, and give the product a backend readiness surface the UI can depend on.

**Architecture:** Phase 1 establishes the new activation frame without yet solving the full funnel. The web app gets a setup route and welcome CTA rewrite, while the server and shared domain layer expose `setup.status` and `setup.mobileAccessStatus` as the canonical readiness inputs for later phases.

**Tech Stack:** TypeScript, React, React Router, Jotai, Vitest, Zod, websocket command dispatch

---

## Phase Scope

**Includes master tasks:**

- [Task 1](./2026-05-14-conversion-first-activation.md#task-1-rewrite-welcome-and-add-the-setup-route-shell): rewrite welcome and add the `/setup` route shell
- [Task 2](./2026-05-14-conversion-first-activation.md#task-2-add-shared-setup-dtos-and-the-setupmobile-server-commands): add shared setup DTOs and server readiness commands

**Does not include yet:**

- Environment Doctor UI
- provider-first launch flow
- mobile continuation surface
- return/resume and Supervisor quick-start

**Exit criteria:**

- primary welcome CTA sends users to `/setup`
- `DesktopShell` renders `SetupPage`
- shared DTOs exist for setup/mobile status
- server returns structured readiness data via `setup.status`
- server returns structured LAN/auth exposure data via `setup.mobileAccessStatus`

## Deliverables

- welcome positioning moved from generic IDE framing to activation-first framing
- new `packages/web/src/features/setup/*` shell exists and is routable
- new shared readiness types in `packages/core`
- new server command surface in `packages/server/src/commands/setup.ts`

## Tracking Checklist

- [ ] Replace the welcome primary CTA with `Start Setup`
- [ ] Add `/setup` to `DesktopShell`
- [ ] Create the initial `SetupPage` shell and step shell component
- [ ] Add and pass welcome/route tests
- [ ] Add `SetupCheckDto`, `SetupCheckStatus`, and `MobileAccessStatusDto`
- [ ] Extend `CommandContext` with config needed for mobile access reporting
- [ ] Implement `setup.status`
- [ ] Implement `setup.mobileAccessStatus`
- [ ] Add and pass server command tests
- [ ] Commit Phase 1 changes

## Files In Play

**Web**

- Modify: `packages/web/src/features/welcome/index.tsx`
- Modify: `packages/web/src/features/welcome/index.test.tsx`
- Modify: `packages/web/src/shells/desktop-shell.tsx`
- Modify: `packages/web/src/shells/desktop-shell.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Create: `packages/web/src/features/setup/index.ts`
- Create: `packages/web/src/features/setup/views/setup-page.tsx`
- Create: `packages/web/src/features/setup/views/setup-page.test.tsx`
- Create: `packages/web/src/features/setup/components/setup-step-shell.tsx`

**Core and server**

- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/ws/hub.ts`
- Modify: `packages/server/src/commands/index.ts`
- Create: `packages/server/src/commands/setup.ts`
- Create: `packages/server/src/commands/setup.test.ts`

## Verification

Run these before closing the phase:

```bash
pnpm exec vitest run \
  packages/web/src/features/welcome/index.test.tsx \
  packages/web/src/shells/desktop-shell.test.tsx \
  packages/web/src/features/setup/views/setup-page.test.tsx \
  packages/server/src/commands/setup.test.ts
```

Expected outcome: the welcome-to-setup path is green, the `/setup` route is green, and both setup readiness commands return typed data.

## Watchouts

- Keep the welcome rewrite focused on the conversion path; do not broaden this into a full UI redesign.
- Do not build the actual doctor flow yet; Phase 1 only needs the route shell plus backend contract.
- Preserve future compatibility for mobile continuation by keeping `setup.mobileAccessStatus` stable.

## Detailed Execution Source

Use the detailed step-by-step instructions in the master plan:

- [Task 1 detailed steps](./2026-05-14-conversion-first-activation.md#task-1-rewrite-welcome-and-add-the-setup-route-shell)
- [Task 2 detailed steps](./2026-05-14-conversion-first-activation.md#task-2-add-shared-setup-dtos-and-the-setupmobile-server-commands)

## Suggested Commit Boundary

```bash
git commit -m "feat: add setup entrypoint and readiness foundation"
```

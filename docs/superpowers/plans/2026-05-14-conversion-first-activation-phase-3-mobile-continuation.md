# Conversion-First Activation Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Productize phone continuation so the user can move from desktop success to the next differentiated outcome without reading docs.

**Architecture:** Phase 3 builds on the diagnostics foundation and the inline-first launch model. Phone continuation remains opt-in. Settings and workspace surfaces can initiate it, while the diagnostics page becomes the full environment report for `mobile_continue`: it explains host exposure, auth readiness, reachable links, and what still blocks continuation.

**Tech Stack:** TypeScript, React, Jotai, Vitest, diagnostics command surface, existing workspace shell

---

## Phase Scope

**Depends on:**

- Phase 1 diagnostics foundation
- Phase 2 inline-first launch recovery

**Includes master task:**

- [Task 3](./2026-05-14-conversion-first-activation.md#task-3-productize-phone-continuation-without-a-gate): phone continuation entry points and diagnostics-backed recovery

**Exit criteria:**

- users can explicitly ask to continue on phone from Settings or workspace surfaces
- diagnostics can report host exposure, auth readiness, and candidate links for phone continuation
- localhost-only or unprotected states are explained clearly
- the continuation action preserves workspace or session context
- the product does not advertise phone continuation before the user expresses that intent

## Deliverables

- `mobile_continue` support on the diagnostics page
- explicit `Continue on Phone` entry points from Settings and desktop workspace surfaces
- copyable mobile link handling tied to real readiness data
- localized copy for host/auth/mobile continuation states
- focused tests for phone continuation and diagnostics recheck behavior

## Tracking Checklist

- [ ] Expose `Continue on Phone` from Settings
- [ ] Add a workspace-level continuation entry point after desktop success
- [ ] Show mobile links only when the diagnostics result says they are usable
- [ ] Explain localhost-only and auth-disabled states in product language
- [ ] Recheck and continue from diagnostics after environment changes
- [ ] Preserve workspace/session intent while preparing phone continuation
- [ ] Pass targeted diagnostics, settings, and workspace tests
- [ ] Commit Phase 3 changes

## Files In Play

- Modify: `packages/server/src/commands/diagnostics.ts`
- Modify: `packages/server/src/__tests__/diagnostics-commands.test.ts`
- Modify: `packages/web/src/features/diagnostics/navigation.ts`
- Modify: `packages/web/src/features/diagnostics/page.tsx`
- Modify: `packages/web/src/features/diagnostics/index.test.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Create: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

## Verification

Run these before closing the phase:

```bash
pnpm exec vitest run \
  packages/server/src/__tests__/diagnostics-commands.test.ts \
  packages/web/src/features/diagnostics/index.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx
```

Expected outcome: phone continuation is explicit but optional, diagnostics can explain and recheck the environment when needed, and mobile links are only surfaced when they are actually usable.

## Watchouts

- Do not present localhost fallback links as if they were valid phone entry points.
- Do not surface phone continuation before the user asks for it.
- Keep the diagnostics page productized; it should clarify the environment, not turn into documentation copy.
- Do not duplicate mobile-readiness inference on the client if the server already reports it.

## Detailed Execution Source

Use the implementation guidance in the master plan:

- [Task 3](./2026-05-14-conversion-first-activation.md#task-3-productize-phone-continuation-without-a-gate)

## Suggested Commit Boundary

```bash
git commit -m "feat: add explicit phone continuation with diagnostics recovery"
```

# Conversion-First Activation Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Master plan:** `docs/superpowers/plans/2026-05-14-conversion-first-activation.md`
>
> **Spec:** `docs/superpowers/specs/2026-05-14-conversion-first-activation-design.md`

**Goal:** Productize phone continuation so the user can move from first success on desktop to the next differentiated outcome without reading docs.

**Architecture:** Phase 3 builds on the setup success state and the mobile-access command introduced in Phase 1. It adds a reusable mobile assistant surface, exposes it from setup success and settings, and promotes `Continue on Phone` into the workspace shell so cross-device continuation becomes a normal next step instead of hidden product knowledge.

**Tech Stack:** TypeScript, React, Jotai, Vitest, setup/mobile status command, existing workspace shell

---

## Phase Scope

**Depends on:**

- Phase 1 readiness contract
- Phase 2 setup success state

**Includes master task:**

- [Task 5](./2026-05-14-conversion-first-activation.md#task-5-add-the-mobile-access-assistant-and-continue-on-phone): mobile assistant and cross-device CTA

**Exit criteria:**

- mobile assistant renders candidate LAN URLs
- local-only or unauthenticated exposure states are explained in product language
- setup success shows `Continue on Phone`
- settings exposes the same assistant
- workspace shell can surface the same continuation CTA

## Deliverables

- `packages/web/src/features/mobile-access/*`
- `SetupSuccessStep`
- settings integration for mobile continuation
- workspace-level `Continue on Phone` surface
- localized strings for mobile continuation states

## Tracking Checklist

- [ ] Add `useMobileAccess`
- [ ] Render LAN candidate URLs from `setup.mobileAccessStatus`
- [ ] Show the auth warning when only localhost/no password is configured
- [ ] Add `SetupSuccessStep`
- [ ] Show `Continue on Phone` in setup success
- [ ] Expose the same assistant in settings
- [ ] Expose the workspace-shell CTA
- [ ] Pass targeted mobile-access, settings, and workspace tests
- [ ] Commit Phase 3 changes

## Files In Play

- Create: `packages/web/src/features/mobile-access/index.ts`
- Create: `packages/web/src/features/mobile-access/actions/use-mobile-access.ts`
- Create: `packages/web/src/features/mobile-access/views/mobile-access-assistant.tsx`
- Create: `packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx`
- Modify: `packages/web/src/features/setup/views/setup-success-step.tsx`
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
  packages/web/src/features/mobile-access/views/mobile-access-assistant.test.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.test.tsx
```

Expected outcome: the assistant is available from setup success and settings, and the workspace shell can promote phone continuation.

## Watchouts

- Keep the assistant productized; do not collapse back into doc-like instructions.
- Use the server-reported URLs and auth state directly rather than adding duplicated client inference.
- Avoid over-investing in QR or polish unless the core continuation path is clearly working.

## Detailed Execution Source

Use the detailed step-by-step instructions in the master plan:

- [Task 5 detailed steps](./2026-05-14-conversion-first-activation.md#task-5-add-the-mobile-access-assistant-and-continue-on-phone)

## Suggested Commit Boundary

```bash
git commit -m "feat: add phone continuation flow"
```

# Mobile-Friendly Phase 5B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Compact the mobile workspace shell for short landscape viewports and ensure shell chrome / overlays preserve safe-area spacing even when the keyboard opens.

**Architecture:** Add a small mobile layout-mode hook that marks the shell root as `landscape-compact` when the viewport is both landscape and short. Keep the visual changes in CSS through safe-area and keyboard-inset variables so the workspace shell, bottom stack, sheet, drawer, and mobile full-screen routes all align to one spacing model.

**Tech Stack:** React 19, vitest + Testing Library, `matchMedia`, `visualViewport`, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-5b-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md`

---

## File Structure

**New files:**
- `packages/web/src/shells/mobile-shell/hooks/use-mobile-layout-mode.ts` — returns `default` or `landscape-compact`

**Modified files:**
- `packages/web/src/shells/mobile-shell/index.tsx` — expose layout mode on the shell root and switch bottom-stack keyboard inset to a CSS variable
- `packages/web/src/shells/mobile-shell/index.test.tsx` — add compact-mode coverage and update keyboard-inset assertion
- `packages/web/src/styles/components.css` — safe-area variables, landscape compact rules, and mobile full-screen route padding updates

**No changes in 5B:**
- websocket logic
- mobile navigation model
- desktop shell styling
- animation tuning

---

## Task 1: Write Failing Tests for Compact Landscape Mode and Keyboard-Inset Composition

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Add a `matchMedia` helper for landscape tests**

Introduce a helper that can force:

- `(orientation: landscape)` to match
- `(max-height: 540px)` to match

Reset `window.matchMedia` after each test.

- [ ] **Step 2: Add a failing landscape compact-mode test**

Append a test that:

- stubs short landscape media queries
- renders the mobile shell
- asserts the shell root has `data-layout-mode="landscape-compact"`

This should fail because the shell does not currently track a compact landscape mode.

- [ ] **Step 3: Update the visualViewport inset test to expect a CSS variable**

Change the existing keyboard-inset assertion so it expects:

- `--mobile-keyboard-inset: 240px`

instead of a direct `padding-bottom` override.

This should fail because the shell currently writes inline `paddingBottom`.

---

## Task 2: Implement the Minimal Layout-Mode and Safe-Area Changes

**Files:**
- Create: `packages/web/src/shells/mobile-shell/hooks/use-mobile-layout-mode.ts`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add the mobile layout-mode hook**

Implement a hook that:

- returns `default` by default
- returns `landscape-compact` when both landscape and short-height queries match
- listens for media-query changes

- [ ] **Step 2: Mark the mobile shell root with the layout mode**

In `MobileWorkspaceScaffold`:

- add the modifier class for compact mode
- expose `data-layout-mode`
- replace inline `paddingBottom` with a `--mobile-keyboard-inset` custom property

- [ ] **Step 3: Centralize safe-area and compact-mode spacing in CSS**

Update `components.css` so the mobile shell:

- defines safe-area variables on `.mobile-shell`
- uses those variables in the topbar, recovery strip, viewport, bottom stack, sheet, and drawer
- compacts bottom-stack and shell spacing in `landscape-compact`
- updates welcome/auth/settings mobile horizontal padding to include left/right safe-area insets

Keep the changes focused on layout and spacing only.

---

## Task 3: Verify, Refactor, and Commit `5B`

**Files:**
- All files changed in Tasks 1-2

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir packages/web test src/shells/mobile-shell/index.test.tsx
```

Verify the new compact-mode and keyboard-inset tests fail first, then pass.

- [ ] **Step 2: Run broader mobile shell regression checks**

Run:

```bash
pnpm --dir packages/web test src/app.test.tsx src/shells/desktop-shell.test.tsx
git diff --check
```

This verifies:

- app shell selection still behaves correctly
- desktop shell remains unaffected
- CSS and patch formatting stay clean

- [ ] **Step 3: Commit `5B`**

Create one implementation commit after verification, for example:

```bash
git add docs/superpowers/specs/2026-05-01-mobile-friendly-phase-5b-design.md \
        docs/superpowers/plans/2026-05-01-mobile-friendly-phase-5b.md \
        packages/web/src/shells/mobile-shell/hooks/use-mobile-layout-mode.ts \
        packages/web/src/shells/mobile-shell/index.tsx \
        packages/web/src/shells/mobile-shell/index.test.tsx \
        packages/web/src/styles/components.css
git commit -m "style: compact landscape mobile shell layout"
```

---

## Definition of Done

- short landscape mobile viewports activate a compact shell mode
- keyboard inset composes with bottom safe-area spacing
- mobile shell, sheet, drawer, and full-screen routes respect safe-area padding
- focused tests and selected regressions pass

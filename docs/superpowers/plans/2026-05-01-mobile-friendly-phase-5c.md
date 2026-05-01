# Mobile-Friendly Phase 5C Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add restrained shell-level micro-animations for mobile surfaces while honoring reduced-motion preferences.

**Architecture:** Add a tiny reduced-motion hook and expose `data-motion-mode` on the mobile shell root. Keep all motion changes in CSS so chips, dock items, recovery strip, sheet, and drawer surfaces gain consistent transitions and entry motion, while reduced-motion mode removes nonessential transforms and fades.

**Tech Stack:** React 19, `matchMedia`, vitest + Testing Library, vanilla CSS in `components.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-01-mobile-friendly-phase-5c-design.md`, `docs/superpowers/specs/2026-04-30-mobile-friendly-design.md`

---

## File Structure

**New files:**
- `packages/web/src/shells/mobile-shell/hooks/use-mobile-motion-mode.ts` — returns `default` or `reduced`

**Modified files:**
- `packages/web/src/shells/mobile-shell/index.tsx` — expose motion mode on the shell root
- `packages/web/src/shells/mobile-shell/index.test.tsx` — add reduced-motion coverage
- `packages/web/src/styles/components.css` — shell-level motion and reduced-motion overrides

**No changes in 5C:**
- websocket logic
- shell routing
- desktop animation system
- feature-internal animation behavior

---

## Task 1: Write Failing Tests for Motion Mode

**Files:**
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Add a failing reduced-motion test**

Append a test that:

- stubs `matchMedia('(prefers-reduced-motion: reduce)')` to `true`
- renders the mobile shell
- asserts `data-motion-mode="reduced"` on the shell root

This should fail because the shell does not currently expose motion mode.

- [ ] **Step 2: Keep the default-mode path explicit**

Add or extend an assertion that the shell root keeps `data-motion-mode="default"` when reduced motion is not requested.

---

## Task 2: Implement Minimal Motion Mode and Shell Motion Rules

**Files:**
- Create: `packages/web/src/shells/mobile-shell/hooks/use-mobile-motion-mode.ts`
- Modify: `packages/web/src/shells/mobile-shell/index.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add the reduced-motion hook**

Implement a hook based on `matchMedia('(prefers-reduced-motion: reduce)')` that returns:

- `default`
- `reduced`

- [ ] **Step 2: Expose motion mode on the shell root**

Mark the mobile shell root with:

- `data-motion-mode`
- optional mode class if helpful

- [ ] **Step 3: Add shell-local micro-animations**

Add CSS for:

- recovery-strip fade/lift entrance
- chip and dock state transitions
- sheet rise and drawer slide entrance
- backdrop opacity transition

Then add a reduced-motion branch that disables the entrance motion and nonessential transforms.

---

## Task 3: Verify and Commit `5C`

**Files:**
- All files changed in Tasks 1-2

- [ ] **Step 1: Run focused shell tests**

Run:

```bash
pnpm --dir packages/web test src/shells/mobile-shell/index.test.tsx
```

- [ ] **Step 2: Run selected regressions**

Run:

```bash
pnpm --dir packages/web test src/app.test.tsx
git diff --check
```

- [ ] **Step 3: Commit `5C`**

Create one implementation commit after verification, for example:

```bash
git add docs/superpowers/specs/2026-05-01-mobile-friendly-phase-5c-design.md \
        docs/superpowers/plans/2026-05-01-mobile-friendly-phase-5c.md \
        packages/web/src/shells/mobile-shell/hooks/use-mobile-motion-mode.ts \
        packages/web/src/shells/mobile-shell/index.tsx \
        packages/web/src/shells/mobile-shell/index.test.tsx \
        packages/web/src/styles/components.css
git commit -m "style: tune mobile shell micro interactions"
```

---

## Definition of Done

- mobile shell exposes motion mode
- shell-level micro-animations are present and restrained
- reduced-motion environments disable nonessential entrance motion
- focused verification and selected regressions pass

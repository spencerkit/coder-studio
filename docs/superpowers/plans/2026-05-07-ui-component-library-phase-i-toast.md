# UI Component Library Phase I Toast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land shared toast presentation primitives in `components/ui`, migrate the existing notifications toast UI to them, and keep current mobile/desktop positioning plus notification behavior unchanged.

**Architecture:** Implement `Toast` and `ToastViewport` as shared presentational primitives under `packages/web/src/components/ui/toast/`, with tone-based styling and a container wrapper for desktop/mobile placement. Keep the existing notification state and navigation logic in `features/notifications/toast-container.tsx`; this slice only replaces the raw `.toast*` markup and generic styles with shared UI primitives.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing Jotai notification atoms, Lucide icons, `tokens.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/toast/index.tsx`
- `packages/web/src/components/ui/toast/index.module.css`
- `packages/web/src/components/ui/toast/index.test.tsx`
- `packages/web/src/components/ui/toast/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/notifications/toast-container.tsx`
- `packages/web/src/features/notifications/toast-container.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/notifications/atoms.ts`
- `packages/web/src/features/notifications/use-session-notifications.ts`
- `packages/web/src/features/notifications/focus-session.ts`
- `packages/web/src/features/notifications/index.ts`
- `packages/web/src/shells/desktop-shell.tsx`
- `packages/web/src/shells/mobile-shell/index.tsx`
- any browser/system notification logic

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded toast caller inventory**

Current bounded UI callers in this slice:

- `ToastContainer` in `packages/web/src/features/notifications/toast-container.tsx`

Current non-goals:

- replacing the Jotai queue with `ToastProvider` / `useToast()`
- changing shell wiring that mounts `ToastContainer`
- changing navigation/focus behavior when a toast is clicked

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/notifications/toast-container.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Toast` Primitives

**Files:**
- Create: `packages/web/src/components/ui/toast/*`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <ToastViewport mobile={false}>
    <Toast
      tone="success"
      title="Session done"
      description="Claude · demo · 1m"
      onDismiss={vi.fn()}
    />
  </ToastViewport>
);
```

and assertions for:

- desktop vs mobile viewport classes
- tone variants mapping to compatibility classes such as `toast--success`
- title/body rendering and optional description support
- dismiss button invoking `onDismiss`
- optional clickable toast root via `onClick`
- optional action button rendering without breaking the existing close affordance

- [ ] **Step 2: Implement `Toast` and `ToastViewport`**

Requirements:

- public API exports `Toast`, `ToastViewport`, and the relevant prop/tone types
- `ToastViewport` accepts `children`, `mobile?: boolean`, and optional `className`
- `Toast` accepts `tone`, `title`, `description`, `onDismiss`, `closeLabel`, and optional `onClick`, `className`, `actionLabel`, and `onAction`
- output keeps legacy compatibility classes: `toast-container`, `toast-container--mobile`, `toast`, `toast--success`, `toast--error`, `toast--warning`, `toast--info`, `toast__icon`, `toast__content`, `toast__title`, `toast__body`, `toast__close`
- CSS module owns the generic toast styles migrated from `components.css`
- keep styling/behavior presentation-only; no queue state or timers in the shared primitive

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/toast/index.test.tsx
```

Expected: all shared toast tests pass.

## Task 3: Migrate `ToastContainer`

**Files:**
- Modify: `packages/web/src/features/notifications/toast-container.tsx`
- Modify: `packages/web/src/features/notifications/toast-container.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
expect(document.querySelector(".toast-container")).toBeTruthy();
expect(screen.getByRole("button", { name: "Dismiss" })).toHaveClass("toast__close");
```

and preserve:

- workspace/session click navigation behavior
- mobile viewport variant
- toast title/body rendering

- [ ] **Step 2: Replace raw toast markup with shared primitives**

Requirements:

- import `Toast` and `ToastViewport` from the public UI barrel
- keep the existing `KIND_CONFIG` icon selection, queue iteration, click navigation, and auto-dismiss timer behavior
- move raw `toast*` DOM structure into the shared components
- keep the close button stopPropagation behavior
- preserve the current `role="alert"` semantics

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/toast/index.test.tsx \
  src/features/notifications/toast-container.test.tsx
```

Expected: all tests pass.

## Task 4: Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Export and document the component**

Requirements:

- add `Toast` to the UI barrel
- add `Toast` to `components/ui/README.md` with its Tier 1 summary
- update `MIGRATION.md` to reflect toast migration status and caller count

- [ ] **Step 2: Run the full phase-i verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/toast/index.test.tsx \
  src/features/notifications/toast-container.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/toast \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/notifications/toast-container.tsx \
  src/features/notifications/toast-container.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining raw toast UI callers**

Run:

```bash
rg -n "toast-container|toast__|toast--|ToastContainer" \
  packages/web/src -g '!**/*.css'
```

Expected: remaining hits are the shared toast primitive itself, its tests/docs, the feature container using the shared primitive, and shell imports that intentionally keep the existing mount point.

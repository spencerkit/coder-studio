# UI Component Library Phase J Notice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Notice` component in `components/ui` and migrate the bounded settings/config-drift notice callers to it without changing their messaging or actions.

**Architecture:** Implement `Notice` as a presentational surface under `packages/web/src/components/ui/notice/` with tone variants, optional action, and optional dismiss affordance. Keep message content, refresh/navigation behavior, and load/cleanup state in feature code. The shared primitive only owns layout, tone styling, and compatibility classes for the migrated notice shell.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing app tokens, Lucide icons.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/notice/index.tsx`
- `packages/web/src/components/ui/notice/index.module.css`
- `packages/web/src/components/ui/notice/index.test.tsx`
- `packages/web/src/components/ui/notice/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/features/config-drift-banner/index.tsx`
- `packages/web/src/features/config-drift-banner/index.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/notifications/*`
- `packages/web/src/features/workspace/*`
- `packages/web/src/features/terminal-panel/*`
- shell entrypoints
- any notice/alert state management outside the two bounded callers above

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded notice caller inventory**

Current bounded callers in this slice:

- `settings-page` load error notice in `packages/web/src/features/settings/components/settings-page.tsx`
- `ConfigDriftBanner` notice in `packages/web/src/features/config-drift-banner/index.tsx`

Current non-goals:

- changing the settings data-loading flow
- changing config-drift cleanup state or selection logic
- introducing a generic toast/alert store
- migrating unrelated empty-state/banner patterns

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx \
  src/features/config-drift-banner/index.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Notice`

**Files:**
- Create: `packages/web/src/components/ui/notice/*`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <Notice
    tone="error"
    title="Settings load failed"
    description="boom"
    actionLabel="Refresh"
    onAction={vi.fn()}
    dismissible
    onDismiss={vi.fn()}
  />
);
```

and assertions for:

- tone variants mapping to compatibility classes such as `settings-page__notice--error`
- title/message rendering
- optional action button rendering and handler invocation
- optional dismiss button rendering and handler invocation
- optional `aria-live` pass-through if present in the caller

- [ ] **Step 2: Implement `Notice`**

Requirements:

- public API exports `Notice` and relevant tone/prop types
- `Notice` accepts `tone`, `title`, `message`, optional `actionLabel`, `onAction`, `dismissible`, `onDismiss`, `className`, and optional pass-through div props
- output keeps legacy compatibility classes for the migrated shell, including `settings-page__notice`, `settings-page__notice--error`, `settings-page__notice-copy`, `settings-page__notice-title`, `settings-page__notice-message`, and `config-drift-banner__notice` where applicable
- CSS module owns the generic notice styles migrated from `components.css`
- keep styling/behavior presentation-only; no data loading, cleanup, or routing logic in the shared primitive

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/notice/index.test.tsx
```

Expected: all shared notice tests pass.

## Task 3: Migrate Notice Callers

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/features/config-drift-banner/index.tsx`
- Modify: `packages/web/src/features/config-drift-banner/index.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
expect(document.querySelector(".settings-page__notice")).toBeTruthy();
expect(screen.getByRole("button", { name: "Refresh" })).toHaveClass("settings-page__notice-action");
```

and preserve:

- settings load error copy
- config-drift banner notice copy
- refresh action behavior
- dismiss behavior where present
- mobile compact banner unaffected

- [ ] **Step 2: Replace raw notice markup with shared primitive**

Requirements:

- import `Notice` from the public UI barrel
- keep current feature state, data loading, and action handlers intact
- move raw notice shell structure into shared UI
- preserve current alert/notice semantics and mobile/desktop behavior

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/notice/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/config-drift-banner/index.test.tsx
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

- add `Notice` to the UI barrel
- add `Notice` to `components/ui/README.md` with its Tier 1 summary
- update `MIGRATION.md` to reflect notice migration status and caller count

- [ ] **Step 2: Run the full phase-j verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/notice/index.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/config-drift-banner/index.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/notice \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/settings/components/settings-page.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/config-drift-banner/index.tsx \
  src/features/config-drift-banner/index.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining raw notice UI callers**

Run:

```bash
rg -n "settings-page__notice|config-drift-banner__notice|Notice" packages/web/src -g '!**/*.css'
```

Expected: remaining hits are the shared notice primitive itself, its tests/docs, and any feature code that intentionally still uses the shared primitive.

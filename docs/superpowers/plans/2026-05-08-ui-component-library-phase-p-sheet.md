# UI Component Library Phase P Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Sheet` primitive in `components/ui` as the current mobile bottom-sheet shell, then migrate a bounded first batch of existing `MobileSheet` callers onto it.

**Architecture:** Phase P is intentionally a bounded bridge between the feature-owned `MobileSheet` shell and the broader Tier 2 `Sheet` family described in the design spec. Implement `components/ui/sheet` as a shared mobile shell that preserves the existing `.mobile-sheet*` DOM and class contract, keeps the current inline header/body/footer prop model, and reuses the existing global sheet styles so nested flows such as `Select` inline detection keep working. This phase does not introduce a desktop drawer, portal-based rendering, or a new compositional API; it only centralizes the shared mobile shell and migrates the simplest existing callers first.

**Tech Stack:** React 19, TypeScript 6, Vitest + Testing Library, `clsx`, existing i18n, existing global `components.css` mobile-sheet styles, existing `PageHeader`.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/sheet/index.tsx`
- `packages/web/src/components/ui/sheet/index.test.tsx`
- `packages/web/src/components/ui/sheet/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/command-palette/components/command-palette.tsx`
- `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-workspace-drawer.tsx`
- any desktop drawer / right-side `Sheet` behavior
- any `Popover` or `ActionMenu` work

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded caller inventory**

Current callers in scope:

- `packages/web/src/features/command-palette/components/command-palette.tsx`
  - mobile branch currently renders the feature-owned `MobileSheet`
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
  - mobile branch currently renders the feature-owned `MobileSheet`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
  - mobile branch currently renders the feature-owned `MobileSheet`

Current non-goals for this phase:

- `packages/web/src/features/supervisor/views/mobile/mobile-supervisor-sheet.tsx`
- `packages/web/src/features/mobile-select/components/mobile-select-sheet.tsx`
- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- any nested inline-sheet or multi-layer mobile sheet orchestration
- any desktop drawer behavior

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Sheet`

**Files:**
- Create: `packages/web/src/components/ui/sheet/index.tsx`
- Create: `packages/web/src/components/ui/sheet/index.test.tsx`
- Create: `packages/web/src/components/ui/sheet/README.md`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <Sheet
    title="Quick Actions"
    kicker="COMMAND PALETTE"
    body={<div>Body</div>}
    footer={<button type="button">Done</button>}
    onClose={onClose}
  />
);
```

and assertions for:

- renders the existing `.mobile-sheet-layer`, `.mobile-sheet`, `.mobile-sheet__header`, `.mobile-sheet__body`, and optional `.mobile-sheet__footer` chrome
- clicking the backdrop calls `onClose`
- `onBack ?? onClose` behavior still drives the header back button
- `fullscreen` suppresses the handle and composes `.mobile-sheet--fullscreen`
- caller-supplied legacy compatibility classes remain present through `bodyClassName` and `contentClassName`
- the region label still uses the localized `"mobile.sheet.region"` string

- [ ] **Step 2: Implement the shared primitive**

Requirements:

- export `Sheet` and its prop types from the public UI barrel
- keep the prop surface aligned with the current feature-owned mobile shell:
  - `title`
  - `body`
  - `onClose`
  - optional `kicker`
  - optional `onBack`
  - optional `footer`
  - optional `headerAction`
  - optional `bodyClassName`
  - optional `contentClassName`
  - optional `fullscreen`
  - optional `backLabel`
- preserve the current `.mobile-sheet*` DOM and class contract exactly so:
  - `Select` can still detect nested `.mobile-sheet`
  - existing style-theme tests remain valid
  - feature callers do not visually regress
- reuse the existing `PageHeader` for this bounded phase rather than introducing a new sheet header abstraction
- do not introduce portal rendering, focus trapping, desktop drawer behavior, or compositional `SheetHeader` / `SheetBody` / `SheetFooter` APIs in this phase

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/sheet/index.test.tsx
```

Expected: all shared sheet tests pass.

## Task 3: Migrate the Bounded Mobile Callers

**Files:**
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add or tighten assertions that confirm:

- mobile `CommandPalette` renders through the shared UI `Sheet` import rather than the feature-owned shell while preserving filtering behavior
- mobile `WorktreeModal` still renders one bottom sheet shell, loads status content, and allows tab changes
- mobile `WorkspaceLaunchModal` still renders fullscreen sheet chrome, browse actions, and the mobile footer CTA
- these callers still expose the bounded legacy `.mobile-sheet*` classes relied on by current styles and tests

- [ ] **Step 2: Replace feature-owned sheet imports**

Requirements:

- import `Sheet` from `packages/web/src/components/ui/index.ts` only
- remove direct `MobileSheet` imports from the three bounded callers above
- keep all caller-owned state, branching, and business logic in feature code
- preserve current mobile-only copy, header actions, bodyClassName/contentClassName composition, and footer behavior
- do not migrate `MobileSupervisorSheet`, `MobileSelectSheet`, or `WorkspaceMobileView` in this phase

- [ ] **Step 3: Run the focused integration tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/sheet/index.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected: all tests pass.

## Task 4: Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Export and document the component**

Requirements:

- add `Sheet` to the UI barrel
- add `Sheet` to `components/ui/README.md` with a bounded summary that it is currently the shared mobile bottom-sheet shell
- update `MIGRATION.md` to mark `Sheet` as partial and note the remaining deferred callers (`MobileSupervisorSheet`, `MobileSelectSheet`, and the route-driven `WorkspaceMobileView` sheet orchestration)

- [ ] **Step 2: Run the full phase-p verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/sheet/index.test.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/sheet \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/features/command-palette/components/command-palette.tsx \
  src/features/command-palette/components/command-palette.test.tsx \
  src/features/workspace/views/shared/worktree-modal.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.tsx \
  src/features/workspace/views/shared/workspace-launch-modal.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining bounded feature-owned sheet callers**

Run:

```bash
rg -n "import .*MobileSheet|from \".*mobile-sheet\"" \
  packages/web/src/features \
  -g '!**/*.test.tsx'
```

Expected: remaining hits are only the intentionally deferred callers for this phase, not the three bounded migrations above.

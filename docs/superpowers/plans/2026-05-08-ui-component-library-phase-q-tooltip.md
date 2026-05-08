# UI Component Library Phase Q Tooltip Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Tooltip` primitive in `components/ui`, then migrate a bounded first batch of icon-trigger tooltip callers away from raw `title` attributes.

**Architecture:** Phase Q keeps `Tooltip` intentionally small and presentational. Implement a shared tooltip shell that renders a portal-positioned hover/focus label on desktop pointers, becomes a strict no-op wrapper on coarse/mobile pointers per the design spec, and leaves the trigger element otherwise untouched. This phase only migrates the clearest topbar-style icon actions that already have visible-label or `aria-label` fallbacks; it does not absorb complex truncation/tooltips, rich popovers, menus, or code-editor/git-panel interaction families.

**Tech Stack:** React 19, TypeScript 6, Vitest + Testing Library, `react-dom` portal, shared `useViewport()`, existing i18n, existing token z-index values.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/tooltip/index.tsx`
- `packages/web/src/components/ui/tooltip/index.module.css`
- `packages/web/src/components/ui/tooltip/index.test.tsx`
- `packages/web/src/components/ui/tooltip/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/topbar/index.tsx`
- `packages/web/src/features/topbar/index.test.tsx`
- `packages/web/src/features/workspace/components/workspace-fullscreen-button.tsx`
- `packages/web/src/features/workspace/components/workspace-fullscreen-button.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/topbar/components/tab.tsx`
- `packages/web/src/features/topbar/components/connection-status.tsx`
- `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- any `Popover`, `ActionMenu`, `Select`, or `Sheet` work
- any truncation-only native `title` attribute usage for overflow text

## Task 1: Capture Bounded Tooltip Scope

**Files:** none

- [ ] **Step 1: Record the in-scope first-batch callers**

Current callers in scope:

- `packages/web/src/features/topbar/index.tsx`
  - add-workspace icon button
  - quick-actions icon/text action
  - terminal visibility toggle
  - files visibility toggle
  - settings icon button
- `packages/web/src/features/workspace/components/workspace-fullscreen-button.tsx`
  - fullscreen toggle icon button

Current non-goals for this phase:

- overflow/truncation-only `title` usage such as workspace path tabs, file paths, and config paths
- status badges or containers that use `title` without an interactive trigger wrapper
- git toolbar actions and code-editor icon actions
- any mobile long-press tooltip behavior

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/topbar/index.test.tsx \
  src/features/workspace/components/workspace-fullscreen-button.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Tooltip`

**Files:**
- Create: `packages/web/src/components/ui/tooltip/index.tsx`
- Create: `packages/web/src/components/ui/tooltip/index.module.css`
- Create: `packages/web/src/components/ui/tooltip/index.test.tsx`
- Create: `packages/web/src/components/ui/tooltip/README.md`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <Tooltip content="Quick Actions">
    <button type="button">Trigger</button>
  </Tooltip>
);
```

and assertions for:

- desktop/fine-pointer rendering shows tooltip content on hover and focus
- blur and pointer leave hide the tooltip again
- the tooltip renders through a portal attached to `document.body`
- the trigger receives `aria-describedby` only while the tooltip is visible
- `disabled` suppresses tooltip rendering
- coarse/mobile viewport makes the wrapper a no-op that never opens a tooltip

- [ ] **Step 2: Implement the shared primitive**

Requirements:

- export `Tooltip` and its prop types from the public UI barrel
- public API stays bounded:
  - `content`
  - `children`
  - optional `disabled`
- clone exactly one trigger element and preserve caller props/handlers
- use shared `useViewport()` so mobile/coarse pointers become a no-op wrapper
- keep the tooltip itself simple:
  - text-only content for this phase
  - top-centered positioning relative to trigger using bounding-rect math
  - portal to `document.body`
  - `role="tooltip"`
- do not introduce Floating UI, delayed open timers, arrow graphics, placement variants, or long-press mobile behavior in this phase

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tooltip/index.test.tsx
```

Expected: all shared tooltip tests pass.

## Task 3: Migrate the Bounded Trigger Callers

**Files:**
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/topbar/index.test.tsx`
- Modify: `packages/web/src/features/workspace/components/workspace-fullscreen-button.tsx`
- Modify: `packages/web/src/features/workspace/components/workspace-fullscreen-button.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add or tighten assertions that confirm:

- topbar actions still expose the same accessible button names
- desktop rendering can show shared tooltip content for the bounded actions
- mobile/coarse rendering does not render tooltip overlays
- fullscreen toggle still calls `toggleFullscreen` and now uses the shared tooltip wrapper without losing its button semantics

- [ ] **Step 2: Replace raw `title` attributes with shared `Tooltip` wrappers**

Requirements:

- import `Tooltip` from `packages/web/src/components/ui/index.ts` only
- migrate only the bounded callers listed in Task 1
- preserve existing `aria-label` values and visible labels
- remove redundant native `title` attributes from migrated triggers so the shared primitive is the only hover/focus presenter
- do not migrate truncation-only `title` attributes or non-interactive containers in this phase

- [ ] **Step 3: Run the focused integration tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tooltip/index.test.tsx \
  src/features/topbar/index.test.tsx \
  src/features/workspace/components/workspace-fullscreen-button.test.tsx
```

Expected: all tests pass.

## Task 4: Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Export and document the component**

Requirements:

- add `Tooltip` to the UI barrel
- add `Tooltip` to `components/ui/README.md` with a bounded summary that it is desktop/fine-pointer only in this phase and becomes a no-op on coarse/mobile pointers
- update `MIGRATION.md` to mark `Tooltip` as partial and note the remaining deferred families:
  - truncation/path `title` callers
  - connection-status/container title usage
  - code-editor and git-panel icon-action families

- [ ] **Step 2: Run the full phase-q verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tooltip/index.test.tsx \
  src/features/topbar/index.test.tsx \
  src/features/workspace/components/workspace-fullscreen-button.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/tooltip \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/features/topbar/index.tsx \
  src/features/topbar/index.test.tsx \
  src/features/workspace/components/workspace-fullscreen-button.tsx \
  src/features/workspace/components/workspace-fullscreen-button.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining deferred tooltip-like callers**

Run:

```bash
rg -n "title=\\{|title=\\\"|title=\\{label\\}|title=\\{t\\(" \
  packages/web/src/features/topbar \
  packages/web/src/features/workspace/components \
  packages/web/src/features/workspace/views/shared \
  packages/web/src/features/code-editor/views/shared \
  -g '!**/*.test.tsx'
```

Expected: remaining hits are only the intentionally deferred families for this phase, not the bounded topbar/fullscreen triggers migrated above.

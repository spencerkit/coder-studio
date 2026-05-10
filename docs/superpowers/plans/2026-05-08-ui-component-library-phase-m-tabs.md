# UI Component Library Phase M Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Tabs` primitive in `components/ui` and migrate the bounded workspace content-switching tab bars that currently hand-roll the same selected-state/tablist shell.

**Architecture:** Implement `Tabs` as a presentational compound primitive under `packages/web/src/components/ui/tabs/` with controlled value state plus `TabList`, `Tab`, and optional `TabPanel` parts. This phase only migrates bounded content-switching tab bars that match the design-system `Tabs` semantics: workspace sidebar `Files/Git` in desktop and mobile files sheets, plus `WorktreeModal` `Status/Diff/Tree`. It explicitly does not absorb navigation tabs (`topbar-tab`) or pill/segmented selectors that belong to a later `SegmentedControl` slice.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing app tokens.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/tabs/index.tsx`
- `packages/web/src/components/ui/tabs/index.module.css`
- `packages/web/src/components/ui/tabs/index.test.tsx`
- `packages/web/src/components/ui/tabs/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- `packages/web/src/features/workspace/index.test.tsx`
- `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- `packages/web/src/shells/mobile-shell/index.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/topbar/*`
- `packages/web/src/features/settings/components/provider-settings.tsx`
- `packages/web/src/features/settings/components/shortcuts-settings.tsx`
- any `SegmentedControl`, `Tooltip`, `Select`, `Popover`, `ActionMenu`, or `Sheet` work

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded tabs caller inventory**

Current callers in scope:

- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx` (`panel-tabs`, `panel-tab`)
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx` (`panel-tabs`, `panel-tab`, `role="tablist"`)
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx` (`worktree-tabs`, `worktree-tab`)

Current non-goals:

- `topbar-tab` workspace navigation
- `settings-provider-tab` and `settings-provider-subnav-button`
- `shortcuts-category-tab`
- any “segmented” or pill selector work

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Tabs`

**Files:**
- Create: `packages/web/src/components/ui/tabs/*`
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing shared component tests**

Cover shared usage like:

```tsx
render(
  <Tabs aria-label="Workspace sections" value="files" onValueChange={setValue}>
    <TabList className="panel-tabs">
      <Tab className="panel-tab" value="files">Files</Tab>
      <Tab className="panel-tab" value="git">Git</Tab>
    </TabList>
    <TabPanel value="files">Files panel</TabPanel>
    <TabPanel value="git">Git panel</TabPanel>
  </Tabs>
);
```

and assertions for:

- `Tabs` provides `role="tablist"` / `role="tab"` / `role="tabpanel"` semantics
- the active tab gets `aria-selected="true"` and inactive tabs `false`
- clicking a tab calls `onValueChange` with the tab `value`
- legacy compatibility classes can still be composed on list/tab roots via `className`
- callers can omit `TabPanel` and still use `Tabs` only as a controlled tab bar

- [ ] **Step 2: Implement `Tabs` compound primitive**

Requirements:

- public API exports `Tabs`, `TabList`, `Tab`, `TabPanel`, and relevant prop types
- `Tabs` accepts controlled `value`, `onValueChange`, optional `orientation`, optional `className`, and pass-through props
- `TabList` / `Tab` / `TabPanel` stay presentational and controlled; no routing or feature state inside the primitive
- `Tab` renders a real button with `role="tab"` and composes caller classes
- active state composes both module styles and existing legacy classes like `.active`
- CSS module owns generic line-tab shell with touch-friendly sizing and horizontal overflow compatibility for mobile tab bars
- do not hard-code feature-specific class names such as `panel-tab` or `worktree-tab` inside the primitive

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tabs/index.test.tsx
```

Expected: all shared tabs tests pass.

## Task 3: Migrate Workspace Tab Bars

**Files:**
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- Modify: `packages/web/src/features/workspace/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- Modify: `packages/web/src/shells/mobile-shell/index.test.tsx`

- [ ] **Step 1: Write failing integration assertions**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("tablist")).toBeInTheDocument();
expect(screen.getByRole("tab", { name: "Files" })).toHaveAttribute("aria-selected", "true");
expect(screen.getByRole("tab", { name: "Git" })).toHaveClass("panel-tab");
```

and preserve:

- desktop workspace sidebar still switches between `FileTreePanel` and `GitPanel`
- mobile files sheet still exposes real tab semantics and opens diff from the `Git` tab
- worktree modal still fetches the correct command when switching to `Diff` or `Tree`
- legacy compatibility classes remain on rendered tab elements (`panel-tab`, `worktree-tab`, and active class expectations where appropriate)

- [ ] **Step 2: Replace raw tab markup with shared primitive**

Requirements:

- import `Tabs` pieces from the public UI barrel
- keep feature state (`sidebarTab`, `setSidebarTab`, `activeTab`, `handleTabChange`) in feature code
- keep `GitStatusBar`, branch switcher buttons, and all panel/modal content ownership in feature code
- preserve current labels, keyboard semantics, and legacy classes by composing them on `TabList` / `Tab`
- do not force `TabPanel` usage where callers already branch content outside the tab bar; use only the pieces that fit each caller

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tabs/index.test.tsx \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/shells/mobile-shell/index.test.tsx
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

- add `Tabs` pieces to the UI barrel
- add `Tabs` to `components/ui/README.md` with its Tier 1 summary
- update `MIGRATION.md` to reflect the bounded tabs migration status and remaining caller count

- [ ] **Step 2: Run the full phase-m verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/tabs/index.test.tsx \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/tabs \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/workspace/views/desktop/workspace-desktop-view.tsx \
  src/features/workspace/views/mobile/mobile-files-sheet.tsx \
  src/features/workspace/views/shared/worktree-modal.tsx \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/shells/mobile-shell/index.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining bounded raw tabs callers**

Run:

```bash
rg -n "panel-tab|worktree-tab|role=\"tablist\"|role=\"tab\"" packages/web/src -g '!**/*.css'
```

Expected: remaining hits are the shared tabs primitive itself, its tests/docs, migrated feature code intentionally using the shared primitive, and intentionally deferred out-of-scope families such as `topbar-tab`, provider/shortcuts segmented selectors, or other non-bounded callers.

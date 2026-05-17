# PC Style Polish Phase 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tighten the remaining desktop panel chrome in file tree, git panel, and command palette, then expand desktop review coverage for the most visible workspace states.

**Architecture:** Keep the existing desktop workspace structure intact and polish the panel surfaces in place. Use CSS/token tweaks for the visual system, add focused tests for desktop-only selectors and theme rules, and reinforce the result with deterministic `ui-preview` scenes plus desktop capture coverage.

**Tech Stack:** React, TypeScript, Jotai, Vitest, Playwright `e2e-ui`, CSS tokens in `packages/web/src/styles`

---

### Task 1: Tighten the desktop file tree panel

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing test**

Add a focused desktop assertion in `file-tree-panel.test.tsx` that checks:
- the desktop shell still renders `.file-tree-shell.file-tree-shell--desktop`
- the search bar and selected row stay in the same chrome family as the desktop panel
- the selected row keeps its selected class when the active path matches

Add CSS assertions in `components.theme.test.ts` that check:
- `.file-tree-shell .file-tree-search` has the tighter desktop chrome used by the panel
- `.file-tree-shell .tree-item` keeps the desktop row density and hover transition
- `.file-tree-shell .tree-item.selected` uses the desktop active surface language

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx src/styles/components.theme.test.ts`

Expected:
- the new desktop selector expectations fail until the panel chrome is tightened

- [ ] **Step 3: Implement the desktop file tree polish**

In `file-tree-panel.tsx`:
- keep the data flow unchanged
- keep using the existing `selected` class for the active row

In `components.css`:
- tighten `.file-tree-shell .file-tree-search`
- tighten `.file-tree-shell .tree-item`
- tighten `.file-tree-shell .tree-item.selected`
- keep mobile rules intact under `.file-tree-shell--mobile`

- [ ] **Step 4: Re-run the focused test and verify green**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx src/styles/components.theme.test.ts`

Expected:
- both test files pass with `0 failed`

### Task 2: Tighten the desktop git panel and desktop command palette

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.test.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Write the failing tests**

Add desktop assertions in `git-panel.test.tsx` that check:
- the desktop panel keeps `.git-panel.git-panel--desktop`
- `.git-commit-block`, `.git-panel-section`, `.git-worktree-row`, and `.git-history-row` all stay present in the desktop chrome
- at least one active change row still renders with the `.active` class

Add desktop assertions in `command-palette.test.tsx` that check:
- the desktop overlay still renders `.command-palette-overlay` and `.command-palette`
- the header, search, hint, and list remain present as desktop chrome
- filtered items still render with `.command-palette-item-selected` when keyboard navigation moves selection

Add CSS assertions in `components.theme.test.ts` that check:
- `.git-panel-scroll`, `.git-commit-block`, `.git-panel-section`, `.git-worktree-row`, and `.git-history-row` follow the tighter desktop density
- `.command-palette`, `.command-palette-header`, `.command-palette-search`, and `.command-palette-item` use the desktop tool surface language

- [ ] **Step 2: Run the focused tests and verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx src/features/command-palette/components/command-palette.test.tsx src/styles/components.theme.test.ts`

Expected:
- the new desktop selector expectations fail until the git panel and command palette chrome are tightened

- [ ] **Step 3: Implement the desktop git panel and command palette polish**

In `git-panel.tsx` and `command-palette.tsx`:
- keep behavior unchanged
- keep mobile / desktop branching unchanged
- only adjust the desktop chrome classes and structure where needed for consistent spacing and hierarchy

In `components.css`:
- tighten the desktop `.git-panel-*` rules for commit, section, worktree, change, and history rows
- tighten the desktop `.command-palette-*` rules for overlay, palette, header, search, hint, list, item, and shortcut chip
- keep mobile sheet rules unchanged

- [ ] **Step 4: Re-run the focused tests and verify green**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx src/features/command-palette/components/command-palette.test.tsx src/styles/components.theme.test.ts`

Expected:
- all selected tests pass with `0 failed`

### Task 3: Expand desktop review scenes for workspace panel density

**Files:**
- Modify: `packages/web/src/ui-preview/scenes/desktop-review-scenes.tsx`
- Modify: `packages/web/src/ui-preview/scene-metadata.ts`
- Modify: `packages/web/src/ui-preview/scene-metadata.test.ts`
- Modify: `packages/web/src/ui-preview/catalog.test.tsx`

- [ ] **Step 1: Write the failing preview tests**

Add metadata assertions that confirm the desktop review catalog still includes:
- `workspace-sidebar-files-review`
- `workspace-sidebar-git-review`
- `command-palette`

Add catalog assertions that check:
- the file-tree review scene renders seeded file hierarchy chrome
- the git review scene renders seeded commit / worktree / history chrome
- the command palette scene renders the desktop overlay chrome and selected item state

- [ ] **Step 2: Run the focused preview tests and verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx`

Expected:
- the new desktop chrome expectations fail until the review scenes are updated to match the tightened panels

- [ ] **Step 3: Update the review scenes and metadata**

In `desktop-review-scenes.tsx`:
- keep the seeded data deterministic
- enrich the existing `workspace-sidebar-files-review` and `workspace-sidebar-git-review` scenes with denser desktop panel state so the new chrome rules are visible in screenshots
- keep `command-palette` as the canonical desktop palette review scene

In `scene-metadata.ts`:
- keep the existing scene ids registered
- update descriptions only if the scene surface changed

- [ ] **Step 4: Re-run the focused preview tests and verify green**

Run: `pnpm --filter @coder-studio/web exec vitest run src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx`

Expected:
- both preview test files pass with `0 failed`

### Task 4: Run regression verification for the phase-3 polish slice

**Files:**
- No code changes required unless regressions surface

- [ ] **Step 1: Re-run targeted component, style, and preview tests**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/file-tree-panel.test.tsx src/features/workspace/views/shared/git-panel.test.tsx src/features/command-palette/components/command-palette.test.tsx src/styles/base.theme.test.ts src/styles/components.theme.test.ts src/ui-preview/scene-metadata.test.ts src/ui-preview/catalog.test.tsx`

Expected:
- all selected tests pass

- [ ] **Step 2: Re-run targeted desktop captures**

Run: `pnpm --dir e2e-ui exec playwright test --config playwright.config.ts --project desktop --workers 4 --grep '(workspace-sidebar-files-review|workspace-sidebar-git-review|command-palette|workspace-topbar-review|desktop-overlay-review|desktop-statusbar-review) \\[desktop/'`

Expected:
- the desktop review capture matrix passes for the touched scenes

- [ ] **Step 3: Rebuild the report**

Run: `pnpm --dir e2e-ui exec tsx report/build-report.ts`

Expected:
- report command exits `0`

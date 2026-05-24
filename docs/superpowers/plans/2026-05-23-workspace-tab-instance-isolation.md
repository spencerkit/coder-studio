# Workspace Tab Instance Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each workspace behave like its own tab instance with isolated layout state and isolated panel/view state.

**Architecture:** Introduce workspace-scoped layout buckets for persistent state, keep adapter atoms for the active workspace, and move panel-local state that must restore across workspace switches into workspace-scoped in-memory buckets. Key the workspace root by `workspace.id` so React never reuses one instance across different workspaces.

**Tech Stack:** React 19, Jotai, Vitest, Testing Library

---

### Task 1: Lock the bug with integration tests

**Files:**
- Modify: `packages/web/src/features/workspace/index.test.tsx`
- Test: `packages/web/src/features/workspace/index.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add one test that proves the sidebar tab and terminal/sidebar layout state are isolated between `ws-a` and `ws-b`, and another test that proves content search query/results restore when switching back to the original workspace.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/index.test.tsx -t "workspace-scoped"`
Expected: FAIL because the current implementation reuses shared workspace UI state.

### Task 2: Implement workspace-scoped layout state

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/layout.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-layout-actions.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/features/topbar/index.tsx`
- Modify: `packages/web/src/features/command-palette/components/command-palette.tsx`
- Modify: `packages/web/src/features/focus-mode/components/focus-mode.tsx`

- [ ] **Step 1: Add workspaceId-keyed layout state families and active-workspace adapter atoms**
- [ ] **Step 2: Update layout actions and screen model to read/write the correct workspace bucket**
- [ ] **Step 3: Update topbar, command palette, and focus mode to operate on the active workspace bucket**
- [ ] **Step 4: Run the targeted workspace integration test and fix any regressions**

### Task 3: Implement workspace-scoped panel instance state

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/layout.ts`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/search-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`

- [ ] **Step 1: Add workspace-scoped state buckets for panel/session state that must restore on tab switch**
- [ ] **Step 2: Key the workspace root by `workspace.id`**
- [ ] **Step 3: Move search, git panel, file tree search, and screen model local state into workspace buckets**
- [ ] **Step 4: Run the targeted search restoration test and keep both tests green**

### Task 4: Verify affected focused tests

**Files:**
- Test: `packages/web/src/features/workspace/index.test.tsx`
- Test: `packages/web/src/features/workspace/views/shared/search-panel.test.tsx`
- Test: `packages/web/src/features/topbar/index.test.tsx`

- [ ] **Step 1: Run the targeted suite**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/index.test.tsx src/features/workspace/views/shared/search-panel.test.tsx src/features/topbar/index.test.tsx`
Expected: PASS

- [ ] **Step 2: Review diff for unintended cross-workspace behavior changes**

Run: `git diff -- packages/web/src/features/workspace packages/web/src/features/topbar`
Expected: only workspace instance isolation changes

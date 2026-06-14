# Supervisor Plan Tree Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the supervisor plan tree so it renders as an expandable hierarchy with clear indentation and active-node emphasis.

**Architecture:** Keep the current `SupervisorTargetMemory.planTree` data model intact and update only the web detail view. Introduce local tree expansion state in the shared supervisor details component, defaulting to a collapsed tree with the active path opened when available. Update styles to make parent/child structure obvious and make the active node visually distinct.

**Tech Stack:** React, TypeScript, Jotai, Vitest, Testing Library, existing app CSS, Lucide icons.

---

### Task 1: Add regression tests for expandable supervisor tree behavior

**Files:**
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("keeps plan tree children collapsed until the user expands a node", () => {
  // render a planTree with children and no active path
  // expect the child node not to be visible initially
  // click the root expand button
  // expect the child node to become visible
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx`
Expected: FAIL because the tree has no expand/collapse control yet and children are rendered immediately.

- [ ] **Step 3: Write minimal implementation**

No code yet.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx`
Expected: PASS after the tree interaction is implemented.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/supervisor/views/shared/supervisor-details-content.test.tsx
git commit -m "test: cover expandable supervisor plan tree"
```

### Task 2: Implement expandable supervisor plan tree UI

**Files:**
- Modify: `packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing test**

Use the regression test from Task 1.

- [ ] **Step 2: Run test to verify it fails**

Run the same focused Vitest command and confirm the tree interaction is still missing.

- [ ] **Step 3: Write minimal implementation**

Add local expanded-node state, tree toggle buttons, active-path aware default expansion, and tree styling with indentation and highlight states.

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/supervisor/views/shared/supervisor-details-content.tsx packages/web/src/styles/components.css packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat: render supervisor plan tree as expandable hierarchy"
```

### Task 3: Verify related supervisor tests

**Files:**
- Modify: none

- [ ] **Step 1: Run the focused supervisor UI tests**

Run:
`pnpm --filter @coder-studio/web exec vitest run src/features/supervisor/views/shared/supervisor-details-content.test.tsx src/features/supervisor/views/mobile/mobile-supervisor-sheet.test.tsx`

- [ ] **Step 2: Confirm the supervisor error/detail regression still passes**

Expected: both suites pass and the details panel still renders during error state.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "test: verify supervisor detail tree rendering"
```

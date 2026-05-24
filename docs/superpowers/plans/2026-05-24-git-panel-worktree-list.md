# Git Panel Worktree List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clean up the Git panel compact worktree list by shortening branch refs, adding inline delete for removable worktrees, and exposing the full manager list view from the panel.

**Architecture:** Keep the existing worktree commands and action hook intact. Update the Git panel to derive a compact branch label, split each row into a main open/switch button plus an optional delete button, and reuse the already-mounted `WorktreeManagerSurface` for a new `Manage` entry point.

**Tech Stack:** React 19, Jotai, Testing Library, Vitest, shared Button/IconButton/ConfirmDialog primitives, existing worktree action hooks, and shared CSS assertions in `packages/web/src/styles/components.theme.test.ts`.

**Spec reference:** `docs/superpowers/specs/2026-05-24-git-panel-worktree-list-design.md`

---

## File Structure

**Modify:**
- `packages/web/src/features/workspace/views/shared/git-panel.tsx` — compact worktree row rendering, manage entry point, delete confirm state, branch label formatting
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx` — focused behavior coverage for compact list management and delete actions
- `packages/web/src/styles/components.css` — compact row/action layout updates for split controls
- `packages/web/src/styles/components.theme.test.ts` — keep compact row size assertions aligned with the new structure

**Testing commands used in this plan:**
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx`
- `pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts`
- `pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx src/styles/components.theme.test.ts`

---

### Task 1: Add Failing Git Panel Tests

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`

- [ ] **Step 1: Write the failing test for compact branch display**

Add a test that seeds a worktree branch as `refs/heads/develop`, expands the worktree section, and expects:

```ts
expect(screen.getByText("develop")).toBeInTheDocument();
expect(screen.queryByText("refs/heads/develop")).toBeNull();
```

- [ ] **Step 2: Write the failing test for the manage entry point**

Add a test that clicks the Git panel `Manage` action and expects the full manager surface to appear:

```ts
fireEvent.click(screen.getByRole("button", { name: "Manage" }));
expect(await screen.findByRole("dialog", { name: "Worktrees" })).toBeInTheDocument();
```

- [ ] **Step 3: Write the failing test for inline delete on removable worktrees**

Add a test that expands the worktree list and asserts:

```ts
expect(screen.queryByRole("button", { name: "Remove feature/ai-agent" })).toBeNull();
expect(screen.queryByRole("button", { name: "Remove develop" })).toBeNull();
expect(screen.getByRole("button", { name: "Remove performance-monitoring" })).toBeInTheDocument();
```

- [ ] **Step 4: Write the failing test for dirty delete dispatch**

Add a test that clicks the removable dirty worktree delete button, confirms the destructive action, and expects:

```ts
expect(sendCommand).toHaveBeenCalledWith(
  "worktree.remove",
  {
    workspaceId: "ws-test",
    worktreePath: "/home/spencer/workspace/coder-studio-performance-monitoring",
    force: true,
  },
  undefined
);
```

- [ ] **Step 5: Run the Git panel test file to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx
```

Expected:
- FAIL because the current compact list still renders full refs, has no `Manage` action, and has no inline delete button

---

### Task 2: Implement Compact Row Management and Delete

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`

- [ ] **Step 1: Add compact branch formatting and removable-row rules**

Add a small helper in `git-panel.tsx`:

```ts
function formatCompactWorktreeBranch(branch: string) {
  return branch.startsWith("refs/heads/") ? branch.slice("refs/heads/".length) : branch;
}
```

Use the row index to keep the first worktree non-removable, and treat the current worktree as non-removable.

- [ ] **Step 2: Add manage entry point and row-level delete state**

Extend local Git panel state with:

```ts
pendingWorktreeDeletePath: string | null;
```

Expose a `Manage` section-link action that sets:

```ts
worktreeSurfaceView: "list"
```

Also add helpers to open/close compact delete confirmation.

- [ ] **Step 3: Split each compact row into main/open and delete controls**

Replace the single row button with a row container:

```tsx
<div className={`git-worktree-row ${isCurrent ? "active" : ""}`}>
  <button type="button" className="git-worktree-row__main" onClick={...}>
    ...
  </button>
  {isRemovable ? (
    <IconButton
      aria-label={t("worktree.remove_row_label", { name: worktree.name })}
      className="git-worktree-row__delete"
      icon={<Minus size={12} />}
      onClick={...}
      size="sm"
      type="button"
      variant="ghost"
    />
  ) : null}
</div>
```

Use `formatCompactWorktreeBranch(worktree.branch)` in the meta line.

- [ ] **Step 4: Reuse existing delete command behavior**

Wire confirm handling to:

```ts
await removeWorktreeByPath(target.path, target.status === "dirty");
```

On success, close the compact delete dialog.
On failure, keep the dialog open and show the returned error message.

- [ ] **Step 5: Run the Git panel tests to verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/git-panel.test.tsx
```

Expected:
- PASS

---

### Task 3: Update Compact Row Styling and Verify

**Files:**
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Update compact row CSS for split controls**

Adjust `.git-worktree-row` to remain the outer container and add:

```css
.git-worktree-row__main {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border: 0;
  background: transparent;
  color: inherit;
  text-align: left;
}

.git-worktree-row__delete {
  flex-shrink: 0;
}
```

Keep compact density consistent with the existing tool-surface row height expectations.

- [ ] **Step 2: Keep theme assertions aligned with the compact row density**

Update `components.theme.test.ts` only if the selector coverage needs to assert the new structure while preserving:

```ts
expect(gitWorktreeRow).toContain("min-height: 28px");
```

- [ ] **Step 3: Run style/theme verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/components.theme.test.ts
```

Expected:
- PASS

---

### Task 4: Run Final Focused Verification

**Files:**
- No file changes

- [ ] **Step 1: Run the focused verification bundle**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/styles/components.theme.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Review output for regressions**

Confirm the run shows:

- Git panel tests passing
- theme/style tests passing
- no new failing worktree-manager behavior in the touched surface

- [ ] **Step 3: Commit**

Run:

```bash
git add \
  docs/superpowers/specs/2026-05-24-git-panel-worktree-list-design.md \
  docs/superpowers/plans/2026-05-24-git-panel-worktree-list.md \
  packages/web/src/features/workspace/views/shared/git-panel.tsx \
  packages/web/src/features/workspace/views/shared/git-panel.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/styles/components.theme.test.ts
git commit -m "feat: refine git panel worktree list actions"
```

Expected:
- commit created with only the intended files staged

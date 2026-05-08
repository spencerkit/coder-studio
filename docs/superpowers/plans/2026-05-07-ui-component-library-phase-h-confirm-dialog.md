# UI Component Library Phase H ConfirmDialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `ConfirmDialog` convenience wrapper on top of `Modal`, then migrate the bounded destructive confirmation flows that already match that shape.

**Architecture:** Implement `ConfirmDialog` in `packages/web/src/components/ui/confirm-dialog/` as a thin composition of `Modal`, `ModalHeader`, `ModalBody`, and `ModalFooter`, with built-in close affordance and tone-driven confirm action styling. Keep this slice intentionally narrow: only migrate simple confirm/cancel dialogs with static body copy, while leaving form dialogs, auth dialogs, and richer custom layouts on raw `Modal`.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing shared `Modal`, `Button`, and `IconButton` primitives.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/confirm-dialog/index.tsx`
- `packages/web/src/components/ui/confirm-dialog/index.module.css`
- `packages/web/src/components/ui/confirm-dialog/index.test.tsx`
- `packages/web/src/components/ui/confirm-dialog/README.md`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx` `CreatePathModal`
- `packages/web/src/features/workspace/views/mobile/*`
- `packages/web/src/components/ui/sheet/*`
- `packages/web/src/components/ui/toast/*`

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the bounded confirmation callers in this slice**

Bounded targets:

- `DeleteFileModal` in `file-tree-panel.tsx`
- `GitDiscardConfirmModal` in `git-panel.tsx`

Explicitly out of scope for this phase:

- `CreatePathModal` because it contains form fields and custom focus targeting
- `GitStatusBar` because it has confirm/auth dual-state behavior
- `ObjectiveDialog` because it has custom header/body structure and richer actions

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `ConfirmDialog`

**Files:**
- Create: `packages/web/src/components/ui/confirm-dialog/*`
- Modify: `packages/web/src/components/ui/index.ts`

- [ ] **Step 1: Write failing `ConfirmDialog` tests**

Cover a default and destructive case like:

```tsx
render(
  <ConfirmDialog
    open
    onOpenChange={vi.fn()}
    title="Delete file"
    description="This action cannot be undone."
    confirmText="Delete"
    cancelText="Cancel"
    tone="danger"
    onConfirm={vi.fn()}
  />
);
```

and assertions for:

- `role="dialog"` being rendered through the shared `Modal`
- danger tone rendering a destructive confirm button and warning icon treatment
- default tone rendering a primary confirm button
- description accepting rich `ReactNode` content
- close button, cancel button, overlay click, and `Escape` all delegating through `onOpenChange(false)`
- confirm button invoking `onConfirm` without changing the shared button compatibility classes

- [ ] **Step 2: Implement `ConfirmDialog` as a thin `Modal` wrapper**

Requirements:

- public API exports `ConfirmDialog` plus its prop type
- component accepts `open`, `onOpenChange`, `title`, `description`, `confirmText`, `cancelText`, and `tone`
- component also supports the operational props needed by callers in this codebase: `onConfirm`, `className`, `dismissible`, `closeLabel`, `confirmDisabled`, and `confirmButtonProps`
- use `Modal`, `ModalHeader`, `ModalTitle`, `ModalBody`, `ModalFooter`, `Button`, and `IconButton` from the public barrel
- render the close button in the header and keep legacy `btn btn-ghost btn-sm` compatibility via the shared `IconButton`
- map `tone="danger"` to the destructive confirm button variant and include the warning icon in the title row by default
- keep styling minimal; use `index.module.css` only for any wrapper/body spacing the shared modal styles do not already cover

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/confirm-dialog/index.test.tsx
```

Expected: all `ConfirmDialog` tests pass.

## Task 3: Migrate `DeleteFileModal`

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`

- [ ] **Step 1: Write failing feature assertions**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Confirm" })).toHaveClass("btn", "btn-danger");
expect(screen.getByRole("button", { name: "Close" })).toHaveClass("btn", "btn-ghost", "btn-sm");
```

and delete flows that continue to require explicit confirmation before dispatching `file.delete`.

- [ ] **Step 2: Replace `DeleteFileModal` with the shared convenience wrapper**

Requirements:

- remove the raw `Modal`/`ModalHeader`/`ModalBody`/`ModalFooter` composition from `DeleteFileModal`
- use `ConfirmDialog` with `tone="danger"`
- preserve the translated title, confirmation copy, optional error message, and explicit cancel/confirm actions
- keep dismiss behavior wired to the existing `onCancel`
- keep the current delete action async path exactly as it is today

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/confirm-dialog/index.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx
```

Expected: all tests pass.

## Task 4: Migrate `GitDiscardConfirmModal`

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`

- [ ] **Step 1: Write failing feature assertions**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(screen.getByRole("button", { name: /^Discard$/ })).toHaveClass("btn", "btn-danger");
expect(screen.getByText("This action cannot be undone.")).toBeInTheDocument();
```

and the existing single-file and discard-all flows continuing to wait for explicit confirmation before dispatch.

- [ ] **Step 2: Replace `GitDiscardConfirmModal` with `ConfirmDialog`**

Requirements:

- remove the local modal shell and reuse `ConfirmDialog`
- preserve the translated single-file vs discard-all title and message branching
- keep the irreversible helper copy visible by passing rich description content
- keep the existing cancel and destructive confirm wiring untouched
- preserve the close button affordance and shared button compatibility classes through the reusable component

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/confirm-dialog/index.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx
```

Expected: all tests pass.

## Task 5: Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Export and document the component**

Requirements:

- add `ConfirmDialog` to the public barrel
- add `ConfirmDialog` to `components/ui/README.md` with its Tier 1 API summary
- update `MIGRATION.md` to reflect the bounded `ConfirmDialog` migration status and remaining callers

- [ ] **Step 2: Run the full phase-h verification set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/modal/index.test.tsx \
  src/components/ui/confirm-dialog/index.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx
```

and:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/confirm-dialog \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/features/workspace/views/shared/file-tree-panel.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx
```

Expected: tests pass and biome reports no issues.

- [ ] **Step 3: Re-scan for remaining easy `ConfirmDialog` candidates**

Run:

```bash
rg -n "ModalFooter|AlertTriangle|action\\.cancel|action\\.confirm|action\\.discard" \
  packages/web/src/features -g '!**/*.css'
```

Expected: remaining hits are either already migrated, intentionally custom, or require richer dialog bodies that stay on raw `Modal`.

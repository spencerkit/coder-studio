# UI Component Library Phase G Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a shared `Modal` primitive, migrate the bounded desktop raw `.modal-*` callers to it, and preserve current close, focus, sizing, and mobile branching behavior.

**Architecture:** Implement `Modal` as a portal-backed dialog primitive in `packages/web/src/components/ui/modal/`, with small shared internals for portal mounting, dismiss handling, and focus trapping. Keep this slice tightly scoped to desktop modal callers only: existing mobile-specific behavior such as `ObjectiveDialog` returning `null` on mobile and `WorktreeModal` rendering `MobileSheet` must remain unchanged, and `ConfirmDialog` / `Sheet` stay out of scope for this phase.

**Tech Stack:** React 19, TypeScript 6, Vite, Vitest + Testing Library, vanilla CSS Modules, existing `tokens.css`.

**Spec reference:** `docs/superpowers/specs/2026-05-06-ui-component-library-design.md`

---

## File Structure

**New files:**
- `packages/web/src/components/ui/modal/index.tsx`
- `packages/web/src/components/ui/modal/index.module.css`
- `packages/web/src/components/ui/modal/index.test.tsx`
- `packages/web/src/components/ui/modal/README.md`
- `packages/web/src/components/ui/_internal/portal.tsx`
- `packages/web/src/components/ui/_internal/focus-trap.ts`
- `packages/web/src/components/ui/_internal/dismiss.ts`

**Modified files:**
- `packages/web/src/components/ui/index.ts`
- `packages/web/src/components/ui/README.md`
- `packages/web/src/components/ui/MIGRATION.md`
- `packages/web/src/styles/components.css`
- `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- `packages/web/src/features/workspace/views/shared/git-status-bar.test.tsx`

**No changes in this plan:**
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- `packages/web/src/features/supervisor/views/mobile/*`
- `packages/web/src/components/ui/sheet/*`
- `packages/web/src/components/ui/confirm-dialog/*`
- `packages/web/src/components/ui/toast/*`

## Task 1: Capture Baseline

**Files:** none

- [ ] **Step 1: Record the current raw modal caller inventory**

Baseline targets in this slice:

- `ObjectiveDialog`
- desktop `WorktreeModal`
- `CreatePathModal`
- `DeleteFileModal`
- `GitDiscardConfirmModal`
- `GitStatusBar` confirm/auth dialogs

- [ ] **Step 2: Run characterization tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/features/workspace/views/shared/git-status-bar.test.tsx
```

Expected: all tests pass before the migration starts.

## Task 2: Implement Shared `Modal`

**Files:**
- Create: `packages/web/src/components/ui/modal/*`
- Create: `packages/web/src/components/ui/_internal/portal.tsx`
- Create: `packages/web/src/components/ui/_internal/focus-trap.ts`
- Create: `packages/web/src/components/ui/_internal/dismiss.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing `Modal` tests**

Cover:

```tsx
render(
  <Modal open onOpenChange={vi.fn()}>
    <ModalHeader>
      <ModalTitle>Workspace details</ModalTitle>
    </ModalHeader>
    <ModalBody>Body</ModalBody>
    <ModalFooter>Footer</ModalFooter>
  </Modal>
);
```

and assertions for:

- `role="dialog"` plus `aria-modal="true"`
- portal rendering into `document.body`
- `size="lg"` applying the large card variant
- overlay click and `Escape` closing when `dismissible` is `true`
- `dismissible={false}` preventing overlay / `Escape` close
- focus moving into the dialog on open and returning to the previously focused trigger on close

- [ ] **Step 2: Implement `Modal` and its helpers**

Requirements:

- public API exports `Modal`, `ModalHeader`, `ModalTitle`, `ModalBody`, `ModalFooter`
- `Modal` accepts `open`, `onOpenChange`, `size?: "sm" | "md" | "lg" | "full"`, `dismissible?: boolean`, `initialFocus?: HTMLElement | null | (() => HTMLElement | null)`, and `className`
- root renders through a portal to `document.body`
- dialog shell handles outside click and `Escape` dismissal only when `dismissible`
- dialog traps focus while open and restores focus on close
- CSS module owns the generic modal styles migrated from `components.css`
- internal output keeps compatibility classes such as `modal-overlay`, `modal-card`, `modal-card-lg`, `modal-header`, `modal-title`, `modal-body`, and `modal-footer`
- leave feature-only chrome such as `worktree-*`, `dialog-helper`, and non-modal layout classes outside this component

- [ ] **Step 3: Run the focused component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/modal/index.test.tsx
```

Expected: all `Modal` tests pass.

## Task 3: Migrate `ObjectiveDialog` and `WorktreeModal`

**Files:**
- Modify: `packages/web/src/features/supervisor/views/shared/objective-dialog.tsx`
- Modify: `packages/web/src/features/supervisor/components/objective-dialog.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/worktree-modal.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing feature tests**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Close" })).toHaveClass("btn", "btn-ghost", "btn-sm");
```

and desktop/mobile split coverage that:

- `ObjectiveDialog` still returns nothing on mobile
- `WorktreeModal` still uses `MobileSheet` on mobile
- desktop `WorktreeModal` still uses the large modal size and renders the existing tab content

- [ ] **Step 2: Migrate both callers to the shared modal primitives**

Requirements:

- replace raw overlay/card/header/body/footer markup with `Modal` subcomponents
- preserve `supervisor-dialog` and worktree-specific classes on the dialog card/content
- keep the desktop-only guards exactly as they are today
- preserve the close button placement and footer actions
- map the former `modal-card-lg` path to `size="lg"`
- rename worktree-only `modal-tabs` / `modal-tab` classes to worktree-specific names so feature code no longer depends on raw modal class names
- update feature selectors in `components.css` where they currently depend on old modal element shapes such as `.supervisor-dialog .modal-header h3`

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/modal/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx
```

Expected: all tests pass.

## Task 4: Migrate `FileTreePanel` and `GitPanel`

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/file-tree-panel.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`

- [ ] **Step 1: Write failing integration tests**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(screen.getByLabelText("file.path")).toHaveClass("input");
```

and discard/create/delete flows that continue to require explicit confirmation before mutating workspace state.

- [ ] **Step 2: Migrate the file and git confirmation modals**

Requirements:

- replace raw modal shell markup in `CreatePathModal`, `DeleteFileModal`, and `GitDiscardConfirmModal`
- use shared `ModalTitle` for icon + heading rows so feature code no longer emits raw `.modal-title`
- preserve the current helper copy, error rendering, and button variants
- preserve outside-click close and explicit close button behavior

- [ ] **Step 3: Run the focused test set**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/modal/index.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx
```

Expected: all tests pass.

## Task 5: Migrate `GitStatusBar`, Barrel, Docs, Inventory, Verify

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/git-status-bar.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/git-status-bar.test.tsx`
- Modify: `packages/web/src/components/ui/index.ts`
- Modify: `packages/web/src/components/ui/README.md`
- Modify: `packages/web/src/components/ui/MIGRATION.md`

- [ ] **Step 1: Write failing sync/auth dialog assertions**

Add focused assertions that cover:

```tsx
expect(screen.getByRole("dialog")).toBeInTheDocument();
expect(screen.getByLabelText("Username")).toHaveClass("input");
```

and keep the existing locked-state behavior while syncing.

- [ ] **Step 2: Migrate `GitStatusBar` to the shared modal primitives**

Requirements:

- replace the raw modal shell with shared `Modal` subcomponents
- preserve the confirm/auth dual-state body logic and the existing form submit behavior
- keep the close button and cancel button disabled whenever the dialog is locked by sync state
- preserve the `git-status-bar__confirm` card class for feature-specific styling

- [ ] **Step 3: Export `Modal` from the public barrel and update docs**

After this phase:

- `Modal` should be listed in `README.md` as implemented
- `MIGRATION.md` should mark `Modal` complete with `0` bounded callers left

- [ ] **Step 4: Run the targeted test set**

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/components/ui/modal/index.test.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/features/workspace/views/shared/git-status-bar.test.tsx
```

- [ ] **Step 5: Run targeted formatting/lint verification**

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/components/ui/modal \
  src/components/ui/_internal/portal.tsx \
  src/components/ui/_internal/focus-trap.ts \
  src/components/ui/_internal/dismiss.ts \
  src/components/ui/index.ts \
  src/components/ui/README.md \
  src/components/ui/MIGRATION.md \
  src/styles/components.css \
  src/features/supervisor/views/shared/objective-dialog.tsx \
  src/features/supervisor/components/objective-dialog.test.tsx \
  src/features/workspace/views/shared/worktree-modal.tsx \
  src/features/workspace/views/shared/worktree-modal.test.tsx \
  src/features/workspace/views/shared/file-tree-panel.tsx \
  src/features/workspace/views/shared/file-tree-panel.test.tsx \
  src/features/workspace/views/shared/git-panel.tsx \
  src/features/workspace/views/shared/git-panel.test.tsx \
  src/features/workspace/views/shared/git-status-bar.tsx \
  src/features/workspace/views/shared/git-status-bar.test.tsx
```

Expected: no new errors.

# Git Panel Worktree List Design

## Goal

Refine the compact worktree list inside the Git panel so it behaves like a lightweight launcher instead of leaking low-level git details.

## Problem

The compact worktree list currently exposes full branch refs such as `refs/heads/develop`, which adds noise without helping the user choose a worktree.

It also lacks a direct delete action, even though the app already has:

- server support for `worktree.remove`
- front-end delete handling in the full worktree manager surface
- delete confirmation copy and force-delete behavior for dirty worktrees

The Git panel also mounts the full `WorktreeManagerSurface`, but only exposes the `create` entry point. There is no visible way to open the list-management view from the Git panel itself.

## Desired Behavior

### Compact list rows

Each row in the Git panel worktree section should show:

- worktree name
- shortened branch label
- clean/dirty summary
- current chip when applicable

The compact row must not display:

- absolute worktree path
- full git ref prefixes such as `refs/heads/`

Branch presentation rule:

- if the branch begins with `refs/heads/`, show the suffix only
- otherwise keep the original branch string so detached or remote representations stay intact

### Delete action

The compact list should expose an inline delete action for removable entries.

Deletion must keep the same safety rules already used in the full manager:

- no delete action for the current worktree
- no delete action for the primary/main worktree entry
- dirty worktrees require the existing force-remove confirmation
- clean worktrees use the existing normal delete confirmation

### Management entry point

The Git panel worktree section should expose a visible `Manage` action that opens the full `WorktreeManagerSurface` in list mode.

The existing `New` action should continue opening the create view.

## Scope

### In scope

- Git panel compact worktree row rendering
- inline delete action from the compact list
- Git panel entry point for full worktree management
- targeted style updates needed to support split row actions
- focused Git panel tests for the new behavior

### Out of scope

- changing full worktree manager behavior beyond shared delete reuse
- changing server-side worktree removal rules
- adding path display back elsewhere in the compact list
- changing worktree switching/opening behavior

## Architecture

### 1. Keep command/data flow unchanged

Reuse `useWorktreeManagementActions` from the Git panel for:

- `list`
- `loadWorktrees`
- `openWorktree`
- `removeWorktreeByPath`

No server changes are needed because `worktree.remove` already exists and enforces open-worktree safety.

### 2. Split compact row interactions

The current compact row is one full-width button. To support delete without breaking open/switch behavior, each row should become:

- a left-side main button for open/switch
- a right-side icon/button for delete when removable

This preserves the row click target while isolating destructive behavior.

### 3. Reuse the existing full manager surface

The Git panel already mounts `WorktreeManagerSurface` via `worktreeSurfaceView`.

This design only adds one missing state transition:

- `Manage` sets `worktreeSurfaceView` to `"list"`

That exposes existing functionality instead of introducing another management surface.

## Files Expected To Change

- `packages/web/src/features/workspace/views/shared/git-panel.tsx`
- `packages/web/src/features/workspace/views/shared/git-panel.test.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/styles/components.theme.test.ts`

## Testing Strategy

1. Add Git panel tests that fail until the compact list:
   - hides `refs/heads/` prefixes
   - exposes a manage entry point
   - exposes delete only for removable worktrees
   - sends `worktree.remove` with `force: true` for dirty worktrees
2. Keep worktree switching behavior covered by existing row-click tests or add focused coverage if needed.
3. Verify compact-row CSS still matches the tight tool-surface constraints asserted in `components.theme.test.ts`.

## Acceptance Criteria

- compact Git panel rows no longer show `refs/heads/...`
- compact Git panel rows still show branch context using the shortened branch name
- removable worktrees show an inline delete action
- current and primary worktrees do not show the inline delete action
- clicking a compact row still opens/switches to that worktree
- clicking `Manage` opens the full worktree manager list view
- dirty worktree deletion from the compact list issues `worktree.remove` with `force: true`

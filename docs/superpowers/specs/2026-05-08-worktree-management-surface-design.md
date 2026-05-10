---
name: Worktree Management Surface Design
description: Replace the dormant worktree button with a visible Git-panel worktree summary and manager across desktop and mobile
type: project
---

# Worktree Management Surface Design

## Overview

The repository already has most of the hard worktree plumbing: server commands for `list/status/diff/tree/create/remove`, a front-end `worktreeListAtomFamily`, live refresh wiring in `providers.tsx`, and a detail viewer (`WorktreeModal`). The problem is discoverability and placement. The original header button was both redundant and badly placed, so it was removed. That left the capability effectively hidden even though the data and modal still exist.

This spec replaces the orphaned header button with a visible but scoped worktree management surface inside the existing Git panel. The first visible layer should show basic facts at a glance; the second layer should support viewing details and managing worktrees.

## Goals

1. Make worktree information visible in the Git workflow on both desktop and mobile.
2. Show basic worktree state at a glance: total count, dirty count, and current worktree.
3. Provide a management flow for list, details, create, and delete.
4. Reuse the existing worktree commands, atoms, and detail-loading logic instead of creating a parallel subsystem.
5. Remove the dormant `WorktreeListButton` entry path and its tests once the replacement surface exists.

## Non-Goals

- Folding worktree management into the branch quick-pick main flow.
- Opening another worktree as the current workspace in this first version.
- Worktree rename, prune, repair, or advanced git maintenance actions.
- Editing files or staging changes from the worktree detail viewer.

## Product Decision

### Why not the branch switcher

The branch switcher has a narrow job: change branches quickly. The requested capability is broader: inspect multiple worktrees and manage their lifecycle. Mixing those concerns would make the branch surface heavier, harder to scan, and harder to reason about. The entry point should live near Git management, not near quick branch selection.

### Chosen location

Place the worktree entry at the top of `GitPanel`, above the commit box and file change groups. This has three advantages:

1. It is visible without crowding the global Git status bar.
2. `GitPanel` is already shared by desktop and mobile, so one placement decision serves both layouts.
3. The feature stays inside the Git context, which matches the user’s mental model for “view/manage multiple worktrees.”

## User Experience

### 1. Summary card in `GitPanel`

Add a `WorktreesSummaryCard` as the first section inside `GitPanel`.

Displayed information:

- `Worktrees`: total number of worktrees in the repo.
- `Dirty`: number of worktrees whose status is not clean.
- `Current`: the worktree whose `path` matches the active workspace path.

Primary actions:

- `Manage`: opens the full worktree manager.
- `New`: opens the create-worktree flow directly.

The card should stay compact. It is a summary and launch surface, not a full list. If loading fails, show a small inline error state and keep `Manage` available for retry.

### 2. Manager surface

Open a dedicated manager overlay from `Manage`.

- Desktop: modal card.
- Mobile: sheet.

The manager should have two internal views instead of stacking multiple overlays:

- `list` view
- `detail` view

This avoids modal-on-modal behavior and keeps navigation predictable on mobile.

`list` view contents:

- Header with title and close/back control.
- Primary `New` action.
- Worktree rows showing:
  - `name`
  - `branch`
  - `path`
  - `clean/dirty`
  - `current` badge when the row matches the active workspace path
- Row tap/click opens `detail` view for that worktree.
- Row-level delete affordance for non-current worktrees.

### 3. Detail view

The current `WorktreeModal` already supports `status / diff / tree`. That capability should remain, but the content should be reused inside the new manager instead of only being reachable from the old button flow.

Detail view should show:

- path
- branch
- latest commit sha/subject
- clean/dirty state
- tabbed content:
  - `Status`
  - `Diff`
  - `Tree`

If the selected worktree disappears externally while detail view is open, return to the list view and show a transient error or empty-state message.

### 4. Create flow

The first version must support creation, but it should stay simple.

Fields:

- `Branch` (required)
- `Path` (required, prefilled with a suggested absolute path, editable)

Path behavior:

- Use the active workspace path to derive a default sibling path.
- Suggestion format: `<workspace-parent>/<workspace-name>-<slugified-branch>`.
- The user may edit the path before submission.

Validation:

- branch is required
- path is required
- path should be absolute before enabling submit

On success:

- close the create dialog/sheet
- refresh the worktree list immediately
- return the manager to list mode
- surface a success toast

### 5. Delete flow

Delete must be guarded.

Rules:

- The current worktree cannot be deleted from this UI.
- Clean, non-current worktrees require a standard destructive confirmation.
- Dirty, non-current worktrees require an explicit `Force remove` confirmation path.

On success:

- refresh the worktree list immediately
- if the deleted row was open in detail view, return to the list view
- surface a success toast

## Architecture

### Web reuse

Keep and reuse:

- `worktreeListAtomFamily` in `packages/web/src/features/workspace/atoms/git.ts`
- provider-driven refresh logic in `packages/web/src/app/providers.tsx`
- `useWorktreeActions` data loading for `status/diff/tree`
- existing worktree commands exposed by the server

Remove as an entry point:

- `packages/web/src/features/workspace/views/shared/worktree-list-button.tsx`
- its tests once the replacement surface is covered

### Web component structure

Recommended structure:

- `GitPanel`
  - renders `WorktreesSummaryCard`
  - renders existing commit + change UI
- `WorktreesSummaryCard`
  - loads `worktree.list` on first visible use if atom is empty/stale
  - computes summary metrics
  - opens manager or create flow
- `WorktreeManagerSurface`
  - owns `list/detail/create/delete-confirm` local view state
  - adapts to desktop modal vs mobile sheet chrome
- `WorktreeDetailPanel`
  - extracted from `WorktreeModal` so detail content can be embedded in the manager

`WorktreeModal` should either be removed entirely or reduced to a very thin wrapper around `WorktreeDetailPanel` if any caller still needs it during migration. The important part is that detail rendering must stop depending on the deleted header button flow.

### Current worktree detection

No core type change is required for the first version.

The UI can determine the current worktree by comparing:

- active workspace `path`
- `WorktreeInfo.path`

This keeps the change localized to the web layer.

## Server-side adjustments

The existing server commands are almost sufficient, but create/remove should integrate with the same refresh loop as the rest of the workspace Git state.

Required change:

- `worktree.create` should emit `git.state.changed { worktreeChanged: true }`
- `worktree.remove` should emit `git.state.changed { worktreeChanged: true }`

Why:

- external `git worktree add/remove` is already picked up by metadata refresh
- UI-triggered create/remove should be equally observable without requiring ad hoc reload logic everywhere

Even with the event emission, the web manager should still refresh the list immediately after a successful create/remove so the user sees deterministic feedback without waiting for the debounce window.

## Data Flow

### Initial load

1. User opens the Git tab.
2. `GitPanel` renders `WorktreesSummaryCard`.
3. If `worktreeListAtomFamily(workspaceId)` has never loaded, dispatch `worktree.list`.
4. The card renders loading, then summary metrics.

### Ongoing refresh

After initial load:

- provider refresh keeps the list up to date when `git_metadata` or `worktreeChanged` events arrive
- create/remove success paths also trigger immediate local reload

### Detail loading

Selecting a row in the manager:

- sets the selected `WorktreeInfo`
- reuses `useWorktreeActions` to load `status/diff/tree`
- refetches when the selected tab changes or the selected worktree changes

## Error Handling

- `worktree.list` failure: show inline error in summary card and full manager retry state.
- `worktree.status/diff/tree` failure: show inline error in detail view without closing the manager.
- `worktree.create` failure: keep the create form open and show the error inline.
- `worktree.remove` failure: keep the confirmation open and show the error inline.
- stale selection after external removal: bounce from detail view back to list with a notice.

## Testing Strategy

### Server

- extend worktree command tests to assert that `worktree.create/remove` emit `worktreeChanged`

### Web

- summary card loads and displays total/dirty/current
- summary card appears inside `GitPanel` on both desktop and mobile
- manager list shows row metadata and current badge
- manager opens detail view and reuses `status/diff/tree`
- create success refreshes the list and shows the new row
- delete is disabled/hidden for the current worktree
- dirty delete requires force confirmation
- old desktop header entry does not return

## Migration Notes

This is a replacement, not an additive entry point. The final state should have exactly one visible worktree management surface:

- visible summary in `GitPanel`
- manager overlay behind that summary
- no duplicate status-bar chip
- no duplicate branch-header button

That keeps the feature discoverable without repeating the same action in multiple places.

# Workspace Tab Instance Isolation Design

## Goal

Treat each workspace as its own tab instance. Switching workspaces must switch to that workspace's own UI state and view state instead of reusing a shared global workspace shell.

## Problem

The current desktop workspace experience mixes two different models:

- Server/data state is mostly scoped by `workspaceId`
- A large part of workspace UI state is global

That mismatch causes state bleed:

- switching workspace carries the active sidebar tab into the next workspace
- search queries and search results leak across workspaces
- sidebar collapse, terminal visibility, focus mode, and split sizes are shared across all workspaces

This does not match the tab mental model. A workspace switch should feel like switching tabs, not swapping the data source under one shared instance.

## Desired Behavior

When the user switches from workspace `A` to workspace `B`:

- the rendered workspace view becomes a distinct instance for `B`
- `B` restores its own layout state
- `B` restores its own panel/session UI state
- no panel-local `useState` from `A` is visible in `B`

When the user switches back to `A`:

- `A` restores the last in-memory state for its own workspace tab instance

## Scope

This change covers workspace view instance state in `packages/web`.

### Persistent workspace-scoped layout state

- desktop sidebar active view
- sidebar collapsed
- terminal panel visible
- focus mode
- left panel width
- bottom panel height

### Workspace-scoped session/view state

- content search panel query, results, expanded groups, loading/error/retry state
- git panel expand/collapse and worktree surface view
- file tree search input and search results
- workspace screen model local view state such as mobile sheet state and create request routing

### Out of scope

- keeping every workspace React subtree mounted concurrently
- expanding server `Workspace["uiState"]` protocol for new sidebar/tab visibility fields in this change

## Architecture

### 1. Workspace-scoped layout buckets

Replace the shared layout atoms with `workspaceId`-keyed families.

- storage-backed families hold per-workspace layout values
- active-workspace adapter atoms preserve existing call sites that operate on "the current workspace"
- adapter atoms fall back to a global default bucket when no workspace is active

This keeps the top bar, focus mode, command palette, and terminal controls operating on the current workspace tab without rewriting every consumer to plumb `workspaceId`.

### 2. Workspace root instance boundary

Key the workspace root view by `workspace.id` so React does not reuse one component instance across different workspaces.

This prevents panel-local state from silently surviving a workspace switch.

### 3. Explicit workspace session-state buckets

For panel state that should restore when returning to the same workspace, move local `useState` into workspace-scoped atoms.

This applies to:

- search panel state
- git panel UI state
- file tree search state
- screen model local view state

These buckets are in-memory by default unless there is a reason to persist them longer.

## Why not keep hidden workspaces mounted?

Keeping all workspaces mounted would preserve state automatically, but it also keeps effects, subscriptions, and requests alive for hidden workspaces. That is a poor fit for this app. We want tab-like state restoration without background work from inactive workspace trees.

## Testing Strategy

1. Add a desktop workspace integration test proving sidebar view and layout state are isolated per workspace.
2. Add a desktop workspace integration test proving search state belongs to each workspace instance and restores when switching back.
3. Keep existing focused component tests green.

## Acceptance Criteria

- switching workspace does not carry the active sidebar tab across workspaces
- switching workspace does not carry search query/results across workspaces
- switching back restores the previous workspace's own state
- top bar toggles and keyboard shortcuts operate on the active workspace only
- existing workspace data flows remain scoped by `workspaceId`

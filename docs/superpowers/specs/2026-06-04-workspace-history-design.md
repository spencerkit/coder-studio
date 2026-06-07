# Workspace History Design

## Summary

This design adds a persistent `Recent Workspaces` list to the shared workspace launch panel so users can reopen previously used project folders directly after the app or a workspace has been closed. The history is stored separately from the current open-workspace set so bootstrap routing, active workspace state, and close semantics remain unchanged.

## Problem

The current workspace model only persists workspaces that are still open.

- `workspace.open` creates or returns a live workspace entry.
- `workspace.close` deletes that workspace entry.
- `workspace.list` is used during bootstrap to decide whether the app should route to `/workspace` or stay on `/`.

That behavior is correct for active workspaces, but it means a previously opened project disappears completely once it is closed. Users then have to browse the filesystem again from the launch panel to find the same folder.

The missing piece is a separate concept for "recently opened workspaces" that survives workspace closure and server restart without changing the meaning of the existing open-workspace APIs.

## Goals

- Persist a recent workspace list across workspace closure and server restart.
- Show that recent list inside the existing shared workspace launch panel.
- Allow clicking a recent entry to immediately reopen that workspace.
- Keep `workspace.list` scoped to currently open workspaces only.
- Reuse existing `workspace.open` success and error flows instead of creating a second open path.

## Non-Goals

- Pinning, starring, or manually reordering history entries.
- Removing invalid history entries before the user clicks them.
- Adding a separate global workspace manager page.
- Changing multi-workspace bootstrap or routing behavior.
- Reusing historical workspace ids across reopen events.

## Approaches Considered

### 1. Browser-local history in `localStorage`

This is the lightest implementation, but it does not fit the product direction.

- history would be tied to one browser profile
- mobile or second-browser access would not see the same recent list
- the app already uses server-owned persistence for adjacent workspace activity data such as `workspace.lastViewedTarget`

This approach is rejected.

### 2. Separate recent-workspace history backed by `settingsRepo`

This keeps history independent from live workspace state while using an existing persistence mechanism already meant for global app state.

- survives restart
- available to all browser clients connected to the same local server
- does not interfere with `workspace.list`
- matches the existing `workspace.lastViewedTarget` storage pattern

This is the recommended approach.

### 3. Expand `workspaceRepo` to keep closed workspaces

This approach would mix active and historical concepts in one store.

- closed workspaces would still appear in `workspace.list`
- bootstrap route decisions would become wrong
- closing a workspace would no longer mean "remove from active set"

This approach is rejected.

## Recommended Design

### Data Model

Add a shared type in `packages/core`:

```ts
export interface WorkspaceHistoryEntry {
  path: string;
  name: string;
  lastOpenedAt: number;
}
```

Design rules:

- `path` is the stable identity and dedupe key.
- `workspaceId` is not stored because reopened workspaces may receive a new id after being closed.
- `name` is derived from `basename(path)` and falls back to `path` if needed.
- the stored list is sorted by `lastOpenedAt` descending.
- the list is capped at 20 entries.

### Server Persistence

Recent-workspace history should be stored under a new settings key:

```ts
workspace.history
```

The persistence implementation should live in a small server-side helper dedicated to:

- reading the stored history list
- validating and normalizing entries
- recording a successful workspace open

The helper should not live inside `WorkspaceRepo`, because `WorkspaceRepo` currently models the active workspace set only.

### Server Behavior

#### Read path

Add a new command:

- `workspace.history.list`

It returns normalized `WorkspaceHistoryEntry[]`.

#### Write path

Do not add a public `workspace.history.record` command.

Instead, record history as part of the existing `workspace.open` server command after `ctx.workspaceMgr.open(...)` succeeds. That keeps all open entry points aligned:

- launch modal open
- diagnostics retry flows
- any future caller that uses `workspace.open`

Recording rules:

1. normalize the opened path
2. remove any existing history entry with the same path
3. prepend the new entry with current timestamp
4. trim to the maximum length
5. write the final list back to `settingsRepo`

### Client Behavior

The shared launch modal should load recent history alongside the current directory browser data.

The browse request and history request should be allowed to resolve independently. A history load failure should degrade the launch panel to its existing directory-browser-only behavior instead of blocking workspace launch entirely.

The action layer in `use-workspace-launch-actions.ts` should gain a reusable helper:

- `openWorkspaceByPath(path: string)`

That helper should contain the existing post-open behavior that is currently coupled to the selected-directory flow:

- dispatch `workspace.open`
- persist `workspace.lastViewedTarget`
- update `activeWorkspaceIdAtom`
- write the workspace into `workspacesAtom`
- hydrate editor UI state
- update `workspaceOrderAtom`
- navigate to `/workspace` when launched from outside the workspace route
- close the modal on success
- preserve the existing diagnostics redirect on failure

Both of these launch paths should call the same helper:

- directory selection + `Start Workspace`
- direct click on a recent history entry

### Launch Panel UI

The feature should be added to the existing shared modal in `workspace-launch-modal.tsx`, because that surface is already reused by:

- welcome page
- top bar
- command palette
- mobile workspace flows

#### Desktop layout

Show a `Recent Workspaces` section in the launch modal before or beside the directory browser content.

Each history row should show:

- workspace name
- full path
- optional recency metadata if the existing layout has room

Clicking a history row should immediately open that workspace. It should not require selecting the row and then clicking `Start Workspace`.

#### Mobile layout

Render the recent history block above the directory list inside the same sheet body.

Clicking a history row should also immediately open the workspace on mobile.

### Failure Handling

The first version should reuse the current `workspace.open` failure behavior.

If a history path no longer exists or is no longer accessible:

- `workspace.open` fails
- the client follows the current diagnostics redirect path with the selected workspace path preserved

This keeps the implementation small and consistent. Invalid-history pruning can be added later if needed.

### Architecture Notes

The design depends on preserving one hard boundary:

- `workspace.list` means "currently open workspaces"
- `workspace.history.list` means "recently opened workspaces"

Bootstrap code in `useBootstrap.ts` must continue to use only `workspace.list` when deciding whether the app should route to `/workspace` or remain on `/`.

## File Boundaries

Primary files expected to change:

- `packages/core/src/domain/types.ts`
- `packages/server/src/commands/workspace.ts`
- `packages/server/src/commands/workspace-activity.ts` or a sibling workspace-history command module
- `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`

Likely new files:

- `packages/server/src/workspace/history-store.ts`

Tests expected to change:

- `packages/server/src/__tests__/workspace-commands.test.ts`
- `packages/web/src/features/workspace/views/shared/workspace-launch-modal.test.tsx`

Likely locale updates:

- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`

## Testing Strategy

### Server tests

Add coverage for:

- `workspace.history.list` returning an empty list by default
- recording history after a successful `workspace.open`
- deduping repeated opens of the same path
- ordering by most recent open time
- trimming the list to the configured maximum length
- returning normalized data when malformed entries are present in settings storage

### Client tests

Add coverage for:

- launch modal requesting recent history during mount
- rendering recent history entries in desktop and mobile launch surfaces
- clicking a recent history entry dispatching `workspace.open` directly
- recent-history opens reusing the same post-open state hydration as directory-based opens
- failed recent-history opens preserving the current diagnostics redirect behavior

## Acceptance Criteria

- opening a workspace records it in recent history
- closing a workspace does not remove it from recent history
- reopening the app still shows recent history
- clicking a recent history row immediately reopens that workspace
- repeated opens of the same path do not create duplicate history rows
- `workspace.list` semantics remain unchanged and continue to represent only currently open workspaces
- bootstrap routing behavior remains unchanged
- the recent-history UI is available anywhere the shared launch modal is used

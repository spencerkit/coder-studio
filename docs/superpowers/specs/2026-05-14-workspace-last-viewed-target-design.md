# Workspace Last Viewed Target Design

## Summary

Persist the user's last viewed workspace/session target on the server so refreshes and new devices can restore the same place. The value is global to the instance, last-write-wins, and stored in `user_settings` without a schema change.

## Problem

Today the active workspace is kept only in browser memory, so a refresh falls back to the first workspace. Mobile also has no reliable cross-device way to restore the current session inside that workspace.

## Goals

- Restore the last viewed workspace across refreshes and devices.
- Restore the last viewed session on mobile after the workspace is restored.
- Keep desktop behavior simple: restore the workspace tab only, not pane layout.
- Avoid database migrations.

## Non-Goals

- Per-user isolation.
- Syncing pane layout through this feature.
- Changing the existing `/workspace` route shape.

## Data Model

Store one JSON value in `user_settings`:

```json
{
  "workspaceId": "ws_123",
  "sessionId": "sess_456",
  "updatedAt": 1770000000000
}
```

- `workspaceId` is required.
- `sessionId` is optional.
- `updatedAt` is server-written metadata for debugging and conflict transparency.

Suggested key: `workspace.lastViewedTarget`.

## Server Behavior

- Add a dedicated internal command for writing the target, instead of reusing the public settings UI path.
- Read path stays simple: `settings.get` already returns all `user_settings` keys, so the client can hydrate from the existing settings payload.
- Validate that `workspaceId` exists before writing.
- If `sessionId` is provided but missing or not in the workspace, keep the workspace target and drop the session reference.
- Writes are best-effort and last-write-wins.

## Client Behavior

- Hydrate the stored target during app bootstrap, after workspaces are loaded.
- If the saved workspace still exists, set it as the active workspace intent.
- Desktop:
  - switch to the saved workspace tab
  - do not force pane/layout changes
- Mobile:
  - switch to the saved workspace
  - then select the saved session if it still exists
  - otherwise fall back to the workspace's `uiState.activeSessionId`
  - otherwise fall back to the most recent available session

## Write Triggers

Update the global target only from explicit user focus changes:

- workspace tab selection
- session card selection
- mobile workspace/session selection
- notification click focus
- workspace launch into an opened workspace

Do not mirror current active state back to the server from passive render effects or hydration effects.

## Fallbacks

- Missing workspace: fall back to the current first-workspace behavior.
- Missing session: restore the workspace only.
- No saved target yet: use current default bootstrap behavior.

## Testing

- Server command tests for read/write and validation.
- Web tests for bootstrap restore on desktop and mobile.
- E2E coverage for refresh restoring the same workspace, and mobile restoring the same session.
- Regression test for missing workspace/session fallback.

## Acceptance Criteria

- Refresh no longer resets the app to the first workspace when a saved target exists.
- Desktop restores the saved workspace tab only.
- Mobile restores the saved workspace and session.
- No schema migration is required.

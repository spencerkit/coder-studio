# Provider-Native Session History Design

**Date:** 2026-04-05

**Status:** Proposed

## Goal

Replace the app-managed session history and archive model with a provider-native model that reads real Claude and Codex sessions from provider storage, while keeping only the minimal pane-to-provider binding state required for recovery after page refresh or backend restart.

The redesign must:

- make Claude and Codex the source of truth for session existence, title, and delete behavior
- keep archive as a visible state, but derive it instead of persisting it
- preserve automatic restore for mounted panes by retaining a real provider session identifier
- remove the redundant local history/session database layer

## Background

Today the app keeps a second session history system in `workspace_sessions` and related archive helpers:

- session startup creates a local history row
- provider hooks later patch in `resume_id`
- archive writes a local archived snapshot and removes runtime state
- restore works through the local session row and uses the stored `resume_id`
- delete removes the local record first and only partially reflects provider reality

This duplicates what the providers already store:

- Claude persists real sessions in `~/.claude/projects/...`
- Claude prompt history is recorded in `~/.claude/history.jsonl`
- Codex persists real sessions in `~/.codex/sessions/...`
- Codex stores stable thread metadata in `~/.codex/state_5.sqlite`

The duplicate local history layer creates three product problems:

- history can drift from the provider's real session list
- titles and timestamps can disagree with provider resume views
- deleted provider sessions can still look restorable locally

The local app does still need one persistent concept:

- which pane is bound to which real provider session

That binding is required to recover a workspace after frontend refresh or backend restart.

## Decision

Adopt a provider-first session model.

The new ownership model is:

- provider storage is the source of truth for session history
- provider-native resume ids remain the source of truth for restore
- local app state persists only workspace layout and pane bindings
- archive is derived as "provider session exists for this workspace path but no pane currently mounts it"
- missing is derived as "a pane binding still points at a provider session that no longer exists"

This means the app no longer owns a durable history/session entity. It owns only:

- live runtime state for currently open panes
- persistent pane bindings needed for recovery

## Non-Goals

- Do not preserve the existing `workspace_sessions` table as a second source of truth.
- Do not persist a local archive list or archive snapshots in phase 1.
- Do not generate or store app-specific session titles.
- Do not change the provider-native resume launch behavior itself.
- Do not build a provider-wide filesystem browser outside app-known workspaces in phase 1.
- Do not attempt to scrub every provider diagnostic log file during delete.

## Requirements

### Functional

- History records must come from real Claude and Codex session storage for a workspace path.
- Restore must resume a provider session by its real provider-native resume id.
- Page refresh and backend restart must auto-restore mounted panes when their provider session still exists.
- If a bound provider session no longer exists, the pane must become unavailable and explain why it cannot be restored.
- Delete must operate on provider real data, not on an app-managed history row.

### Semantics

- `archive` must remain a visible state.
- `archive` must mean: a provider session exists, but the current workspace does not mount it in any pane.
- `missing` must mean: the workspace still has a pane binding, but the provider session no longer exists.
- Explicit archive persistence must be removed. Archive is a derived view state only.

### Title Consistency

- Claude titles must mirror Claude's current `/resume` list semantics.
- Codex titles must mirror Codex's native thread metadata.
- The app must not maintain a parallel title system.

### Reliability

- A pane is recoverable only after a real provider session id has been observed and persisted as a binding.
- If a session never emitted a provider resume id, it is not provider-recoverable after restart.
- Mounted pane bindings must survive frontend refresh and backend restart.

## State Model

### 1. Provider History Record

History records are derived on demand and are not persisted as app-owned history entities.

Each derived record should contain:

- `workspaceId`
- `workspaceTitle`
- `workspacePath`
- `provider`
- `resumeId`
- `title`
- `createdAt`
- `lastActiveAt`
- `mounted`
- `archived`
- `availability`
- `recoverable`

Recommended semantics:

- `availability = "available"` when provider data exists
- `availability = "missing"` when only a dead pane binding remains
- `recoverable = true` only when provider data exists

History record identity should become a stable composite key:

- `${provider}:${resumeId}`

### 2. Persisted Pane Binding

The only durable local session reference is a pane binding.

Each binding should contain:

- `paneId`
- `provider`
- `resumeId`
- `titleSnapshot`
- `lastSeenAt`

`titleSnapshot` is not a local title system. It exists only so an unavailable placeholder can still show a human-readable label after the provider session has disappeared.

For migration safety, the app may keep the field name `resumeId` even though its real meaning is "provider-native session id used for restore."

### 3. Runtime Session Instance

Live runtime session state remains local and ephemeral.

It is still valid for the UI to have a local active session object per pane, but that object is no longer the durable history truth. It is reconstructed from:

- the pane binding
- the current runtime
- provider history data

## Provider Adapters

Provider access should be isolated behind adapters that expose:

- `listWorkspaceSessions(workspacePath)`
- `sessionExists(workspacePath, resumeId)`
- `deleteSession(workspacePath, resumeId)`

### Claude Adapter

#### Source of Truth

- real transcripts: `~/.claude/projects/<project-slug>/*.jsonl`
- title source: `~/.claude/history.jsonl`

#### Workspace Scoping

Claude sessions are workspace-scoped by absolute project path.

The adapter should resolve the workspace path to Claude's project directory convention:

- resolve the absolute workspace path
- map `/` to `-`
- read sessions from `~/.claude/projects/<mapped-path>/`

For `/home/spencer/workspace/coder-studio`, the observed Claude project directory is:

- `~/.claude/projects/-home-spencer-workspace-coder-studio`

#### Existence

A Claude session exists when:

- `<projectDir>/<sessionId>.jsonl` exists

#### Title

Claude title must be read exactly from:

- the newest matching line in `~/.claude/history.jsonl`
- where `sessionId == <sessionId>` and `project == <workspacePath>`
- use that line's `display` as the title

This intentionally mirrors current Claude `/resume` semantics and does not add a local title layer.

#### Time

Claude `createdAt` and `lastActiveAt` should come from transcript timestamps when available:

- `createdAt`: earliest timestamp in the transcript
- `lastActiveAt`: latest timestamp in the transcript

If transcript parsing fails, the adapter may fall back to file metadata so the session remains visible.

#### Delete

Claude has no currently exposed local CLI delete command in the installed CLI help, so delete should operate on Claude's local real storage:

- remove `<projectDir>/<sessionId>.jsonl`
- remove `<projectDir>/<sessionId>/` if a sibling session directory exists
- rewrite `~/.claude/history.jsonl` and remove entries matching both `sessionId` and `project`

The app should not rewrite unrelated Claude backups, debug logs, or analytics files.

### Codex Adapter

#### Source of Truth

- metadata index: `~/.codex/state_5.sqlite`
- rollout transcript path: `threads.rollout_path`

#### Workspace Scoping

Codex history is workspace-scoped by `threads.cwd`.

The adapter should list:

- rows from `threads`
- where `cwd == <workspacePath>`

#### Existence

A Codex session exists when:

- a `threads` row exists for `id == resumeId`
- and the referenced `rollout_path` file exists

If the row exists but the rollout file is missing, treat the session as unavailable and do not surface it as a valid provider history record.

#### Title

Codex title should be read directly from:

- `threads.title`

Current observed local data shows `threads.title` and `first_user_message` are identical, but `threads.title` is the native title column and should be treated as canonical.

#### Time

Use:

- `createdAt = threads.created_at`
- `lastActiveAt = threads.updated_at`

#### Delete

Codex has no currently exposed CLI delete command in the installed CLI help, so delete should operate on Codex's local real storage:

- remove the rollout file referenced by `threads.rollout_path`
- delete the `threads` row
- delete matching rows from `logs` where `thread_id == resumeId`
- delete matching rows from `thread_spawn_edges` where `parent_thread_id == resumeId` or `child_thread_id == resumeId`
- rewrite `~/.codex/history.jsonl` and remove entries where `session_id == resumeId`
- remove `~/.codex/shell_snapshots/<resumeId>.*`

Because `thread_dynamic_tools` and `stage1_outputs` have `ON DELETE CASCADE`, deleting the `threads` row is sufficient for those tables.

The app should not rewrite generic append-only diagnostic logs such as `codex-tui.log`.

## Derived History Assembly

History should remain grouped by app-known workspaces, but the records inside each group are provider-derived.

For each persisted workspace:

1. Load the workspace's persisted pane bindings.
2. Ask the Claude and Codex adapters for real provider sessions for that workspace path.
3. Mark each provider session as `mounted` if any pane binding matches `(provider, resumeId)`.
4. Mark each provider session as `archived` if it exists but no pane binding matches it.
5. Create synthetic `missing` records for dead pane bindings whose provider session no longer exists.

This produces three visible record classes:

- available + mounted
- available + archived
- missing + mounted-reference-only

No durable local history row is needed for any of them.

## Runtime and Recovery Flow

### 1. New Session Startup

New session startup becomes:

1. User starts a provider session in a pane.
2. The app launches the provider normally.
3. When the provider emits a real resume id, update that pane's binding only.
4. Do not create or update a durable history row.

This preserves recoverability without rebuilding a second history system.

### 2. Manual Restore

Manual restore becomes:

1. User selects a provider-derived history record.
2. The app mounts a pane binding for `(provider, resumeId)`.
3. The app launches the provider in resume mode using that provider-native id.
4. A new local live runtime session instance is created for the pane.

The provider-native resume commands remain the same:

- Claude: `claude --resume <resumeId>`
- Codex: `codex resume <resumeId>`

### 3. Page Refresh or Backend Restart

Workspace recovery becomes:

1. Load workspace layout and persisted pane bindings.
2. For each binding, probe provider existence using `(workspacePath, provider, resumeId)`.
3. If the provider session exists, auto-resume it into that pane.
4. If it does not exist, do not auto-resume. Create an unavailable placeholder with a clear reason.

Expected unavailable message:

- `该会话已经被删除，无法恢复`

### 4. Recoverability Boundaries

A pane is provider-recoverable only after a real provider resume id has been captured and stored as a binding.

If a live session is interrupted before the provider emits a real resume id:

- the pane may still support local restart behavior
- but it is not provider-recoverable after app or backend restart

## Archive and Unmount Semantics

Current archive behavior should be replaced.

Archive is no longer a backend persistence operation. It is a derived state:

- provider session exists
- workspace does not currently mount it

That means the old explicit archive flow goes away.

New "archive" behavior is:

1. stop the mounted runtime if needed
2. remove the pane binding from the workspace
3. remove the live local pane session instance
4. leave provider data untouched

After that, the same provider session simply appears in history as `archived` because it still exists and is no longer mounted.

This keeps the user-visible concept of archive while removing the redundant archive database model.

## Delete Semantics

Delete should be split from archive clearly.

### Delete Available Session

Deleting an available session should:

1. stop runtime if it is mounted
2. call the provider adapter's real delete operation
3. remove all matching pane bindings for `(provider, resumeId)` from the workspace
4. remove the live local pane session instance

After delete, the record disappears from derived history because the provider data is gone.

### Delete Missing Session

A missing placeholder is not a real provider session anymore.

For missing placeholders, the UI should not pretend it is performing provider delete. Instead it should expose a workspace-local action such as:

- `Remove from workspace`

That action should only clear the dead pane binding and placeholder state.

## API and Boundary Changes

### Backend

The backend should:

- stop reading and writing `workspace_sessions` for history truth
- remove archive snapshot generation
- replace local-history-based restore/delete RPCs with provider-keyed operations
- assemble history from providers plus pane bindings

Recommended RPC direction:

- `list_session_history()` returns provider-derived records
- `restore_provider_session(workspace_id, provider, resume_id, pane_id?)`
- `delete_provider_session(workspace_id, provider, resume_id)`
- `remove_missing_binding(workspace_id, provider, resume_id, pane_id?)`

The internal runtime launch path in `agent.rs` may still use `resumeId`; the important change is that the external restore target is no longer a local numeric history row id.

### Provider Hooks

Provider hooks should keep one responsibility:

- when a real provider resume id is observed, patch the current pane binding

They should stop doing this:

- persisting `resume_id` into the old history/session database model

### Frontend

The frontend should:

- treat history records as provider-keyed records, not local session ids
- derive archive badges from `mounted` and provider existence
- replace archive RPC usage with local unmount behavior
- drive restore/delete actions by `(provider, resumeId)`
- create unavailable placeholders when recovery probes fail

## Migration and Cleanup

### Local Data Migration

Phase 1 should migrate only the durable state that still matters:

- mounted session bindings

Migration should:

1. read current persisted workspace state
2. extract active pane sessions that already have `provider` and `resumeId`
3. convert them into pane bindings
4. ignore old archived history rows as durable truth

Historical archive rows should not be migrated. Once provider-derived history is live, the provider scan will repopulate available archived sessions automatically.

If a legacy mounted session has no `resumeId`, preserve the pane but mark it non-recoverable after restart.

### Code Cleanup

After the new binding model lands, remove or deprecate:

- `workspace_sessions` history writes
- archive DB helpers
- restore-by-local-session-id flows
- provider-hook writes to local history rows

The implementation may stage database removal separately, but the table must stop being authoritative immediately.

## Risks

- Claude and Codex local storage formats are not official stable APIs, so provider adapters may need updates when upstream CLI versions change.
- Claude project path normalization must match Claude's current storage convention closely enough for real workspaces.
- Direct local provider deletion is more invasive than calling a first-party CLI command, but current installed CLIs do not expose a suitable delete command.
- Removing archive persistence changes UX semantics: archive becomes "unmounted" rather than a separate stored snapshot.
- Sessions that never emitted a provider resume id cannot be restored after restart, which must be communicated clearly in the UI.

## Validation Plan

The redesign should be considered complete when the following flows work:

1. Start a new Claude or Codex session and confirm no durable history row is created locally.
2. Observe a real provider resume id and confirm only the pane binding is updated.
3. List history for a workspace and confirm records come from provider storage, not `workspace_sessions`.
4. Unmount a mounted session and confirm it reappears as `archived` because the provider session still exists.
5. Restore an archived session and confirm the provider-native resume command is used.
6. Refresh the page or restart the backend and confirm mounted sessions auto-resume if the provider session still exists.
7. Delete a provider session from outside the app, reopen the workspace, and confirm the pane becomes unavailable with a clear reason.
8. Delete an available session from inside the app and confirm the provider's real local data is removed and the record disappears from history.
9. Remove a missing placeholder from the workspace and confirm only the dead binding is cleared.
10. Verify the app no longer depends on `workspace_sessions` for history, archive, or restore behavior.

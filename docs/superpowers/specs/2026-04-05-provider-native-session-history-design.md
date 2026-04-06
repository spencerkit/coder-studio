# Provider-Native Session History Design

**Date:** 2026-04-05

**Status:** Approved target

## Goal

Adopt a strict provider-only session model.

The system must treat Claude and Codex as the only source of truth for session history and restore. Local app state must keep only the current mounted workspace state needed to render panes and re-attach mounted provider sessions after refresh or backend restart.

The redesign must:

- remove `workspace_sessions` entirely
- make provider history the only history shown in the UI
- make `provider + resume_id` the only restore key
- make close mean unmount, not archive
- keep only pane-to-provider mounted bindings as durable local session state

## Background

The current code still mixes two models:

- provider-native history from Claude/Codex
- app-managed session entities in `workspace_sessions`

That mixed model leaks into all three flows:

- history building mixes provider records with local binding-derived records
- restore can go through either `restore_provider_session` or local `restore_session`
- close still calls `archive_session`, which performs local session cleanup based on the old archive model

This creates conceptual drift and implementation drift. The product behavior you want is simpler:

- history comes only from provider truth
- restore always uses a provider resume id
- closing a pane only unmounts the session from the workspace

## Decision

Use provider-native history and provider-native restore as the only durable session model.

### Source of truth

- Claude/Codex own session existence
- Claude/Codex own session title and activity timestamps
- Claude/Codex own deletion semantics
- the app owns only current workspace layout and mounted pane bindings

### Removed concepts

These concepts must be removed from the product and from the main implementation model:

- `workspace_sessions`
- local archived session records
- local session restore by `workspace_id + session_id`
- app-owned history rows
- archive as a persisted local state

### Remaining local state

The app may still persist:

- workspace pane layout
- active pane and active session focus
- pane bindings for currently mounted provider sessions
- transient live runtime/session UI state
- draft panes that have not yet attached to a real provider session

That local state is mounted-state only. It is not history-state.

## Non-Goals

- Do not keep a compatibility layer where `workspace_sessions` still affects history or restore.
- Do not keep `restore_session` as a second restore path.
- Do not keep `archive_session` semantics in the session lifecycle.
- Do not invent app-specific titles or timestamps for provider history records.
- Do not expand scope beyond Claude and Codex support already present in the codebase.

## Required User-Facing Semantics

### History

History must be built only from provider-native session discovery for a workspace path.

Every record shown in history must correspond to a real provider session and must include:

- `provider`
- `resume_id`
- provider-native title
- provider-native timestamps

The UI must not synthesize extra history rows from local bindings, missing bindings, or old local session records.

### Restore

Restore must always mean:

- select a provider-native history record
- choose a target pane
- mount that provider session into the pane using `provider + resume_id`

There is no separate local-session restore concept.

### Close

Close must always mean:

- stop the pane's runtime/shell if one is active
- remove the pane's mounted binding to the provider session
- update the workspace layout to remove or replace that pane
- keep the provider session in provider history

Close does not archive, snapshot, or persist a recoverable local session object.

### Delete

Delete must always mean deleting the real provider session by `provider + resume_id` and then removing any mounted binding that references it.

## State Model

### 1. Provider History Record

History records are derived on demand from provider storage only.

Each record should contain:

- `workspaceId`
- `workspaceTitle`
- `workspacePath`
- `provider`
- `resumeId`
- `title`
- `createdAt`
- `lastActiveAt`
- `mounted`

A history record is valid only if the provider session still exists.

History record identity must be the stable composite key:

- `${provider}:${resumeId}`

The following legacy fields and semantics should be removed from the history layer if no longer needed by the UI:

- `archived`
- `availability`
- `recoverable`
- local-session `sessionId` as a restore key

If the UI still needs a per-record display id, it should derive it from the composite provider key rather than a local restorable session entity.

### 2. Mounted Pane Binding

The only durable local session reference is a mounted pane binding.

Each binding should contain:

- `session_id` or pane-local slot id used by the workspace UI
- `provider`
- `resume_id`
- optional `title_snapshot` for display continuity
- optional `last_seen_at`

This binding exists only to answer:

- which provider session is currently mounted in this pane?

It must not be treated as a history record, archived session, or restorable local session.

### 3. Runtime Session Instance

The in-memory/runtime session object shown by the UI remains valid, but it is ephemeral.

It may contain:

- pane-local id
- rendered messages already loaded in memory
- runtime status
- terminal attachment info
- unread counters and other UI concerns

It must be reconstructible from current mounted bindings plus provider/runtime state and must not be the durable restore source.

## Flow Changes

### History list flow

The backend history list must:

1. enumerate app-known workspaces
2. ask each provider adapter for real workspace sessions
3. mark whether each provider record is currently mounted by checking mounted bindings
4. return only those provider-native records

It must not:

- read `workspace_sessions`
- synthesize missing rows from dead bindings
- emit local archive rows

### Restore flow

The frontend restore action must always call the provider restore path.

The backend restore path must:

1. validate the provider session still exists for the workspace path
2. bind the target pane/session slot to `provider + resume_id`
3. construct runtime-facing `SessionInfo` for that mounted pane
4. keep the mounted binding for refresh/restart recovery

The following must be removed:

- `restore_session`
- `restore_workspace_session`
- any fallback branch that restores from local `workspace_sessions`

### Close flow

The frontend close action must:

1. update local pane layout
2. stop runtime/shell for the mounted pane
3. invoke a backend unmount/close mutation that removes the mounted binding

The backend close/unmount mutation must:

- stop runtime for the mounted pane if needed
- forget any live in-memory runtime state for that pane
- remove the mounted binding
- not archive or delete provider history

The following must be removed or renamed away from the lifecycle model:

- `archive_session`
- local archive semantics

### Delete flow

Delete must:

1. call provider delete by `provider + resume_id`
2. remove mounted bindings that reference that provider session
3. refresh UI from provider-native history

The following must be removed:

- deleting local session rows as the primary delete behavior

## Migration

### Schema and storage

- remove `workspace_sessions`
- remove code paths that insert into, update, restore from, or delete from `workspace_sessions`
- keep view/layout persistence and mounted binding persistence

### RPC/API

- remove `restore_session`
- remove `delete_session` if it only targets local app-managed sessions
- replace `archive_session` with a close/unmount mutation whose semantics match the new model
- keep `restore_provider_session` or rename it to the canonical restore mutation
- keep provider delete mutation as the canonical delete path

### Frontend

- remove restore branching on `historyRecord.resumeId ? provider restore : local restore`
- always restore by provider record
- remove UI assumptions that a closed session becomes a locally archived restorable session
- keep draft-pane replacement behavior, but mount provider history into the pane directly

## Testing

### Required coverage

Add or update tests to prove:

- history contains only real provider sessions
- closing a pane does not create a local archived session record
- restoring always uses `provider + resume_id`
- page refresh restores mounted panes from mounted bindings only
- backend restart restores mounted panes from mounted bindings only
- deleting a provider session removes it from history and unmounts any pane bound to it
- no code path depends on `workspace_sessions`

### Regression targets

Add regression tests for the exact old behaviors being removed:

- mixed history rows from local bindings
- local restore via `restore_session`
- close triggering archive semantics
- provider delete leaving local restorable artifacts behind

## Open implementation note

If any part of the current UI still depends on a pane-local `session_id`, keep that identifier as a pane/runtime handle only. It must not become a second durable restore identifier.

## Acceptance criteria

This redesign is complete when all of the following are true:

- `workspace_sessions` no longer exists in schema or runtime code paths
- history is sourced only from Claude/Codex provider data
- restore always goes through `provider + resume_id`
- close unmounts without creating archive-style local history
- mounted bindings are the only durable local session reference
- frontend and backend no longer expose a local-session restore model

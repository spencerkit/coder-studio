# Provider-Native Session History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace app-managed session history/archive storage with provider-native Claude/Codex history, while keeping only workspace pane bindings as durable recovery state.

**Architecture:** Stop treating `workspace_sessions` as durable truth. Persist only workspace view state plus session-slot bindings, derive history from provider storage on demand, and rebuild mounted or missing session placeholders from those bindings during attach/reopen. Session restore and delete become provider-keyed operations, while archive becomes a derived "provider session exists but no workspace pane currently mounts it" state.

**Tech Stack:** Rust backend, SQLite workspace state, Claude/Codex local session storage, TypeScript/React frontend, node:test, Playwright

---

## File Map

**Backend state and transport**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/app.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/ws/protocol.rs`
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/main.rs`

**Backend provider and recovery flow**
- Modify: `apps/server/src/services/provider_registry.rs`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Modify: `apps/server/src/services/provider_hooks.rs`
- Modify: `apps/server/src/services/session_runtime.rs`
- Modify: `apps/server/src/services/agent.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/services/mod.rs`

**Frontend state and history UX**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/state/workbench-core.ts`
- Modify: `apps/web/src/ws/protocol.ts`
- Modify: `apps/web/src/shared/utils/session.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/services/http/session.service.ts`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Modify: `apps/web/src/features/workspace/session-history.ts`
- Modify: `apps/web/src/features/workspace/session-actions.ts`
- Modify: `apps/web/src/features/workspace/workspace-recovery.ts`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx`
- Modify: `apps/web/src/i18n.ts`

**Tests**
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/provider_hooks.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `tests/session-history.test.ts`
- Modify: `tests/session-service.test.ts`
- Modify: `tests/session-actions.test.ts`
- Modify: `tests/session-materialization.test.ts`
- Modify: `tests/workspace-recovery.test.ts`
- Modify: `tests/workspace-session-runtime-sync.test.ts`
- Modify: `tests/workspace-runtime-controller.test.ts`
- Modify: `tests/e2e/e2e.spec.ts`
- Modify: `tests/e2e/transport.spec.ts`

### Task 1: Introduce String Session Slots And Persisted Bindings

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/app.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/ws/protocol.rs`
- Modify: `apps/server/src/ws/server.rs`
- Modify: `apps/server/src/main.rs`
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/ws/protocol.ts`
- Test: `apps/server/src/infra/db.rs`
- Test: `apps/server/src/command/http.rs`

- [ ] Change backend `SessionInfo.id`, `WorkspaceSessionState.session_id`, HTTP restore/delete request ids, and websocket `session_update` payload ids from numeric `u64` to string session-slot ids.
- [ ] Add `WorkspaceSessionBinding` to the shared backend model surface with `session_id`, `provider`, `resume_id`, `title_snapshot`, and `last_seen_at`.
- [ ] Extend `WorkspaceViewState` with `session_bindings: Vec<WorkspaceSessionBinding>` and keep it `#[serde(default)]` so old persisted rows still load.
- [ ] Update `load_view_state_from_conn` and `patch_workspace_view_state` so binding arrays round-trip without touching unrelated view-state fields.
- [ ] Add a one-time migration path inside `load_view_state_from_conn` that derives bindings only from legacy mounted `workspace_sessions` rows that still have both `provider` and `resume_id`; ignore archived rows completely.
- [ ] Add an ephemeral `live_sessions` map to `AppState`, keyed by `workspace_id:session_id`, so same-backend refreshes still have session status/provider/title state without reviving durable history rows.
- [ ] Add focused tests that prove string session ids deserialize, legacy view-state payloads load with empty/default bindings, and mounted legacy rows migrate into bindings while archived legacy rows do not.
- [ ] Run: `cargo test --manifest-path apps/server/Cargo.toml infra::db:: command::http::`

### Task 2: Add Provider-Native Claude/Codex Session Adapters

**Files:**
- Modify: `apps/server/src/services/provider_registry.rs`
- Modify: `apps/server/src/services/claude.rs`
- Modify: `apps/server/src/services/codex.rs`
- Modify: `apps/server/src/services/mod.rs`
- Test: `apps/server/src/services/claude.rs`
- Test: `apps/server/src/services/codex.rs`

- [ ] Extend the provider adapter surface with provider-history methods: `list_workspace_sessions`, `session_exists`, and `delete_workspace_session`.
- [ ] Define a provider-derived session record type that carries `provider`, `resume_id`, `title`, `created_at`, and `last_active_at`.
- [ ] Implement Claude workspace listing by mapping the absolute workspace path to Claude’s `~/.claude/projects/<slug>` directory, reading transcript timestamps from `*.jsonl`, and reading the title from the newest matching `~/.claude/history.jsonl` row where both `sessionId` and `project` match.
- [ ] Implement Claude delete by removing the transcript file, removing the sibling session directory if it exists, and rewriting `~/.claude/history.jsonl` to drop rows for the same `sessionId + project`.
- [ ] Implement Codex workspace listing from `~/.codex/state_5.sqlite` `threads` rows filtered by `cwd == workspace_path`, require `rollout_path` to exist, use `threads.title` as the canonical title, and use `created_at` / `updated_at` for times.
- [ ] Implement Codex delete by removing the rollout file, deleting the `threads` row, deleting matching `logs` rows, deleting matching `thread_spawn_edges` rows, rewriting `~/.codex/history.jsonl`, and removing `~/.codex/shell_snapshots/<resumeId>.*`.
- [ ] Add adapter fixture tests for Claude title selection, Codex title selection, existence checks, and destructive delete behavior against temp directories/temp sqlite databases.
- [ ] Run: `cargo test --manifest-path apps/server/Cargo.toml services::claude:: services::codex::`

### Task 3: Rebuild Backend Snapshot, History, And Recovery Around Bindings

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/workspace_runtime.rs`
- Modify: `apps/server/src/services/provider_hooks.rs`
- Modify: `apps/server/src/services/session_runtime.rs`
- Modify: `apps/server/src/services/agent.rs`
- Test: `apps/server/src/services/workspace.rs`
- Test: `apps/server/src/services/workspace_runtime.rs`
- Test: `apps/server/src/services/provider_hooks.rs`

- [ ] Replace `build_snapshot_from_conn` session assembly with a slot-based builder: collect session ids from `view_state.pane_layout`, merge live in-memory session state, merge persisted bindings, and emit one session placeholder per visible slot.
- [ ] Remove `archive` from `WorkspaceSnapshot`; snapshot sessions should now represent only visible pane slots, not archived history rows.
- [ ] For unbound slots, emit draft placeholders so empty panes survive page refresh and backend restart without creating DB session rows.
- [ ] For bound slots with provider data still present, emit recoverable session placeholders using provider-native title/time and the bound `resume_id`.
- [ ] Whenever a binding successfully resolves against provider data, refresh its `title_snapshot` and `last_seen_at` from the provider-derived title/time so missing placeholders reuse the last real provider label.
- [ ] For bound slots whose provider data no longer exists, emit unavailable placeholders with a human-readable reason string exactly matching `该会话已经被删除，无法恢复`, while keeping the dead binding until the user removes it explicitly.
- [ ] In `workspace_runtime_attach`, probe each persisted binding on reopen. If the provider session still exists and there is no live runtime already bound, auto-resume it before returning the runtime snapshot. If it is missing, return the unavailable placeholder and skip auto-resume.
- [ ] Change `provider_hooks` so resume-id capture updates the matching binding and live-session state only; remove `set_session_resume_id` writes into `workspace_sessions`.
- [ ] Change runtime launch resolution in `session_runtime.rs` and `agent.rs` so start/resume uses the string session slot id plus provider/binding data instead of parsing a numeric DB row id.
- [ ] Run: `cargo test --manifest-path apps/server/Cargo.toml services::workspace:: services::workspace_runtime:: services::provider_hooks::`

### Task 4: Replace History, Restore, Delete, And Archive RPC Semantics

**Files:**
- Modify: `apps/server/src/models.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/main.rs`
- Test: `apps/server/src/command/http.rs`
- Test: `apps/server/src/services/workspace.rs`

- [ ] Keep `list_session_history` as the public RPC name, but assemble records from provider adapters plus bindings instead of `workspace_sessions`.
- [ ] Change history record identity to provider-native keys and return `provider`, `resume_id`, `mounted`, `archived`, `availability`, `recoverable`, `title`, and provider-derived timestamps.
- [ ] Mark `archived = true` only when provider data exists and no current session binding in that workspace references the same `(provider, resume_id)`.
- [ ] Synthesize `missing` history rows only from dead bindings whose provider data is gone; use `title_snapshot` for the display title when available.
- [ ] Replace numeric-row restore/delete requests with provider-keyed requests:
  `restore_provider_session(workspace_id, session_id, provider, resume_id)`
  `delete_provider_session(workspace_id, provider, resume_id)`
  `remove_missing_binding(workspace_id, session_id)`
- [ ] Stop treating `create_session` as a durable history write. Starting a new session from a draft slot should launch directly from that slot and wait for provider hooks to persist the binding once a real provider `resume_id` exists.
- [ ] Remove `archive_session` as a backend persistence operation. The server-side archive path should become “unmount this slot”: stop any live runtime, clear the binding, and leave provider data untouched.
- [ ] Make `delete_provider_session` stop any mounted runtime for the same `(provider, resume_id)`, remove every matching session binding in that workspace, and let the record disappear from derived history once provider storage is gone.
- [ ] Update close-workspace behavior to stop live runtimes and clear bindings for visible slots so those provider sessions become archived automatically the next time history is listed.
- [ ] Update the optional controller guard helper and public-mode filtering to use the new provider-keyed request types.
- [ ] Run: `cargo test --manifest-path apps/server/Cargo.toml command::http:: services::workspace::`

### Task 5: Refactor Frontend State, Session Actions, And History UI

**Files:**
- Modify: `apps/web/src/types/app.ts`
- Modify: `apps/web/src/state/workbench-core.ts`
- Modify: `apps/web/src/shared/utils/session.ts`
- Modify: `apps/web/src/shared/utils/workspace.ts`
- Modify: `apps/web/src/services/http/session.service.ts`
- Modify: `apps/web/src/services/http/workspace.service.ts`
- Modify: `apps/web/src/features/workspace/session-history.ts`
- Modify: `apps/web/src/features/workspace/session-actions.ts`
- Modify: `apps/web/src/features/workspace/workspace-recovery.ts`
- Modify: `apps/web/src/features/workspace/workspace-sync-hooks.ts`
- Modify: `apps/web/src/features/app/WorkbenchRuntimeCoordinator.tsx`
- Modify: `apps/web/src/features/workspace/WorkspaceScreen.tsx`
- Modify: `apps/web/src/components/HistoryDrawer/HistoryDrawer.tsx`
- Modify: `apps/web/src/i18n.ts`
- Test: `tests/session-history.test.ts`
- Test: `tests/session-service.test.ts`
- Test: `tests/session-actions.test.ts`
- Test: `tests/session-materialization.test.ts`
- Test: `tests/workspace-recovery.test.ts`
- Test: `tests/workspace-session-runtime-sync.test.ts`
- Test: `tests/workspace-runtime-controller.test.ts`

- [ ] Remove `Tab.archive` and `viewingArchiveId` from frontend state; archived sessions should exist only in the provider-derived history drawer.
- [ ] Change frontend history records to use provider-native identity and explicit `availability` instead of numeric `sessionId` row ids and archive snapshots.
- [ ] Update `HistoryDrawer` copy and state badges so records render as live, archived, or unavailable/missing based on derived history state, not on local archived snapshots.
- [ ] Rework `archiveSessionForTab` into a local unmount flow that clears the bound slot, stops the runtime, replaces the slot with a draft placeholder, and refreshes derived history.
- [ ] Remove `createSessionRequest` from draft materialization so starting a new session no longer creates a backend history/session row before launch.
- [ ] Rework `restoreSessionIntoPane` so it binds the chosen `(provider, resumeId)` onto the target session slot id, keeps the current pane, and then starts the provider runtime in resume mode.
- [ ] Rework history focus selection so a mounted record focuses the matching visible slot by `(provider, resumeId)` instead of by comparing record ids to local numeric session ids.
- [ ] Add missing-session handling in the workspace screen: unavailable placeholders stay visible in their pane, are not auto-started, and offer a `Remove from workspace` action instead of a fake delete.
- [ ] Remove numeric `parseNumericId` restore/delete/archive assumptions from session services and websocket payloads, and change `session_update` to patch only in-memory slot state plus websocket broadcasts, never durable history rows.
- [ ] Add/update copy for missing session status, unavailable recovery reason, provider delete confirmation, and the workspace-local remove action.
- [ ] Run: `node --test tests/session-history.test.ts tests/session-service.test.ts tests/session-actions.test.ts tests/session-materialization.test.ts tests/workspace-recovery.test.ts tests/workspace-session-runtime-sync.test.ts tests/workspace-runtime-controller.test.ts`

### Task 6: Remove Legacy History Authority And Verify End-To-End

**Files:**
- Modify: `apps/server/src/infra/db.rs`
- Modify: `apps/server/src/services/workspace.rs`
- Modify: `apps/server/src/services/provider_hooks.rs`
- Modify: `apps/server/src/command/http.rs`
- Modify: `tests/e2e/e2e.spec.ts`
- Modify: `tests/e2e/transport.spec.ts`

- [ ] Delete or dead-end the old `workspace_sessions` history/archive helpers so nothing in production paths reads or writes them as history truth anymore.
- [ ] Remove obsolete archive/restore/delete tests that assert local DB-row behavior and replace them with provider-derived history, missing-placeholder, and provider-delete expectations.
- [ ] Add e2e coverage for these flows:
  start Claude/Codex session, capture binding, close/unmount it, verify history shows archived
  restore an archived provider record into the active pane and verify provider resume starts immediately
  reopen a workspace after backend restart and verify bound sessions auto-resume only when the provider record still exists
  delete provider data outside the app, reopen, verify the pane shows unavailable and cannot auto-recover
  remove the missing placeholder from the workspace and verify only the dead binding disappears
- [ ] Run: `pnpm test:server`
- [ ] Run: `pnpm test:web:unit`
- [ ] Run: `pnpm test:e2e --grep "history|restore|delete|reopen"`

## Self-Review

- Spec coverage: provider-native history, provider-native delete, derived archive, missing placeholders, auto-resume on reopen, Claude/Codex title rules, and binding-only durability are all covered by Tasks 1 through 6.
- Placeholder scan: no `TODO`, `TBD`, or “handle later” placeholders remain in the task list.
- Type consistency: the plan uses string session-slot ids for visible panes and provider-native `(provider, resume_id)` keys for history records throughout; it does not mix them back into numeric DB-row ids.

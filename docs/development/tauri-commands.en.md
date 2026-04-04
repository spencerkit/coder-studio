# Transport Command Inventory

[中文](tauri-commands.md)

This document lists the current transport commands, their execution path, and how they are used in the current product. The filename is kept for historical continuity, but the runtime no longer depends on a Tauri shell.

## 1. Invocation Path

The frontend now uses HTTP RPC via `/api/rpc/:command`.

Relevant code:

- frontend RPC client: `apps/web/src/services/http/client.ts`
- backend command dispatcher: `apps/server/src/command/http.rs`
- server entry point: `apps/server/src/main.rs`

Streamed events do not come back through RPC responses. They are delivered over WebSocket:

- `agent://event`
- `agent://lifecycle`
- `terminal://event`

## 2. Command Groups

The registered commands currently fall into six groups:

- workspace and session
- Git and worktree
- files and filesystem
- system and runtime probing
- terminal
- agent

## 3. Workspace and Session

| Command | Purpose | Current UI Usage |
| --- | --- | --- |
| `init_workspace` | initialize a workspace by cloning a remote repo or resolving a local Git root | used |
| `tab_snapshot` | fetch backend snapshot for a tab | used |
| `create_session` | create a materialized session | used |
| `session_update` | update session status, mode, auto_feed, active time, or Claude session ID | used |
| `switch_session` | switch active session | used |
| `archive_session` | archive a session and stop its agent runtime | used |
| `update_idle_policy` | update tab-level idle policy | used |
| `queue_add` | add a queue task | backend present, main UI not fully exposed |
| `queue_run` | run a queue task | backend present, main UI not fully exposed |
| `queue_complete` | complete a queue task | backend present, main UI not fully exposed |
| `worktree_inspect` | fetch worktree details, diff, and tree | used, mainly through modal flow |

Notes:

- The `queue_*` commands show that queue capability still exists in the backend even though the main UI does not expose a full queue board.
- `archive_session` is already wired into the actual pane-closing flow for non-draft sessions.

## 4. Git and Worktree

| Command | Purpose | Current UI Usage |
| --- | --- | --- |
| `git_status` | fetch branch, change count, and latest commit | used |
| `git_diff` | fetch repository-wide diff | used |
| `git_changes` | fetch grouped Git changes | used |
| `git_diff_file` | fetch plain-text diff for one file | used as fallback |
| `git_file_diff_payload` | fetch structured single-file diff payload | used |
| `git_stage_all` | stage everything | used |
| `git_stage_file` | stage one file | used |
| `git_unstage_all` | unstage everything | used |
| `git_unstage_file` | unstage one file | used |
| `git_discard_all` | discard all changes | used |
| `git_discard_file` | discard one file | used |
| `git_commit` | create a commit | used |
| `worktree_list` | list worktrees | used during refresh, but UI entry point is incomplete |

Notes:

- `worktree_list` data is refreshed into frontend state, but the current UI does not offer a clear always-visible worktree list surface.
- `git_file_diff_payload` is the main command behind structured single-file diff UX.

## 5. Files and Filesystem

| Command | Purpose | Current UI Usage |
| --- | --- | --- |
| `workspace_tree` | build repository tree and changes tree | used |
| `file_preview` | read file content for preview | used |
| `file_save` | save file content | used |
| `filesystem_roots` | fetch available filesystem roots | indirectly used |
| `filesystem_list` | browse backend-side directories | used |
Notes:

- Current local-folder onboarding is primarily driven by the backend directory browser built around `filesystem_list`.

## 6. System and Runtime Probing

| Command | Purpose | Current UI Usage |
| --- | --- | --- |
| `command_exists` | validate whether the launch command can run | used |

Notes:

- `command_exists` is important for Settings because it reports whether the configured runtime command is available.

## 7. Terminal Commands

| Command | Purpose | Current UI Usage |
| --- | --- | --- |
| `terminal_create` | create a shell PTY | used |
| `terminal_write` | write input to terminal PTY | used |
| `terminal_resize` | sync terminal size | used |
| `terminal_close` | close terminal and clean runtime | used |

Output channel:

- `terminal://event`

## 8. Agent Commands

| Command | Purpose | Current UI Usage |
| --- | --- | --- |
| `agent_start` | start agent PTY and inject Claude hook configuration in Claude mode | used |
| `agent_send` | write input to the agent | used |
| `agent_stop` | stop the agent runtime | used |
| `agent_resize` | sync PTY size for the agent | used |

Related event channels:

- `agent://event`
- `agent://lifecycle`

## 9. Event Channels

| Event | Meaning |
| --- | --- |
| `agent://event` | agent output, system messages, and exit events |
| `agent://lifecycle` | normalized lifecycle events derived from Claude hooks |
| `terminal://event` | embedded terminal output |

`agent://lifecycle` currently carries these normalized kinds:

- `session_started`
- `turn_waiting`
- `tool_started`
- `tool_finished`
- `approval_required`
- `turn_completed`
- `session_ended`

## 10. How to Read Command Capability

When documenting product functionality, commands should be interpreted carefully:

- command availability does not automatically mean complete UI exposure
- frontend usage does not automatically mean users have a durable obvious entry point
- a capability should be described as “shipped” only when backend support, frontend state handling, and a stable user-facing entry point all exist together

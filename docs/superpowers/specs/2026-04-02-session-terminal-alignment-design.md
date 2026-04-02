# Session Terminal Alignment Design

## Goal

Simplify session runtime behavior so it follows the workspace terminal model instead of maintaining a separate agent-specific PTY stack.

After this redesign:

- session startup creates a normal shell runtime
- the only provider-specific startup difference is the boot command written into that shell after startup
- live input and output for sessions use the same terminal path as workspace terminals
- session status is driven by provider hooks and shell-exit semantics, not by agent runtime fallbacks
- the session-to-shell relationship is a runtime-only binding that disappears when the shell exits or the service restarts

## Decision

Adopt a terminal-aligned session runtime model with three distinct layers:

1. persistent session business state
2. generic terminal runtime plumbing
3. runtime-only session-to-terminal bindings

This replaces the current design where session runtime behavior is split across:

- `AgentRuntime`
- `agent_start / agent_send / agent_resize / agent_stop`
- `agent://event` stdout/stderr transport
- provider-specific input policies attached to a dedicated agent PTY
- output-driven lifecycle fallback heuristics

The target model is:

- sessions remain the business object
- terminals remain the shell runtime object
- a session may temporarily bind to a terminal at runtime
- provider CLIs run inside that bound shell as commands, not as directly spawned session-owned PTYs

## Non-Goals

This design does not attempt to solve:

- removing sessions as a product concept
- redesigning the draft/history/archive UX
- replacing provider hooks with shell-output parsing
- changing provider-specific hook normalization
- exposing session terminals as first-class items in the bottom workspace terminal panel
- preserving live session terminal bindings across service restart

## Current Runtime Chains

Today the codebase has two separate runtime chains.

### 1. Session -> Agent Runtime -> Provider CLI

Current session startup flow:

1. frontend materializes a draft session via `create_session`
2. frontend calls `agent_start`
3. backend loads the session provider and resume ID
4. backend resolves a provider-specific launch command
5. backend creates a dedicated PTY
6. backend spawns the provider CLI directly in that PTY
7. backend stores that runtime in `state.agents`

Current live input flow:

1. agent pane input goes through `agent_send`
2. backend writes into the dedicated agent PTY
3. provider-specific first-submit behavior may flush/delay before the first newline

Current live output flow:

1. provider stdout/stderr is read from the dedicated agent PTY
2. backend emits `agent://event`
3. backend appends output into `session.stream`
4. frontend renders session output primarily from session-specific stream state

Current status flow:

- provider hooks emit lifecycle events
- frontend updates `waiting / running / idle / resumeId` from lifecycle events
- backend also contains output/exit fallback logic that synthesizes lifecycle events when hooks do not arrive

### 2. Terminal -> Shell Runtime

Current workspace terminal flow:

1. frontend calls `terminal_create`
2. backend creates a PTY
3. backend spawns the normal workspace shell
4. backend stores the runtime in `state.terminals`
5. backend persists terminal output in `workspace_terminals`

Current live input/output flow:

- input uses `terminal_write`
- output uses `terminal://event`
- frontend renders from `tab.terminals[].output`

Current status flow:

- terminal state is limited to shell liveness and `recoverable`
- there is no provider-specific session lifecycle logic in the terminal stack

## Problems In The Current Split Model

The current design is more complex than necessary because session runtime behavior diverges from terminal behavior in almost every layer:

- a separate backend runtime map
- separate create/send/resize/stop RPCs
- separate output transport channel
- separate frontend input pipeline
- separate startup gating and runtime bookkeeping
- separate output buffering and live-terminal append logic

This makes session behavior harder to reason about and duplicates logic that already exists in the terminal stack.

## Target Architecture

The redesign keeps sessions and terminals as separate concepts, but removes the dedicated agent runtime.

### Persistent Session Layer

Sessions remain the durable business object. They continue to persist:

- `provider`
- `resumeId`
- `status`
- `title`
- `lastActiveAt`
- history/archive-related metadata
- transcript-like session presentation data

Sessions do not persist any terminal binding.

### Generic Terminal Layer

Terminals remain generic shell runtimes. The terminal model does not gain session business fields.

Terminal responsibilities remain:

- PTY lifecycle
- shell stdin/stdout
- resize
- recoverability

### Runtime Binding Layer

Session-to-terminal binding is maintained only in runtime memory.

Recommended runtime state:

```ts
session_runtime_bindings: Map<SessionId, TerminalId>
terminal_runtime_bindings: Map<TerminalId, SessionId>
```

This binding layer is:

- not persisted in `workspace_sessions`
- not persisted in `workspace_terminals`
- cleared when the shell exits
- cleared on service restart

### Session Runtime Startup

A new backend orchestration RPC starts session runtime behavior:

```ts
session_runtime_start(workspaceId, sessionId, cols?, rows?) -> { terminalId, started }
```

Its responsibilities are:

1. create a normal shell runtime using terminal plumbing
2. inject session hook environment into that shell runtime
3. establish the runtime-only session-to-terminal binding
4. write the resolved provider boot command into the shell

This is not a new agent runtime. It is a thin session-domain orchestration layer over terminal runtime creation.

## Terminal Reuse Model

The implementation should reuse terminal runtime plumbing, but not force session business state into the terminal persistence model.

Recommended split:

- keep `terminal_create` for user-created workspace terminals
- extract a lower-level internal helper such as `create_terminal_runtime(...)`
- use that helper from:
  - `terminal_create`
  - `session_runtime_start`

Important difference:

- workspace terminals continue to persist in `workspace_terminals`
- session-bound terminals are runtime-only shells and are not persisted as standalone workspace terminals

This keeps the terminal domain generic and prevents stale session-owned terminals from appearing as normal workspace terminals after service restart.

## Boot Command Resolution

Provider startup no longer means "spawn the provider CLI directly."

Instead, provider startup means:

1. create a normal shell
2. resolve a provider-specific shell command
3. write that command into the shell followed by Enter

Examples:

- new Claude session -> `claude ...`
- resumed Claude session -> `claude ... --resume <id>`
- new Codex session -> `codex ...`
- resumed Codex session -> `codex resume <id> ...`

Command resolution remains a backend responsibility because only the backend should own:

- app settings resolution
- target-specific executable/profile resolution
- provider-specific hook integration
- resume/start command assembly

## Input And Output Model

### Live Input

After startup, session input is identical to terminal input:

- agent pane input resolves the bound terminal ID from runtime bindings
- frontend sends `terminal_write`
- backend writes directly to shell stdin

`agent_send` leaves the main path.

### Live Output

After startup, session output is identical to terminal output:

- shell stdout/stderr emits terminal output
- backend sends `terminal://event`
- frontend renders session panes from the bound terminal output

`agent://event` stdout/stderr leaves the main path.

### Session Transcript

`session.stream` remains as a transcript/presentation field, not as a live I/O transport.

Recommended role after the redesign:

- do not treat `session.stream` as the live source of truth while a session is bound to a terminal
- update it as a transcript mirror for persistence and archive/history presentation
- use it as fallback presentation when the session is no longer bound to a live terminal

This preserves continuity after shell exit or service restart without keeping a dedicated agent runtime alive.

## Hook And Status Model

Session lifecycle state becomes simpler:

- `waiting / running / idle / resumeId` come from provider hooks
- `interrupted` comes from shell termination while a runtime binding existed

The target model intentionally removes the output-driven lifecycle fallback currently embedded in `agent.rs`.

Recommended behavior:

- keep the shared provider hook receiver
- keep provider-specific hook normalization
- continue to emit lifecycle events from hooks
- stop deriving `running` from first output and `turn_completed` from process exit fallback

The status boundary becomes:

- hooks tell the app what the agent is doing
- shell exit tells the app the runtime disappeared

## Runtime Snapshot Shape

Because bindings are runtime-only, frontend state needs a runtime projection from the backend.

Recommended addition to `WorkspaceRuntimeSnapshot`:

```ts
session_runtime_bindings: Array<{
  session_id: string;
  terminal_id: string;
}>
```

This field:

- is not stored in the database
- is produced when the runtime snapshot is assembled
- is empty after service restart until sessions are started again

Frontend state can derive:

- session pane -> terminal lookup
- terminal filtering for the bottom panel
- interrupted/no-runtime agent pane states

## Frontend Changes

### Agent Pane Rendering

Agent panes should render in three states:

1. draft session chooser
2. live bound terminal
3. unbound session fallback view

Live bound terminal behavior:

- resolve the session's terminal ID from runtime bindings
- render the bound terminal output
- send keyboard input via `terminal_write`
- send resize via `terminal_resize`

Unbound session behavior:

- render transcript/fallback output from `session.stream`
- show restart/resume affordances when `status === interrupted`

### Bottom Terminal Panel

The bottom workspace terminal panel should continue to show only user-created workspace terminals.

Implementation rule:

- terminals referenced by `session_runtime_bindings` are excluded from the bottom panel

This keeps session runtime shells out of the generic terminal UI without adding session semantics to the terminal model itself.

### Frontend Cleanup

The following frontend systems leave the main path:

- `agentSend`
- `sendAgentRawChunk`
- `sendRawAgentInput`
- agent startup gates
- `runningAgentKeysRef`
- agent runtime-specific resize tracking
- live agent chunk append plumbing
- `session.stream` as the live rendering source

## Backend Changes

### Keep

- session CRUD
- provider hook receiver
- provider adapter command resolution
- workspace terminal runtime plumbing
- terminal read/write/resize helpers

### Add

- `session_runtime_start`
- runtime binding maps
- terminal-runtime creation helper reusable by both workspace terminals and session runtime startup
- runtime snapshot binding projection
- shell-exit handling that marks bound sessions `interrupted`

### Remove Or De-Mainline

- `AgentRuntime`
- `agent_start`
- `agent_send`
- `agent_resize`
- dedicated agent stdout/stderr event transport
- output-driven lifecycle fallback

`agent://lifecycle` may remain as the hook/lifecycle transport channel in this phase. Renaming that channel is out of scope.

## Lifecycle Scenarios

### 1. Start A New Session

1. frontend calls `create_session`
2. frontend calls `session_runtime_start`
3. backend creates a shell runtime
4. backend binds session <-> terminal in memory
5. backend writes the provider boot command into the shell
6. frontend receives the runtime binding projection and renders the bound terminal

### 2. Shell Exit

When a bound shell exits:

1. backend removes the runtime binding
2. backend marks the session `interrupted`
3. backend preserves transcript state in session persistence
4. frontend stops treating the session as live-bound and falls back to transcript view

### 3. Service Restart

On service restart:

- all live terminal runtimes disappear
- all runtime bindings disappear
- any previously live session becomes `interrupted`
- there are no session runtime bindings until the user restarts or resumes a session

The system does not attempt to fake a live shell after restart.

### 4. Restore History

History restore becomes:

1. restore the session business record
2. call `session_runtime_start`
3. create a fresh shell runtime
4. bind that runtime to the restored session
5. auto-write start or resume command depending on `resumeId`

This means normal restart and history restore share the same runtime path.

## Error Handling

The design should handle these failures explicitly:

- shell creation fails -> session remains unbound; show startup error; do not create binding
- boot command resolution fails -> destroy the just-created shell runtime and return an error
- boot command write fails -> destroy the shell runtime, clear binding, and report startup failure
- shell exits before hooks arrive -> session becomes `interrupted`
- hook payload arrives for an unbound session -> still update session lifecycle state if the session exists

Key rule:

- binding is created only after shell runtime creation succeeds
- binding is removed immediately when shell runtime becomes unavailable

## Migration Notes

This repo is still in development, so the migration can prioritize clarity over backward compatibility.

Recommended migration stance:

- session persistence remains intact
- workspace terminal persistence remains intact for user-created workspace terminals
- no attempt is made to preserve dedicated agent runtime state
- legacy agent runtime code can be removed once the terminal-aligned path is verified

## Testing Strategy

The implementation plan should include focused tests for:

- `session_runtime_start` creates a shell and writes the correct provider start command
- `session_runtime_start` writes the correct resume command when `resumeId` exists
- session pane input routes through `terminal_write`
- session pane output renders from terminal output while bound
- bound shell exit marks the session `interrupted`
- service restart clears runtime bindings and leaves sessions recoverable via restart/resume
- history restore starts a fresh shell and reuses the same start/resume decision logic
- bottom terminal panel excludes session-bound terminals
- hook-driven lifecycle updates continue to update session status and resume ID

## Summary

The redesign removes the dedicated agent PTY model and re-centers session runtime behavior on the existing terminal model.

The final structure is:

- sessions own business identity
- terminals own shell I/O
- runtime bindings connect them temporarily
- hooks own lifecycle state
- provider-specific startup differences collapse to one backend-resolved boot command written into a normal shell

This preserves the product-level session model while removing the runtime split that currently makes session behavior harder to reason about than workspace terminal behavior.

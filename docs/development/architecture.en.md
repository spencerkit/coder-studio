# Architecture

[中文](architecture.md)

This document describes the current high-level architecture, module responsibilities, and the most important runtime flows.

## 1. Overall Shape

The project is a Tauri desktop application with a React + Vite frontend and a Rust backend.

The runtime layering looks like this:

```text
React UI (src/App.tsx)
    |
    |-- HTTP RPC (/api/rpc/:command) first
    |-- Tauri invoke fallback
    |-- WebSocket subscriptions (/ws)
    v
Rust Tauri Host
    |
    |-- workspace/session services
    |-- git / filesystem services
    |-- terminal / agent PTY services
    |-- Claude hook receiver
    v
Local Runtime Tools
    |
    |-- git
    |-- shell / PTY
    |-- claude
    |-- wsl.exe (optional)
    v
Local Persistence
    |
    |-- Local Storage
    |-- SQLite
```

## 2. Frontend Responsibilities

The frontend is still driven largely by a single top-level view:

- `src/App.tsx`: most UI, interaction, and orchestration logic
- `src/state/workbench.ts`: core models for workspaces, sessions, panes, terminals, and file previews
- `src/types/app.ts`: shared frontend/backend payload types
- `src/services/http/`: RPC wrappers
- `src/ws/`: WebSocket connection and subscription layer

The frontend is responsible for:

- rendering workspace surfaces and panels
- turning draft sessions into live sessions
- maintaining the split-pane tree and ratios
- consuming agent, terminal, and Claude lifecycle events
- coordinating code preview, Git actions, terminal behavior, and settings state

## 3. Backend Responsibilities

The backend entry point is `src-tauri/src/main.rs`.

Concrete service responsibilities are split into:

- `src-tauri/src/services/workspace.rs`
- `src-tauri/src/services/git.rs`
- `src-tauri/src/services/filesystem.rs`
- `src-tauri/src/services/terminal.rs`
- `src-tauri/src/services/agent.rs`

The backend is responsible for:

- repository initialization and workspace resolution
- session metadata management
- Git command execution
- file tree and file content read/save
- shell terminal and agent PTY lifecycle management
- Claude hook reception and event broadcasting
- local database persistence

## 4. Transport Layer Design

The current implementation supports two command paths:

- HTTP RPC: the frontend tries `/api/rpc/:command` first
- Tauri invoke: if HTTP is unavailable, it falls back to `@tauri-apps/api/core.invoke`

This enables:

- direct Tauri runtime usage in desktop mode
- local HTTP/WS backend usage in split-debug mode
- one event stream mechanism for agent and terminal output

Relevant code:

- frontend: `src/services/http/client.ts`
- backend: `src-tauri/src/command/http.rs`
- WebSocket: `src/ws/connection-manager.ts`, `src-tauri/src/ws/server.rs`

## 5. Core Runtime Flows

### 5.1 Workspace Launch

1. The frontend shows the onboarding overlay.
2. The user selects `Remote Git` or `Local Folder`.
3. The frontend calls `init_workspace`.
4. The backend clones the repo or resolves the local Git root in the selected execution target.
5. The frontend refreshes Git data, file tree data, and worktree data.

### 5.2 Draft Task to Live Agent

1. A new pane starts as a draft session.
2. The user enters the first task in the draft input.
3. The frontend materializes that draft into a backend session.
4. It then calls `agent_start`.
5. The backend opens a PTY and launches the actual agent command.
6. Agent output is streamed back through transport events.
7. The pane switches from draft input UI to terminal-stream UI.

### 5.3 Agent Event Flow

There are two agent-related event channels:

- `agent://event`: stdout/system/exit stream events
- `agent://lifecycle`: normalized Claude lifecycle events

Regular agent events are used to:

- update pane terminal output
- update unread counts
- trigger toasts
- handle exit state

Lifecycle events are used to:

- update session status
- capture Claude session IDs
- detect waiting, tool execution, approval, and completion phases

### 5.4 Code and Git Refresh

The code and Git surfaces are kept in sync by a parallel refresh group:

- `git_status`
- `git_changes`
- `worktree_list`
- `workspace_tree`

After save, stage, unstage, discard, or commit actions, the frontend refreshes workspace artifacts again so the right-side code/Git panels stay aligned.

### 5.5 Terminal Stream Flow

1. The frontend calls `terminal_create`.
2. The backend creates a PTY and starts a shell.
3. Output is pushed through `terminal://event`.
4. User input goes back through `terminal_write`.
5. Size changes are synced through `terminal_resize`.

### 5.6 Claude Hook Loop

The app starts a local hook receiver during startup.

The flow is:

1. The backend opens a local HTTP hook endpoint.
2. `agent_start` injects environment variables and `.claude/settings.local.json` in Claude mode.
3. Claude runs the configured hook command.
4. The hook helper posts events back to the local endpoint.
5. The app normalizes the raw Claude hook event and broadcasts it as `agent://lifecycle`.

## 6. Persistence

There are currently two persistence layers:

- frontend Local Storage
- backend SQLite

The frontend stores:

- workspace layout
- session/pane snapshots
- global settings
- selected language

The backend stores:

- session snapshots
- archive snapshots

Database initialization and persistence logic live in:

- `src-tauri/src/main.rs`
- `src-tauri/src/infra/db.rs`

## 7. Dev Mode vs Production Mode

In development mode:

- the Vite frontend runs on `5174`
- the Rust transport service runs on `41033`
- the frontend reaches `/api`, `/ws`, and `/health` through proxying

In production mode:

- the Rust transport service serves both frontend assets and API/WS endpoints
- the static app shell and transport layer are hosted by the same process

## 8. Current Architectural Constraints

- Main UI orchestration is still highly concentrated in `src/App.tsx`.
- Queue, archive, and worktree backend capabilities are ahead of their UI exposure.
- Some modeled concepts such as `branch` / `git_tree` are not yet full product flows.
- The frontend still relies heavily on “refresh workspace artifacts” instead of more granular incremental syncing.

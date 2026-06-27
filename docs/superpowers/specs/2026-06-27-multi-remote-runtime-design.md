# Multi-Remote Runtime Aggregation Design

> **Status:** Draft for user review  
> **Date:** 2026-06-27  
> **Scope:** `packages/server`, `packages/web`, `packages/core`, tests

## Goal

Allow one Coder Studio frontend and one primary Coder Studio server to manage workspaces across multiple remote Coder Studio nodes without changing the existing deployment shape of each node.

Users should keep one browser entrypoint and one active websocket connection to the primary server, then choose a target server when opening a workspace. After that, workspace-backed operations should route through the primary server to the bound remote node.

## Decisions

- Keep the browser connected only to the primary server.
- Treat each remote Coder Studio node as a `remote runtime`, not as a separate frontend or a blind reverse-proxy target.
- Keep browser activation gating and workspace fencing on the primary server.
- Add a separate remote host-control lease on each remote node so only one primary server manages a node at a time.
- Keep workspace execution state authoritative on the bound node.
- Keep workspace UI state authoritative on the primary server.
- Do not introduce browser-direct connections to remote nodes in phase 1.
- Do not introduce remote settings federation in phase 1.

## Non-Goals

- Do not turn the browser into a multi-node connection manager.
- Do not expose remote node API tokens to the browser.
- Do not support one workspace spanning multiple nodes.
- Do not support workspace migration between nodes in phase 1.
- Do not add centralized editing of remote provider installs, updates, diagnostics, or system settings in phase 1.
- Do not rely on blind request forwarding or raw websocket passthrough for workspace behavior.

## Existing Context

- `packages/web/src/ws/client.ts` maintains one frontend websocket connection to the current server.
- `packages/server/src/ws/dispatch.ts` routes websocket commands and enforces activation gating before command execution.
- `packages/server/src/ws/activation.ts` implements single-active browser control for the current server.
- `packages/server/src/ws/fencing.ts` implements workspace-level controller and observer behavior.
- `packages/server/src/host/runtime-router.ts` routes runtime commands by workspace, session, or terminal bindings.
- `packages/server/src/host/workspace-runtime-binding.ts` stores the mapping from workspace to runtime and from sessions and terminals back to workspace.
- `packages/server/src/runtime/contract.ts` defines runtime command targets and runtime handles.
- Most workspace-backed commands already run as runtime commands:
  - `file/*`
  - `git/*`
  - `session/*`
  - `terminal/*`
  - `task/*`
  - `lsp/*`
  - `worktree/*`
- `packages/server/src/commands/workspace.ts` still mixes host-level workspace lifecycle commands with runtime-level workspace inspection commands.
- `packages/server/src/storage/repositories/workspace-repo.ts` persists workspace metadata, including `uiState`.
- `packages/server/src/workspace/history-store.ts` persists recent workspace history keyed only by path today.

## Problem Statement

The current runtime model assumes one server instance owns both:

- the browser control plane, and
- the workspace execution plane.

That works for local and WSL runtimes because they still execute under the same server process. It does not work for multiple remote servers because:

- the browser cannot safely own multiple independent websocket sessions and activation rules,
- remote node credentials should stay server-side,
- workspace lists and workspace events must be unified before the browser sees them, and
- the current single-active browser rule would conflict with remote execution if remote nodes tried to apply the same browser-facing activation semantics.

The design therefore needs a new server-to-server runtime layer, not a browser-to-server fanout model.

## Proposed Architecture

### Topology

The deployment shape remains:

- one primary Coder Studio instance, with its existing web UI and server,
- zero or more remote Coder Studio instances, each installed and started the same way as today.

The runtime topology becomes:

```text
Browser
  -> primary server /ws
    -> runtime router
      -> local runtime
      -> wsl runtime
      -> remote runtime (one per remote node)
         -> remote node internal HTTPS/WSS endpoints
```

### Responsibilities

Primary server responsibilities:

- browser auth and websocket lifecycle
- activation gating
- workspace fencing
- remote server registry
- runtime registration for local, WSL, and remote nodes
- global workspace list aggregation
- workspace-to-runtime binding
- host-side ID wrapping and translation
- UI state persistence
- fan-in of remote events and terminal streams

Remote node responsibilities:

- local filesystem access for workspaces on that node
- local session and terminal execution
- local git, task, LSP, and worktree operations
- local workspace existence and workspace snapshots
- remote host-control lease enforcement

### Why this is not a blind proxy

The primary server should not forward raw browser traffic to a remote node. Instead, it should route known runtime operations at the application layer.

This is an application gateway or RPC relay model:

- the browser keeps one stable protocol with the primary server,
- the primary server maps workspace-backed commands to a remote runtime,
- the remote node executes those commands natively,
- results and events are normalized back into the primary server's domain model.

This keeps routing explicit and preserves the current single websocket UX.

## Data Model

### Remote server registry

Add a primary-server-only `RemoteServer` record with fields equivalent to:

```ts
{
  id: string;
  name: string;
  baseUrl: string;
  token: string;
  enabled: boolean;
  lastHealth: "unknown" | "healthy" | "degraded" | "offline";
  lastVersion?: string;
  lastSeenAt?: number;
  lastError?: string;
}
```

This record is the connection definition for a remote node, not a workspace or runtime snapshot.

### Runtime handle

Extend `RuntimeHandle["kind"]` in `packages/server/src/runtime/contract.ts` from:

- `native`
- `wsl`

to:

- `native`
- `wsl`
- `remote`

Each enabled remote server becomes one runtime handle:

- runtime id: `remote:<serverId>`
- runtime kind: `remote`

### Workspace metadata

Extend `Workspace` in `packages/core/src/domain/types.ts` with:

```ts
{
  serverId: string;
  originWorkspaceId?: string;
}
```

Rules:

- local workspaces use `serverId: "local"`
- remote workspaces use the owning remote server id
- `originWorkspaceId` stores the remote node's native workspace id
- `uiState` remains stored on the primary server

### Recent workspace history

Extend `WorkspaceHistoryEntry` with `serverId`.

Without that field, the same path on two different nodes would collide in history and reopen against the wrong target server.

## ID Strategy

The browser should only see primary-server IDs. Remote node IDs should be wrapped into stable host-visible IDs.

Suggested formats:

- workspace id: `rws:<serverId>:<remoteWorkspaceId>`
- session id: `rsess:<serverId>:<remoteSessionId>`
- terminal id: `rterm:<serverId>:<remoteTerminalId>`

Benefits:

- avoids collisions with local IDs
- remains stable across primary server restarts
- avoids maintaining a fragile in-memory random mapping table
- makes it trivial for the primary server to recover `serverId` and remote object id during routing

The wrapped ID format is an internal host convention. The browser still treats these as opaque strings.

## Command Routing Model

### Existing target kinds

Today runtime routing resolves by:

- `workspace`
- `session`
- `terminal`
- `default`

### New target kind

Add:

- `runtime`

Shape:

```ts
{ kind: "runtime"; runtimeId: string }
```

This is needed for commands that target a node before any workspace exists, especially:

- `workspace.browse`
- `workspace.mkdir`
- remote node capability probes
- any future server-scoped read-only status commands

### Workspace open flow

`workspace.open` remains a host command on the primary server, but it must accept a target server selection.

Behavior:

- `serverId = "local"` binds to existing local runtime behavior
- any remote `serverId` resolves to runtime `remote:<serverId>`
- the primary server asks that runtime to open the workspace remotely
- the returned remote workspace is wrapped into a primary-server workspace record
- the primary server persists `uiState` locally and binds the workspace to the remote runtime

## Internal Primary-to-Remote Protocol

### Transport split

Use two transport classes between the primary server and each remote node.

HTTPS:

- connectivity test during server registration
- version and health checks
- lightweight capability inspection

WSS:

- runtime command request and response
- workspace snapshot synchronization
- domain events
- terminal binary streams
- remote host-control lease heartbeat

### HTTPS endpoints

Phase 1 should add internal authenticated endpoints similar to:

- `GET /internal/node/info`
- `GET /internal/node/health`

Responses should include:

- node instance id
- server version
- protocol version
- supported capabilities
- optional provider runtime summary

These endpoints are for remote server management, not for workspace execution.

### WSS endpoint

Add a dedicated internal runtime websocket endpoint similar to:

- `GET /internal/runtime/ws`

This endpoint must not use browser activation semantics. It is a server-to-server control channel authenticated by the remote server token.

### Handshake sequence

When the primary server connects to a remote node:

1. send `hello`
2. receive protocol and node metadata
3. send `control.claim`
4. receive `control.claimed` or `managed_by_another_host`
5. request `workspace.snapshot`
6. start `control.heartbeat`

### Message types

Use a small message family on the internal runtime websocket:

- `hello`
- `command`
- `result`
- `event`
- `binary`
- `control.claim`
- `control.claimed`
- `control.heartbeat`
- `control.release`
- `workspace.snapshot`

The request and response shape should intentionally resemble the current command and result model so the primary server can adapt existing runtime execution flow with minimal impedance mismatch.

## Concurrency And Takeover Model

There are three distinct concurrency scopes after this feature lands.

### 1. Browser activation lease

Keep `ActivationManager` only on the primary server.

This still answers:

- which browser tab is the active controller for this primary server,
- which websocket client is allowed to issue normal UI commands.

The browser does not connect to remote nodes, so remote nodes must not participate in browser activation decisions.

### 2. Workspace fencing

Keep `FencingManager` only on the primary server.

This still answers:

- which tab is the controller for one specific workspace,
- which tabs are observers.

All workspace writes already pass through the primary server, so remote nodes do not need tab-level controller knowledge.

### 3. Remote host-control lease

Add a new concurrency layer on each remote node:

- one remote node can be managed by at most one primary server at a time
- the primary server claims and renews a host-control lease
- another primary server attempting to connect receives a structured `managed_by_another_host` response
- if the current primary server stops heartbeating, the lease expires and another primary server may claim control

This avoids the invalid model where a remote node tries to treat a primary server websocket as if it were a browser tab.

### Remote local UI behavior

In phase 1, once a remote node is managed by a primary server, its own browser UI should not concurrently manage the same workspace set.

Recommended behavior:

- allow diagnostics and maintenance access on the remote node itself
- do not support concurrent day-to-day workspace control through both the remote UI and the primary UI

This keeps the first release bounded and avoids conflicting controller semantics.

## Workspace UI State Ownership

UI state must remain primary-server-owned.

Primary-server-owned:

- pane layout
- open editors
- active editor
- active session selection
- file tree expansion
- focus mode
- dev browser tab state
- agent instructions expansion
- recent workspace history

Remote-node-owned:

- workspace existence on disk
- workspace path
- session objects
- terminal objects
- git state
- task state
- LSP state

Consequences:

- `workspace.uiState.set` remains a primary-server operation
- remote workspace snapshots must not overwrite host `uiState`
- primary server restart can restore UI state independently of whether the remote node restarted

The merge rule is:

- remote snapshot refreshes execution metadata
- primary repository preserves `uiState`

## User Experience

### Server management

Add a new `More > Settings > Servers` section for:

- add remote server
- edit remote server name, URL, and token
- enable or disable a server
- remove a server
- test connection
- view read-only status summary

Phase 1 should not expose remote provider installs, updates, or broad settings editing here.

### Workspace launch

Update the existing workspace launch modal so the user selects a target server before browsing directories.

Behavior:

- default target is `Local`
- selecting a remote server switches the directory browser to that node
- `workspace.mkdir` applies to the selected server
- `workspace.open` binds the new workspace to the selected server

### Workspace list

Keep one unified workspace list in the primary UI.

Each workspace should display its source server:

- `Local`
- remote server name such as `prod-dev-1`

Phase 1 should prefer a simple badge or label over deep regrouping or a separate server navigation mode.

### Existing remote workspaces

The primary server should aggregate already-open remote workspaces and show them alongside local ones, using the same server labeling model.

## Failure Handling And Recovery

### Primary server restart

On restart, the primary server should:

- reload remote server registry
- reconnect to each enabled remote node
- reclaim host-control leases
- request remote workspace snapshots
- reconstruct wrapped IDs
- merge remote execution state with locally persisted `uiState`

### Remote node restart

If a remote node restarts:

- mark the node degraded
- attempt reconnect
- reclaim host-control lease
- request fresh snapshot

If the remote node preserved sessions and terminals, they should be rehydrated into the aggregated state. If it did not, the primary server should accept the remote node's current truth and mark missing sessions or terminals ended or unavailable.

### Remote node offline

If a remote node is offline:

- its workspaces should remain visible in the primary UI
- those workspaces should show an `unreachable` or equivalent degraded state
- the primary server should not silently delete them
- unaffected local and other-remote workspaces should continue to operate normally

### Takeover failure

If `control.claim` fails because another primary server currently manages the remote node:

- mark the server as unavailable for control
- expose a clear status in the server settings UI
- do not attempt workspace command routing to that node until a valid lease exists

## Phase 1 Scope

Phase 1 should include:

- remote server registry and health checks
- remote runtime handle registration
- host-control lease and heartbeat
- aggregated workspace list across local and remote nodes
- server selection in workspace launch
- remote execution for:
  - `workspace.browse`
  - `workspace.mkdir`
  - `workspace.open`
  - `file/*`
  - `session/*`
  - `terminal/*`
  - `git/*`
  - `task/*`
  - `lsp/*`
  - `worktree/*`
- wrapped ID handling
- primary-owned `uiState`
- degraded and offline UI states

## Deferred Work

Defer to later phases:

- centralized editing of remote provider settings
- remote provider installation from the primary server
- remote diagnostics and update management beyond read-only status
- workspace migration between nodes
- browser-direct remote connections
- multi-primary collaborative ownership of one remote node

## File Impact

Likely primary implementation touchpoints:

- `packages/core/src/domain/types.ts`
- `packages/server/src/runtime/contract.ts`
- `packages/server/src/host/runtime-router.ts`
- `packages/server/src/host/workspace-runtime-binding.ts`
- `packages/server/src/storage/repositories/workspace-repo.ts`
- `packages/server/src/workspace/history-store.ts`
- `packages/server/src/commands/workspace.ts`
- `packages/server/src/ws/dispatch.ts`
- `packages/server/src/ws/activation.ts`
- `packages/server/src/ws/fencing.ts`
- new remote runtime and remote registry modules under `packages/server/src/`
- workspace launch UI in `packages/web/src/features/workspace/views/shared/workspace-launch-modal.tsx`
- workspace launch actions in `packages/web/src/features/workspace/actions/use-workspace-launch-actions.ts`
- settings route metadata and settings UI under `packages/web/src/features/settings/` and `packages/web/src/features/more/`

Likely remote-node implementation touchpoints:

- server bootstrap and auth wiring for internal HTTPS and WSS endpoints
- runtime execution adapter for internal commands
- host-control lease state machine
- remote snapshot publisher

## Risks

- Incomplete ID wrapping will cause session, terminal, and event mismatches.
- Reusing browser activation on internal runtime channels will incorrectly reject valid primary-to-remote traffic.
- Letting remote snapshots overwrite primary `uiState` will break layout persistence and editor continuity.
- Partial event or topic rewriting will cause incorrect cross-workspace updates in the browser.
- Terminal recovery across reconnect boundaries is more fragile than normal command routing and will need dedicated coverage.

## Testing

Add coverage at four layers.

Unit tests:

- remote server registry persistence and validation
- host lease state machine
- wrapped ID encode and decode behavior
- snapshot merge preserving primary `uiState`
- new runtime target resolution

Primary-server integration tests:

- route a remote `workspace.open`
- route remote `file.read` and `file.write`
- route remote `session.create`
- route remote `terminal.input` and output replay
- confirm activation rejection still happens on the primary server before remote routing

Two-node end-to-end tests:

- primary registers a remote node
- user opens a remote workspace
- user starts a session
- user interacts with terminal and git views
- remote node restarts and reconnects
- primary server preserves UI state and reflects remote execution truth

Regression tests:

- local-only mode behavior remains unchanged
- existing single-node activation and fencing behavior remains unchanged
- current workspace launch flow still works for `Local`

## Acceptance Criteria

- One primary frontend can show local and remote workspaces together.
- Users can choose a target server when opening a workspace.
- A remote workspace can browse files, create sessions, use terminals, and run existing workspace-backed commands through the primary server.
- Remote server disconnects degrade only the affected workspaces and do not break local or other-remote workspaces.
- Primary-owned `uiState` survives reconnect and restart flows.
- Existing single-node workflows still behave the same when no remote servers are configured.

# Runtime Extraction And WSL Architecture Spec

**Goal:** Restructure the current server so Coder Studio can support per-workspace runtimes, with native Windows workspaces and WSL workspaces coexisting in the same app instance. Phase 1 extracts `runtime` from the current monolithic `server`. Phase 2 adds a WSL-backed runtime implementation on top of the extracted boundary.

**Status:** Approved architecture spec for development handoff.

**Primary outcome of this spec:** Change the backend shape from:

```text
UI -> server(transport + host logic + runtime logic)
```

to:

```text
UI -> Host Server
     -> Host Services
     -> Runtime Router
        -> Native Runtime
        -> WSL Runtime
```

## Why This Exists

The current backend in [packages/server/src/server.ts](/root/workspace/coder-studio/packages/server/src/server.ts:129) assembles HTTP/WebSocket transport, workspace metadata, runtime execution, skills, provider installs, LSP, session orchestration, and monitoring into a single process-wide object graph.

That shape is workable for local-only workspaces, but it blocks a correct WSL mode because:

- a WSL workspace must execute `terminal`, `git`, `session`, `provider`, `skills`, `lsp`, and agent-facing files inside WSL, not on Windows
- mixed mode is required: Windows and WSL workspaces must be open at the same time
- `skills` cannot remain Windows-owned for WSL workspaces because provider skill mount directories are runtime-local, for example:
  - Codex: [packages/providers/src/codex/definition.ts](/root/workspace/coder-studio/packages/providers/src/codex/definition.ts:85)
  - Claude: [packages/providers/src/claude/definition.ts](/root/workspace/coder-studio/packages/providers/src/claude/definition.ts:85)
  - Gemini: [packages/providers/src/gemini/definition.ts](/root/workspace/coder-studio/packages/providers/src/gemini/definition.ts:73)
- the current global [CommandContext](/root/workspace/coder-studio/packages/server/src/ws/dispatch.ts:50) couples host and runtime concerns into one dependency bag

## Product And Architecture Decisions

These decisions are fixed for implementation unless a later spec explicitly revises them.

1. WSL is a per-workspace runtime, not a global app mode.
2. Mixed mode is required. One app instance may host native and WSL workspaces simultaneously.
3. Phase 1 does not implement WSL execution. It only extracts the runtime boundary cleanly enough that WSL becomes an additional runtime implementation, not a rewrite.
4. `skills` belong to the runtime, not to the host, because the agent and provider skill directories live in the runtime environment.
5. `memory` remains host-owned in Phase 1.
6. Agent CLI callbacks keep using the host control plane. The CLI entry stays stable; only backend routing changes.
7. Host is the control plane. Runtime is the execution plane.
8. Host remains the only browser-facing HTTP/WebSocket server.

## Non-Goals

This spec does not include:

- implementing the WSL transport itself
- rewriting all command handlers at once
- changing frontend interaction flows
- moving `memory` into runtime in Phase 1
- changing the public CLI command surface
- introducing browser-to-WSL direct connections

## Current Relevant Code

### Main coupling points

- Monolithic assembly: [packages/server/src/server.ts](/root/workspace/coder-studio/packages/server/src/server.ts:129)
- Global dispatch and dependency bag: [packages/server/src/ws/dispatch.ts](/root/workspace/coder-studio/packages/server/src/ws/dispatch.ts:1)
- Browser WebSocket hub: [packages/server/src/ws/hub.ts](/root/workspace/coder-studio/packages/server/src/ws/hub.ts:1)
- All command registration imported globally: [packages/server/src/commands/index.ts](/root/workspace/coder-studio/packages/server/src/commands/index.ts:1)

### Workspace metadata already prepared for WSL

- `Workspace.targetRuntime` and `Workspace.wslDistro`: [packages/core/src/domain/types.ts](/root/workspace/coder-studio/packages/core/src/domain/types.ts:12)
- `WorkspaceManager.open()` currently still hardcodes `"native"`: [packages/server/src/workspace/manager.ts](/root/workspace/coder-studio/packages/server/src/workspace/manager.ts:143)

### Existing agent callback path

- Session injects `CODER_STUDIO_SESSION_TOKEN` and `CODER_STUDIO_API_URL`: [packages/server/src/session/manager.ts](/root/workspace/coder-studio/packages/server/src/session/manager.ts:290)
- CLI callback client uses those env vars over WebSocket: [packages/cli/src/automation-command-client.ts](/root/workspace/coder-studio/packages/cli/src/automation-command-client.ts:73)
- Host auth supports bearer session tokens on `/ws`: [packages/server/src/auth/plugin.ts](/root/workspace/coder-studio/packages/server/src/auth/plugin.ts:119)

## Target Architecture

### Layered shape

```text
Browser UI
  -> Host Server
     - Fastify routes
     - WebSocket hub
     - Auth/session-token checks
     - Workspace metadata and UI state
     - Host-only commands
     - Runtime router

  -> Runtime Handle per workspace
     - Native Runtime (Phase 1 implementation)
     - WSL Runtime (Phase 2 implementation)
```

### Host responsibilities

Host owns:

- HTTP routes and WebSocket endpoint
- auth and session token validation
- browser event fan-out
- workspace metadata persistence
- workspace open/close orchestration
- runtime selection and runtime handle binding
- host-only settings/state
- automation audit and activation/fencing policy
- command routing

### Runtime responsibilities

Runtime owns:

- provider CLI execution
- sessions and terminals
- git and worktrees
- LSP
- diagnostics that depend on runtime environment
- system dependency installs
- provider installs
- skills library/install/mount/health
- agent instructions generation and publication
- workspace intelligence
- session analysis and work analysis
- supervisor execution

## Scope Split

All commands must be explicitly classified as:

- `host`
- `runtime`
- `host-orchestrated`

### Host commands in Phase 1

Keep these on host:

- `automation.*`
- `connection.probe`
- `activation.*`
- `workspace.list`
- `workspace.browse`
- `workspace.mkdir`
- `workspace.close`
- `workspace.uiState.set`
- `workspace.activate`
- `workspace.deactivate`
- `workspace.lastViewedTarget.*`
- `workspace.history.*`
- `settings.*`
- `updates.*`
- `monitoring.*`
- `memory.*`
- `customProvider.*`
- `uiAction.*`

Reason:

- they are control-plane concerns
- or they operate on host-owned persistent app state
- or they drive browser behavior directly

### Runtime commands in Phase 1

Move these behind the runtime boundary:

- `file.*`
- `git.*`
- `worktree.*`
- `terminal.*`
- `task.*`
- `session.*`
- `lsp.*`
- `provider.runtimeStatus`
- `provider.install.*`
- `systemDeps.*`
- `diagnostics.*`
- `workspace.intelligence`
- `agent-context.*`
- `agent-instructions.*`
- `session.analysis.*`
- `session.review.*`
- `work.analysis.*`
- `supervisor.*`
- `fencing.*`
- `skills.*`

Reason:

- these commands read or mutate runtime-local filesystem state
- or they execute local commands/processes
- or they depend on runtime-local home directories and tool installs

### Host-orchestrated commands

These remain host entrypoints but coordinate runtime work:

- `workspace.open`
- `session.close`

Future commands of the same shape should follow this pattern rather than forcing everything into pure host or pure runtime.

## Context Split

The current [CommandContext](/root/workspace/coder-studio/packages/server/src/ws/dispatch.ts:50) must be replaced with two separate contexts.

### HostCommandContext

`HostCommandContext` should include:

- `workspaceMgr`
- `settingsRepo`
- `memoryRepo`
- `activationMgr`
- `automationAuditLog`
- `broadcaster`
- `runtimeRouter`
- `config`
- `updateService`
- `monitoringService`
- `customProviderRepo`

### RuntimeCommandContext

`RuntimeCommandContext` should include:

- `workspaceLookup`
- `eventBus`
- `providerConfigRepo`
- `providerRegistry`
- `sessionMgr`
- `terminalMgr`
- `taskMgr`
- `lspMgr`
- `lspToolMgr`
- `lspToolInstallMgr`
- `fencingMgr`
- `supervisorMgr`
- `providerRuntimeDeps`
- `providerInstallMgr`
- `systemDependencyInstallMgr`
- `skillsHubClient`
- `skillInstallMgr`
- `skillMountMgr`
- `skillHealthMgr`
- `skillLibraryRepo`
- `skillTargetRepo`
- `skillMountRepo`
- `builtinSkillSyncMgr`
- `sessionMetadataRepo`
- `sessionAnalysisService`
- `workAnalysisService`
- `agentInstructionPublisher`

## Runtime Contract

Phase 1 should introduce a runtime contract before adding any remote transport.

```ts
export interface RuntimeExecuteMeta {
  clientId?: string;
  authContext?: unknown;
}

export interface RuntimeHandle {
  kind: "native" | "wsl";
  execute(op: string, args: unknown, meta?: RuntimeExecuteMeta): Promise<unknown>;
  disposeWorkspace(workspaceId: string): Promise<void>;
  setProviderRegistry?(providers: ProviderDefinition[]): void;
  getSummary?(): RuntimeSummary;
  health(): Promise<{ ok: true }>;
}
```

Phase 1 only implements `NativeRuntimeHandle` in-process. Phase 2 adds `WslRuntimeHandle`.

## Host/Runtime Bridge Requirements

Even for in-process runtime, the code should depend on a host bridge abstraction rather than host internals.

### Required host bridge capabilities

- issue session automation tokens
- revoke session automation tokens by session id
- provide host callback API URL
- emit domain events back to host
- broadcast stream/topic events back to host

Suggested interface:

```ts
interface RuntimeHostBridge {
  issueSessionToken(input: IssueSessionAutomationTokenInput): SessionAutomationTokenRecord;
  revokeSessionTokensBySessionId(sessionId: string): void;
  getHostApiUrl(): string | undefined;
  emitDomainEvent(event: DomainEvent): void;
  broadcast(topic: string, payload: unknown): void;
}
```

This is required because:

- [SessionManager](/root/workspace/coder-studio/packages/server/src/session/manager.ts:296) currently touches `SessionTokenRepo` directly
- runtime services currently assume direct access to host `eventBus` and `broadcaster`

Those assumptions must be removed in Phase 1.

## Runtime State Ownership

The following runtime state must move under runtime-owned state roots:

- `TerminalRepo`
- `SessionRepo`
- `SkillLibraryRepo`
- `SkillTargetRepo`
- `SkillMountRepo`
- `SessionMetadataRepo`
- `SessionAnalysisRepo`
- `WorkAnalysisRepo`
- `SupervisorRepo`

Current creation sites are in [packages/server/src/server.ts](/root/workspace/coder-studio/packages/server/src/server.ts:154) through [packages/server/src/server.ts](/root/workspace/coder-studio/packages/server/src/server.ts:458).

### Host-owned state that remains on host in Phase 1

- `WorkspaceRepo`
- `SettingsRepo`
- `MemoryRepo`
- `AuthSessionRepo`
- `AuthLoginBlockRepo`
- `AppearanceAssetRepo`
- `AutomationAuditLog`
- `CustomProviderRepo`

### Runtime state root layout

Phase 1 should stop treating all runtime state as process-global.

Recommended structure:

```text
state/
  host/
    workspaces.json
    settings.json
    memory/
    auth-sessions.json
    auth-login-blocks.json
    appearance-assets.json
    automation-audit.jsonl
    update-state.json

  runtimes/
    native-default/
      sessions.json
      terminals.json
      skills/
      lsp/
      session-analysis.json
      work-analysis.sqlite
      supervisor/
```

This avoids a second storage migration when WSL runtimes are introduced.

## Command Registration Model

The current global registration pattern in [packages/server/src/commands/index.ts](/root/workspace/coder-studio/packages/server/src/commands/index.ts:1) should be replaced by separate registries.

### Required registries

- `registerHostCommand(op, schema, handler)`
- `registerRuntimeCommand(op, schema, handler)`

The dispatch layer should:

1. validate auth and permissions on host
2. validate input on host
3. route by command scope
4. execute locally for host commands
5. forward to runtime for runtime commands

## Workspace Lifecycle Changes

### `workspace.open`

The current [workspace.open](/root/workspace/coder-studio/packages/server/src/commands/workspace.ts:123) calls `workspaceMgr.open({ path })` directly. This must become host orchestration.

Target flow:

1. resolve target runtime for the requested path
2. ensure a runtime handle exists
3. persist workspace metadata with explicit `targetRuntime`
4. bind `workspaceId -> runtimeHandle`
5. perform optional runtime warmup

### `WorkspaceManager.open()`

[WorkspaceManager.open()](/root/workspace/coder-studio/packages/server/src/workspace/manager.ts:119) must stop hardcoding:

```ts
targetRuntime: "native"
```

It should accept explicit runtime metadata from the caller.

### `workspace.close`

[WorkspaceManager.close()](/root/workspace/coder-studio/packages/server/src/workspace/manager.ts:183) currently depends on teardown logic that knows about runtime internals.

Target flow:

1. stop host watcher
2. call `runtimeHandle.disposeWorkspace(workspaceId)`
3. clean host-owned workspace state such as memory and uploads
4. remove workspace metadata
5. unbind workspace/runtime relation

## Agent CLI And Host Callback Model

The current agent callback model is preserved:

- runtime launches agent process
- runtime injects `CODER_STUDIO_SESSION_TOKEN`
- runtime injects `CODER_STUDIO_API_URL`
- agent CLI calls host control plane over WebSocket

This remains the correct model after extraction. The CLI entry does not change.

### Important implication for WSL

Phase 2 must change host callback assumptions:

- callback URL must be reachable from WSL, not just `127.0.0.1`
- session token auth cannot remain strictly loopback-only for remote runtimes

Current loopback restriction lives in [packages/server/src/auth/plugin.ts](/root/workspace/coder-studio/packages/server/src/auth/plugin.ts:110).

## Why `skills` Must Be Runtime-Owned

`skills` must not remain host-owned for WSL workspaces because:

- provider skill mount targets are runtime-local home directories
- skill install/mount/health operations are meaningful only relative to the actual runtime where the agent executes
- duplicating skill state on host and syncing it into WSL would create two sources of truth

Therefore:

- `skills.search/info/install/library/files/mount/health/recommend/custom/builtin` all belong to runtime
- host may aggregate and relay runtime state
- host must not remain the source of truth for skill installation or mount state

## Runtime-Specific Gaps Already Visible In Current Code

These do not all need full implementation in Phase 1, but the architecture must stop deepening the current coupling.

### File watchers

[WorkspaceManager](/root/workspace/coder-studio/packages/server/src/workspace/manager.ts:70) currently owns host-side filesystem watchers. For WSL workspaces, watchers must come from runtime, not host.

### File asset routes

- `/api/file` currently assumes host-local workspace access: [packages/server/src/app.ts](/root/workspace/coder-studio/packages/server/src/app.ts:144)
- `/api/skill-file` currently assumes host-local skill library access: [packages/server/src/app.ts](/root/workspace/coder-studio/packages/server/src/app.ts:148)

Phase 2 will need runtime-backed proxying for these routes.

### Auto-fetch

`AutoFetchScheduler` currently dispatches `git.fetch` against the process-global dispatcher: [packages/server/src/server.ts](/root/workspace/coder-studio/packages/server/src/server.ts:179)

After extraction it must use the runtime router rather than assuming a single local execution environment.

## File And Module Structure

Phase 1 should add these files:

- `packages/server/src/host/context.ts`
- `packages/server/src/host/command-registry.ts`
- `packages/server/src/host/runtime-router.ts`
- `packages/server/src/host/runtime-registry.ts`
- `packages/server/src/host/workspace-runtime-binding.ts`
- `packages/server/src/runtime/contract.ts`
- `packages/server/src/runtime/context.ts`
- `packages/server/src/runtime/command-registry.ts`
- `packages/server/src/runtime/assembly.ts`
- `packages/server/src/runtime/native-runtime.ts`
- `packages/server/src/runtime/runtime-state.ts`
- `packages/server/src/runtime/events.ts`
- `packages/server/src/runtime/remote/transport.ts`

The existing business directories stay in place initially:

- `session/`
- `skills/`
- `terminal/`
- `lsp/`
- `provider-runtime/`
- `system-deps/`
- `agent-instructions/`
- `supervisor/`
- `work-analysis/`

The first refactor is registration and assembly, not a large physical move of implementation files.

## Phase Plan

## Phase 1: Runtime Extraction

### Deliverables

- host/runtime context split
- host/runtime command registry split
- in-process native runtime handle
- runtime router
- workspace/runtime binding
- runtime-owned session/terminal/lsp/skills/provider/system-deps execution
- host-owned settings/memory/update/monitoring/auth/workspace metadata

### Required implementation steps

1. Add runtime contract and host/runtime contexts
2. Add host and runtime command registries
3. Introduce `NativeRuntimeHandle`
4. Move runtime assembly out of `server.ts`
5. Change dispatch to route by scope
6. Change workspace open/close to bind and dispose runtime handles
7. Migrate runtime command groups in batches

### Migration order for commands

#### Batch 1

- `file.*`
- `git.*`
- `terminal.*`
- `session.*`
- `task.*`
- `lsp.*`

#### Batch 2

- `provider.runtimeStatus`
- `provider.install.*`
- `systemDeps.*`
- `diagnostics.*`
- `worktree.*`
- `workspace.intelligence`
- `agent-context.*`

#### Batch 3

- `skills.*`
- `agent-instructions.*`
- `supervisor.*`
- `session.analysis.*`
- `session.review.*`
- `work.analysis.*`
- `fencing.*`

## Phase 2: WSL Runtime

### Deliverables

- WSL runtime installer/bootstrap
- runtime process launch via Windows host
- host <-> WSL runtime RPC transport
- runtime-local state inside WSL
- WSL-capable host callback URL and remote-runtime auth mode

### Transport choice

Recommended first implementation:

- host starts WSL child process
- host and WSL runtime communicate over stdio JSON-RPC

Reason:

- the host can create the runtime before any remote HTTP server exists
- transport stays thin
- it maps well onto existing process-launch patterns

## Risks

### Risk 1: Context split leaks old assumptions

If handlers continue expecting the old global `CommandContext`, the extraction becomes mechanical but not real. Avoid adapter layers that simply pass the old context through unchanged.

### Risk 2: Global state remains in `server.ts`

If `server.ts` continues owning runtime repos/managers directly, the project will gain new abstractions without changing actual dependency flow.

### Risk 3: Skills become dual-sourced

If host keeps owning skill state while runtime also grows skill state, mixed mode becomes inconsistent. Runtime must be the source of truth for skills.

### Risk 4: Workspace routing ambiguity

Runtime commands without a clear `workspaceId` cannot be routed in mixed mode. Any command that is runtime-owned must carry enough information for workspace routing.

### Risk 5: Route-level host filesystem assumptions remain hidden

HTTP asset and watcher features can silently break on WSL if they are not called out explicitly in follow-up work.

## Verification Criteria For Phase 1

Phase 1 is complete when all of the following are true:

1. `server.ts` no longer directly assembles runtime business managers such as session, terminal, skills, LSP, supervisor, and provider/system dependency installers.
2. `dispatch.ts` no longer executes all commands against a single `CommandContext`.
3. Runtime-owned commands execute through a `RuntimeHandle`, even when that runtime is still in-process.
4. `workspace.open` persists explicit runtime metadata and binds the workspace to a runtime handle.
5. `skills.*` no longer depend on host-owned source-of-truth state.
6. Existing native workspace behavior remains functionally unchanged.

## Implementation Notes For Developers

- Prefer moving assembly and registration before moving implementation files.
- Do not start with WSL transport.
- Keep the CLI surface unchanged.
- Keep auth, browser WebSocket fan-out, and workspace metadata firmly host-owned.
- Avoid backsliding into host-side direct access to runtime managers after the first extraction lands.


# WSL Remote Runtime Architecture Design

> **Status:** Draft for user review  
> **Date:** 2026-06-30  
> **Scope:** `packages/server`, future `packages/desktop`, `packages/cli`, `packages/core`, tests, packaging/install flow

## Goal

Adopt a VS Code Remote WSL style architecture for Coder Studio:

- keep one Windows-hosted desktop UI and control plane
- run WSL workspace execution inside a WSL-side runtime scoped per distro
- let Windows and WSL workspaces coexist in one app instance
- make runtime-owned state, tools, skills, and providers live with the runtime that actually executes them

This design replaces the ambiguous model of "Windows runtime somehow also covers WSL" with a clearer split between local UI/control and remote execution.

## Decisions

- WSL support is a remote-runtime model, not a host-runtime variant.
- There is only one desktop UI, and it stays on Windows.
- Each WSL distro gets at most one managed Coder Studio remote runtime instance at a time.
- Multiple workspaces in the same distro share that distro runtime instance.
- Host and WSL runtime versions must match exactly before startup completes.
- Host owns WSL runtime install, upgrade, startup, stop, and health checks.
- Host and WSL runtime continue communicating over RPC.
- The user-facing `coder-studio` command should work from both Windows and WSL.
- The WSL-side `coder-studio` command is a thin launcher or shim, not the owner of runtime installation or upgrade logic.
- Runtime-owned config does not live-sync with host config.

## Non-goals

- Do not start a second Linux UI window inside WSL.
- Do not make all distros share one global WSL runtime process.
- Do not treat WSL workspaces as Windows workspaces with path translation layered on top.
- Do not allow host and WSL runtime versions to drift in a degraded mode.
- Do not preinstall full remote runtime payloads into every distro during desktop app installation.
- Do not make the WSL CLI shim responsible for downloading, upgrading, or selecting runtime bundles.

## Problem

The current runtime extraction work fixed important routing issues, but the product model is still easy to misunderstand if WSL remains "host-owned runtime plus some bridge behavior."

That model creates long-term pressure in the wrong places:

- agent and skill state becomes unclear: host-owned or WSL-owned
- provider installs and system dependencies become hard to reason about
- config synchronization becomes ambiguous and error-prone
- multiple WSL workspaces can look independent even though they should share one execution environment per distro
- users have no clean mental model for what exactly runs on Windows versus inside WSL

The architecture should instead mirror the actual execution boundary:

- Windows owns UI and control
- WSL owns WSL execution

## Why The VS Code Mental Model Fits Better

VS Code Remote WSL keeps the editor UI on Windows while installing and managing a WSL-side server inside the target distro. That model is easier to explain because it matches where code actually runs.

Coder Studio should adopt the same high-level split:

- Windows desktop app: UI, auth, update channel, routing, workspace registry, activation, window lifecycle
- WSL remote runtime: sessions, terminals, git, tasks, skills, providers, toolchain, diagnostics, workspace file access

The key win is not "having two runtimes." The key win is that state ownership becomes explicit and consistent.

## Proposed Architecture

### Topology

```text
User
  -> coder-studio (Windows CLI or WSL shim)
    -> Windows Desktop Host
       - window + UI shell
       - browser/control plane
       - workspace registry and routing
       - WSL runtime install/update/start/stop manager
       - native runtime
       - one WSL remote runtime handle per distro
           -> RPC bridge
              -> WSL distro runtime process
```

### Runtime kinds

Coder Studio should converge on three execution kinds:

- `native`
  - local host runtime for Windows-native workspaces
- `wsl`
  - per-distro WSL remote runtime
- `remote`
  - future server-to-server remote runtime, if multi-node support continues

The WSL runtime should behave much more like a remote runtime than like a local metadata mode.

### Responsibility split

Windows host owns:

- desktop window lifecycle
- browser-facing HTTP and WebSocket server
- account and auth state
- app update flow
- workspace metadata and routing
- activation and browser fencing
- runtime registration and runtime lookup
- WSL runtime installation state
- WSL runtime version enforcement
- WSL bridge startup, stop, restart, and health checks

WSL distro runtime owns:

- workspace filesystem access inside that distro
- sessions and terminals
- git and worktree operations
- tasks and LSP
- provider installs and provider runtime execution
- built-in and custom skill mounts
- runtime diagnostics and system dependency checks
- Node path and toolchain selection for that distro
- runtime-scoped agent and provider config

Workspace scope owns:

- project-local files
- repo-local configuration
- workspace UI state references
- workspace-specific runtime bindings

## Configuration Scope Model

The architecture should explicitly separate three configuration scopes.

### Host scope

Host scope is shared across native and WSL workspaces because it belongs to the desktop application, not to the execution environment.

Examples:

- signed-in account
- activation state
- update preferences
- window state and layout
- theme and UI preferences
- recent workspace history
- registered remote targets

### Distro runtime scope

Distro runtime scope belongs to one WSL distro and must not auto-sync with Windows runtime state.

Examples:

- provider installs
- provider credentials or config that are runtime-local
- built-in and custom skill mounts
- agent runtime config
- system dependencies
- Node path for the distro
- shell and toolchain preferences
- WSL runtime diagnostics

This scope should be shared by all workspaces inside the same distro.

### Workspace scope

Workspace scope remains project-local.

Examples:

- project files
- repo settings
- workspace-specific session state
- workspace UI state
- workspace-local instructions or config files

### Synchronization rule

The default rule is:

- host scope is not mirrored into distro runtime scope
- distro runtime scope is not mirrored into host scope
- workspace scope is not mirrored across runtimes

If later product work wants "import from host defaults" or "copy settings to distro," that should be an explicit one-time action rather than silent live synchronization.

## CLI Model

The user-facing command remains:

```text
coder-studio
```

But the command has two different roles depending on where it is invoked.

### Windows CLI

When invoked on Windows, the CLI:

- detects native Windows context
- resolves the requested path
- asks the desktop host to open the workspace as `native`
- starts or focuses the desktop app if needed

The Windows CLI is an entrypoint, not a separate runtime manager.

### WSL CLI

When invoked inside WSL, the CLI should be a thin shim or launcher.

It should:

- detect that it is running inside WSL
- read the current distro name
- resolve the Linux workspace path
- send an open request to the Windows desktop host with:
  - `targetRuntime = "wsl"`
  - `wslDistro = <current distro>`
  - `path = <linux path>`

It should not:

- download runtime bundles
- decide runtime versions
- perform upgrades
- start long-lived remote runtime processes directly

That logic belongs to the Windows host runtime manager.

## Installation Model

### Desktop installation

Desktop installation on Windows should:

- install the desktop application
- register the Windows-side `coder-studio` command
- make a WSL-callable entry available, either through:
  - a dedicated WSL shim written on first use, or
  - a Windows executable path that WSL can invoke

The preferred long-term model is a dedicated WSL shim because it gives Coder Studio a stable contract independent of shell quirks or direct `.exe` invocation behavior.

### WSL remote runtime installation

Remote runtime payloads should be installed lazily per distro, on first actual WSL workspace use.

That install should place a versioned runtime payload into a fixed distro-local path, for example:

```text
~/.local/share/coder-studio/remote/<version>/
```

The host may also create a stable shim path such as:

```text
~/.local/bin/coder-studio
~/.local/bin/coder-studio-remote
```

But those shims are convenience entrypoints. The host should still launch the remote runtime through a host-known absolute path.

## Versioning And Runtime Identity

### Version enforcement

Host and WSL runtime versions must be identical.

Startup rules:

- if the target distro has no installed runtime, install it before opening the workspace
- if the target distro has a different runtime version, stop the old bridge, upgrade the runtime, then start the new bridge
- if upgrade fails, workspace startup fails

There is no degraded "continue anyway" mode.

### Identity

Each distro runtime should have a stable runtime id derived from the distro, for example:

```text
wsl:Ubuntu-24.04
```

All workspaces in that distro bind to the same runtime id.

## Startup Flows

### Native Windows workspace open

1. User runs `coder-studio <path>` on Windows, or opens a folder from the desktop UI.
2. Host resolves the workspace as `native`.
3. Host ensures the native runtime is ready.
4. Host binds the workspace to `native-default`.
5. UI opens or focuses the workspace.

### WSL workspace open from WSL shell

1. User runs `coder-studio .` inside WSL.
2. WSL shim resolves:
   - current distro
   - current Linux path
3. WSL shim sends an open request to the Windows host.
4. Host checks the target distro runtime install state.
5. Host checks version equality with the current desktop/runtime version.
6. Host installs or upgrades the target distro runtime if required.
7. Host starts or reuses the distro bridge/runtime process.
8. Host establishes RPC connectivity and health checks.
9. Host binds the workspace to the distro runtime id.
10. UI opens or focuses the workspace in the Windows desktop app.

### WSL workspace open from Windows UI

1. User selects a WSL path or distro/path combination from the Windows desktop UI.
2. Host resolves the canonical Linux path and target distro.
3. Host follows the same install, version-check, startup, bind, and open flow as above.

## Runtime Lifecycle

### Creation

The Windows host creates a WSL runtime handle per distro on demand.

### Reuse

If a distro runtime is already healthy and version-matched, additional workspaces in that distro attach to the same runtime instance.

### Stop behavior

The host should stop distro runtimes when:

- the desktop host exits
- the host upgrades and needs a new matching runtime version
- the runtime becomes unhealthy and restart is required

### Restart behavior

If the runtime process dies unexpectedly:

- host marks the runtime degraded
- host reports affected WSL workspaces as unavailable
- host attempts restart with the same version
- if restart succeeds, workspaces reattach
- if restart fails, the user sees a clear runtime-level error

## Node And Toolchain Strategy

The WSL runtime should use one managed Node-capable execution environment per distro.

That means:

- all workspaces in one distro share the same runtime Node path
- host stores and validates the Node path as part of distro runtime state
- runtime-owned tools should use that managed path consistently

This does not require a self-contained Node bundled inside the runtime payload if product and packaging constraints make that undesirable. It does require the host to own the contract for ensuring that a compatible Node exists before the remote runtime starts.

## RPC And Routing Model

Host and WSL runtime continue using RPC.

The host runtime router should treat the WSL runtime the same way it treats any other explicit runtime handle:

- route workspace-scoped commands by workspace binding
- route session and terminal commands through workspace-attached runtime identity
- keep browser-facing transport and auth on the host

This preserves one frontend connection while keeping execution in the correct environment.

## Diagnostics And User Experience

The architecture should eventually expose distro-level diagnostics and controls from the host UI.

Minimum host-visible distro status should include:

- distro name
- installed runtime version
- expected host version
- runtime health
- last start time
- Node path
- install path
- last error

Host should also provide distro-level actions:

- install runtime
- repair runtime
- restart runtime
- stop runtime
- remove runtime

These are management actions on the remote execution plane, not generic host settings.

## Migration Direction From Current Branch

The current branch work on per-distro bridge ids and shared runtime routing is a good base, but it should be treated as an intermediate step.

The remaining architectural shift is to make the product model match the runtime model more explicitly:

- keep the shared per-distro runtime binding
- move more runtime-owned state and config expectations to the WSL side
- add a host-managed install and version lifecycle for distro runtimes
- add a dedicated WSL CLI shim contract
- expose distro runtime diagnostics as first-class host-managed state

## Phased Implementation Direction

### Phase 1

- finish stabilizing the current per-distro brokered runtime path
- enforce strict version equality at startup
- ensure all workspaces in one distro share one runtime id and runtime process

### Phase 2

- add host-managed distro runtime install records
- add a real WSL CLI shim contract
- add host-driven install, repair, restart, and removal flows

### Phase 3

- expose distro runtime management and diagnostics in UI
- separate host settings from distro runtime settings in user-facing surfaces
- align desktop and npm CLI entry behavior behind the same runtime manager

## Acceptance Criteria

- A user can run `coder-studio` from Windows and open a native workspace.
- A user can run `coder-studio .` from WSL and open a WSL workspace in the same Windows desktop UI.
- Two WSL workspaces in the same distro share one runtime process.
- A WSL workspace in distro `A` does not reuse the runtime for distro `B`.
- If host version and distro runtime version differ, startup stops and reconciliation happens before the workspace opens.
- Skills, provider installs, and runtime diagnostics for WSL workspaces are owned by the distro runtime, not by the host native runtime.
- Host exit stops all active distro runtime processes.

## Risks

- If host-versus-runtime configuration boundaries are left vague in the UI, users will still be confused even if the backend is correct.
- If the WSL shim becomes too smart, lifecycle logic will split between CLI and host and become hard to maintain.
- If runtime version checks happen after workspace bind instead of before startup, failure handling will remain messy.
- If install paths are not stable per distro, repair and diagnostics behavior will be unreliable.

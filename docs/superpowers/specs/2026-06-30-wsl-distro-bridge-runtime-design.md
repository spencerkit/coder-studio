# WSL Per-Distro Bridge Runtime Architecture

> Status: Draft
> Date: 2026-06-30
> Scope: `packages/server`, `packages/desktop`, `packages/cli`, `packages/runtime`, `scripts`

> **2026-07-01 scope update:** the npm CLI remains host-only. Only the desktop app owns WSL bridge/runtime lifecycle. References below to shared desktop/CLI WSL ownership should be read as superseded by that decision.

## Summary

Replace the current per-workspace WSL runtime launch model with a host-managed, per-distro bridge runtime model owned by the Windows desktop app.

The Windows host remains the control plane. Each WSL distro gets one managed bridge daemon, one managed runtime store, and one managed Node installation. All WSL workspaces in the same distro reuse that bridge. Runtime version must always match the active host runtime version exactly. Node is version-managed independently, but must satisfy the runtime manifest requirement before the bridge can start.

## Problem

The current WSL flow has three architectural gaps:

- WSL runtime launch is per workspace rather than per distro.
- WSL runtime activation does not use a managed WSL runtime store aligned with the host runtime store.
- Desktop-owned WSL lifecycle is still entangled with CLI-oriented packaging and launcher assumptions.

This creates avoidable process churn, blurred lifecycle ownership, and an update model that is weaker than the desktop managed runtime design.

## Goals

- Use one WSL bridge daemon per distro, not per workspace.
- Keep WSL bridge/runtime lifecycle under the desktop app only.
- Keep runtime version strictly equal between host and WSL bridge runtime.
- Let the Windows host manage WSL runtime install, activation, upgrade, start, stop, and health checks.
- Reuse one managed Node installation per distro across all workspaces in that distro.
- Stop all WSL bridge daemons when the host process exits.

## Non-Goals

- Do not create one Linux process shared across all WSL distros.
- Do not keep WSL bridge daemons alive after the host process exits.
- Do not support runtime version skew between host and WSL bridge.
- Do not require per-workspace runtime installation or per-workspace bridge daemons.
- Do not make WSL depend on user-managed system Node or on distro package-manager state.

## Constraints Confirmed For This Design

- The npm CLI remains single-environment and does not own WSL bridge lifecycle.
- Only distros that have actually been used need to be managed.
- Runtime version equality is strict. WSL bridge startup must verify that the active distro runtime version matches the host runtime version before serving requests.
- Managed Node is versioned independently from runtime version. Runtime manifest compatibility gates bridge startup.
- When host runtime updates, running distro bridges must be stopped immediately and brought forward to the new runtime version.
- When the host exits, all running distro bridges must be stopped.
- Host and WSL communication remains RPC-based.

## Alternatives Considered

### Option A: Host Broker + Per-Distro Bridge Daemon

The host manages one bridge daemon, one runtime store, and one managed Node installation per distro.

This is the selected design because it matches the required lifecycle and removes per-workspace process duplication without trying to over-unify across distros.

### Option B: Host Broker + Reuse Host Runtime Assets Directly From `/mnt/c`

The host keeps the only runtime copy and WSL launches directly against mounted Windows-side assets.

This was rejected because it over-couples runtime behavior to Windows-mounted paths, weakens distro isolation, and complicates upgrades and recovery.

### Option C: Keep Per-Workspace WSL Runtime, Add Version Checks

The host would preserve the current per-workspace process model but add stricter update logic.

This was rejected because it does not solve the main lifecycle and resource problems.

## Decision

Use a host broker plus one managed bridge daemon per distro.

The broker is the only install and lifecycle authority. The bridge is only a runtime execution surface for workspaces inside one distro.

## Architecture

### Host-Side Components

`packages/desktop`

- Launch the desktop host runtime.
- Detect WSL workspace target distro.
- Route all WSL runtime actions through the broker layer.

`packages/cli`

- Launch the host-native runtime only.
- Reuse shared server/runtime code where appropriate, but do not own WSL bridge lifecycle.

`packages/runtime` or shared runtime management module

- Owns runtime manifest parsing and compatibility checks.
- Owns WSL runtime install and activation primitives.
- Owns managed Node compatibility checks for WSL.

`packages/server`

- Hosts the broker control plane while the app is running.
- Maintains workspace-to-distro routing.
- Talks to per-distro WSL bridges over RPC.

### WSL-Side Components

Per distro:

- One managed runtime store
- One managed Node store
- One bridge daemon
- One runtime state area for bridge lock, pid, socket, and health files

Workspaces are logical tenants inside the bridge, not separate runtime processes.

## Runtime and Node Layout

Each distro keeps its own user-scoped managed assets.

Recommended paths:

- Runtime store root: `~/.coder-studio/runtime-store`
- Runtime versions: `~/.coder-studio/runtime-store/versions/<runtimeVersion>`
- Active runtime pointer: `~/.coder-studio/runtime-store/current.json`
- Managed Node root: `~/.coder-studio/node`
- Managed Node version: `~/.coder-studio/node/<nodeVersion>/bin/node`
- Bridge run state: `~/.coder-studio/run`

The active runtime pointer inside the distro must resolve to the same runtime version as the active host runtime pointer. If versions differ, the bridge must not start or serve requests until the broker repairs the distro installation.

## Runtime Release Model

Runtime releases remain versioned at the host level and must have a WSL-capable Linux variant consumable inside a distro.

The host runtime version is authoritative. WSL runtime activation is not allowed to pick a different runtime version even if another compatible version is already installed in the distro.

The release model for WSL therefore becomes:

- host chooses active runtime version
- broker ensures matching Linux runtime assets exist in each used distro
- bridge starts only against that exact active version

## Managed Node Model

Managed Node is independent from runtime version.

The runtime manifest must declare the Node compatibility requirement, such as supported major or semver range. Before launching or reusing a bridge, the broker verifies that the distro has a managed Node version satisfying that requirement.

If no compatible managed Node exists, the broker installs one into the distro-local Node store and uses only that managed Node for bridge launch.

The bridge must not rely on:

- `node` from `PATH`
- distro package-manager Node
- `nvm`, `fnm`, `asdf`, or user shell init state

## Broker Responsibilities

The broker owns:

- discovering used distros from workspace targets
- reading the active host runtime version
- ensuring the distro runtime store has the matching active version
- ensuring managed Node compatibility
- starting, stopping, and health-checking the distro bridge
- routing workspace requests to the right distro bridge
- draining and restarting bridges during runtime upgrades

No layer outside the desktop broker should implement WSL-specific lifecycle logic.

## Bridge Responsibilities

The bridge owns:

- hosting RPC services for one distro
- maintaining runtime execution context for multiple workspaces in that distro
- serving workspace-scoped commands through one distro-scoped process
- reporting health, runtime version, Node version, and active workspace state

The bridge does not own:

- runtime upgrades
- runtime version selection
- Node installation policy
- cross-distro coordination

## RPC Model

Host-to-WSL communication remains RPC-based, but the target changes from per-workspace runtime processes to per-distro bridge daemons.

Minimum RPC surface:

- `health`
- `runtime.info`
- `workspace.attach`
- `workspace.dispose`
- `execute`
- `drain`
- `stop`

`runtime.info` should return at least:

- runtime version
- Node version
- distro identity
- bridge pid
- uptime
- active workspace ids

## Startup Flow

When the host needs to serve a WSL workspace:

1. Resolve the target distro from workspace metadata.
2. Read the active host runtime version.
3. Check the distro runtime pointer and verify exact version equality.
4. Check for a compatible managed Node version.
5. Check whether the distro bridge is already running.
6. If bridge is running, verify `health` and `runtime.info`.
7. If bridge runtime version differs from host runtime version, stop it and repair the distro installation.
8. If runtime or Node is missing or incompatible, install or activate the required asset.
9. Start the bridge if no healthy compatible bridge exists.
10. Route the workspace through `workspace.attach` and subsequent `execute` requests.

The workspace request path must never directly install or upgrade runtime assets on its own. It always goes through broker orchestration first.

## Update Flow

When host runtime changes version:

1. Activate the new host runtime version.
2. Enumerate all currently running distro bridges.
3. For each running distro:
   - send `stop` or perform forced shutdown if needed
   - ensure the exact matching WSL runtime version is installed and activated
   - ensure managed Node still satisfies the new runtime manifest
   - restart the bridge immediately or on next request according to host policy

This design uses immediate stop-and-upgrade semantics for running bridges. Old-version bridges are not allowed to continue serving after host runtime activation switches.

## Host Exit Flow

When the desktop host exits:

1. Enumerate all bridges started or tracked by the broker.
2. Send `stop`.
3. Force-kill lingering bridge processes after timeout.
4. Remove stale run-state if needed on next startup.

No WSL bridge is intended to survive host shutdown.

## Failure Recovery

### Startup Failure

If runtime install, runtime activation, Node install, or bridge startup fails, the host rejects the WSL workspace open/request with a precise error. No fallback to mismatched runtime version is allowed.

### Bridge Drift

If a bridge is alive but `runtime.info` reports the wrong runtime version, the broker must stop and recreate it before serving any request.

### Bridge Crash

If a bridge dies during operation, the broker may attempt one automatic restart after re-running runtime and Node validation. Repeated failure should surface as a hard error for that distro until the next user retry.

### Lock and Socket Corruption

Broker startup should treat pid, lock, and socket state as advisory. It should probe the process and clean stale run-state before concluding that a bridge already exists.

## Workspace Routing Model

Each workspace record continues to store:

- target runtime kind
- WSL distro
- Linux workspace path

At runtime, broker routing changes from:

- workspace -> dedicated runtime process

to:

- workspace -> distro bridge -> workspace context inside bridge

This keeps workspace identity stable while changing the execution topology.

## Desktop-Owned Broker Reuse

The desktop host is the only caller that owns WSL broker lifecycle.

Reusable building blocks may still be shared across packages when they are host-runtime-neutral:

- runtime version lookup
- distro runtime install and activation primitives
- managed Node compatibility checks
- bridge health and runtime-info probing
- request routing contracts

The npm CLI must remain host-only and must not directly start, stop, or route WSL bridge processes.

## Migration Plan

### Phase 1

- Introduce shared broker abstractions and per-distro bridge identity.
- Add distro runtime store and managed Node store primitives.
- Change workspace routing from per-workspace runtime ids to per-distro bridge ids.
- Preserve RPC command behavior while changing the transport target.

### Phase 2

- Move all desktop-owned WSL launch paths onto the same shared broker implementation.
- Add runtime upgrade flow that immediately stops and reconciles running bridges.
- Add host-exit bridge shutdown guarantees.

### Phase 3

- Remove obsolete per-workspace WSL runtime assumptions and state layout.
- Add diagnostics surfaces for distro runtime version, Node version, bridge health, and repair status.

## Testing

Add coverage for:

- exact host/WSL runtime version equality checks
- runtime manifest Node compatibility checks
- distro runtime store activation and pointer updates
- bridge singleton behavior per distro
- reuse of one bridge across multiple workspaces in one distro
- bridge restart on runtime version drift
- host runtime update stopping and reconciling running bridges
- host exit stopping all bridges
- shared broker behavior working the same across desktop launch surfaces

## Open Questions Intentionally Deferred

- Exact archive format and distribution mechanism for WSL Linux runtime assets
- Exact managed Node download source and integrity model
- Whether bridge restart after host runtime update should be eager or lazy when no immediate requests follow

These questions do not change the core architecture decision and can be resolved during implementation planning.

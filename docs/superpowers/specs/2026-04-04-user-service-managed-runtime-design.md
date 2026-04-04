# User Service Managed Runtime Design

**Date:** 2026-04-04

**Status:** Proposed

## Goal

Make the globally installed Coder Studio runtime durable on a single user's machine by delegating crash recovery and login-time startup to native user-level service managers instead of Coder Studio's current detached-child runtime model.

## Background

Today the CLI owns runtime lifecycle directly:

- `coder-studio start` launches a detached background process.
- `coder-studio stop` requests shutdown and falls back to killing the pid.
- `coder-studio status` infers runtime state from a locally recorded pid and health probe.

This is enough for manual start/stop, but it does not provide automatic restart after crashes. If the runtime exits unexpectedly, later status checks only discover the stale pid and clear local state.

For the local single-user case, the right owner of long-running runtime lifecycle is the operating system's user-level service manager:

- Linux: `systemd --user`
- macOS: `launchd` `LaunchAgent`
- Windows: Task Scheduler

## Decision

Adopt a native user-service model for managed installs.

Coder Studio will:

- keep the existing unmanaged detached runtime path for ad-hoc usage
- add a managed service mode for persistent installs
- auto-proxy `start` / `stop` / `restart` / `status` to service operations when a service is installed
- use a generated launcher as the stable service entrypoint instead of binding service definitions directly to version-specific server binary paths

## Non-Goals

- Do not add a custom always-running supervisor process inside Coder Studio.
- Do not add root/system-wide service installation in phase 1.
- Do not implement watchdog health restarts for hung-but-still-alive processes in phase 1.
- Do not change the Rust server architecture in phase 1.
- Do not add UI for service management in phase 1.

## Requirements

### Functional

- Users can install a native user-level service for Coder Studio.
- Installed services can be started, stopped, restarted, queried, and uninstalled from the CLI.
- When a service is installed, `coder-studio start/stop/restart/status` automatically use the service-backed path.
- Runtime startup continues to resolve the currently installed package bundle correctly after upgrades.
- The managed runtime still exposes the same HTTP endpoint and health API.

### Reliability

- Crashes should be restarted by the platform service manager.
- Manual stop should not be interpreted by the service manager as a failure loop that immediately respawns the runtime.
- Service installation should be idempotent.
- Service removal should not delete runtime data or the SQLite database.

### UX

- Managed mode must be explicit in status output.
- `start --foreground` must fail in managed mode with an actionable error.
- `start --host` and `start --port` must fail in managed mode and instruct users to update config and restart the service instead.

## Architecture

### 1. Two Runtime Modes

Coder Studio will support two mutually exclusive runtime ownership models:

- `unmanaged`
  - the CLI owns process creation and teardown
  - current detached-child behavior remains as fallback
- `managed`
  - a platform user-level service manager owns process creation and restart
  - the CLI becomes a control plane over that service

The installed service becomes the source of truth for runtime lifecycle whenever managed mode is active.

### 2. Stable Launcher

Service definitions should not point directly at the package's current server binary path. Instead, installation writes:

- a launcher script or command file
- a small service bundle manifest describing the current resolved runtime bundle

The service manager always executes the launcher. The launcher:

- reads the current resolved binary path and dist path
- exports runtime env vars
- foreground-execs the actual server binary

This avoids rewriting service definitions on every package layout change while still allowing upgrades to refresh the launcher and manifest.

### 3. Separate State Layers

Keep runtime instance state and service installation state separate.

#### Runtime state

Existing runtime metadata remains focused on the currently running server instance:

- `pid`
- `endpoint`
- `binaryPath`
- `logPath`
- `startedAt`

#### Service state

Add a new service state record for installation metadata:

- `mode`
- `platform`
- `serviceName`
- `launcherPath`
- `installedAt`
- `lastInstallVersion`

This split keeps "how the runtime is owned" separate from "which server instance is currently active."

### 4. Auto-Proxy Behavior

When service installation is detected and confirmed by the current platform:

- `start` proxies to `service start`
- `stop` proxies to `service stop`
- `restart` proxies to `service restart`
- `status` proxies to `service status`
- `open` should start the service if needed, then open the endpoint

This prevents dual ownership, duplicate runtime processes, and port conflicts.

### 5. Platform Adapters

Phase 1 should isolate platform service logic behind adapters.

#### Linux

Use `systemd --user` with:

- unit file under `~/.config/systemd/user`
- `Restart=on-failure`
- `RestartSec=2`
- `ExecStart=<launcher>`

#### macOS

Use `launchd` `LaunchAgent` with:

- plist under `~/Library/LaunchAgents`
- `RunAtLoad=true`
- `KeepAlive=true`
- launcher-based `ProgramArguments`

#### Windows

Keep the abstraction in phase 1, but defer real implementation to phase 2. The target implementation is a current-user Task Scheduler task with restart-on-failure settings.

## CLI Surface

Add a dedicated command group:

- `coder-studio service install`
- `coder-studio service uninstall`
- `coder-studio service start`
- `coder-studio service stop`
- `coder-studio service restart`
- `coder-studio service status`

Existing commands remain user-facing defaults, but become managed-aware.

## Error Semantics

Managed mode should use specific actionable failures:

- `service_managed_runtime_requires_service_stop_for_foreground_debug`
- `service_managed_runtime_requires_config_update_instead_of_ephemeral_override`
- `service_platform_not_supported`

If local service metadata exists but the platform service no longer does, surface the service as stale and avoid silently assuming managed control still exists.

## Phase 1 Scope

### In Scope

- service state persistence
- launcher generation
- Linux `systemd --user` adapter
- macOS `launchd` adapter
- CLI `service` command group
- auto-proxy for `start` / `stop` / `restart` / `status`
- tests for adapter selection, state handling, and managed-mode command behavior

### Out of Scope

- Windows service implementation
- watchdog or heartbeat-based self-healing
- UI surface for service management
- server protocol changes

## Risks

- Platform-specific quoting and path handling may be error-prone, especially around generated launchers.
- Managed stop semantics must go through the service manager. Killing only the child process would cause immediate respawn loops.
- Service state can drift if users manually edit or delete platform service definitions outside the CLI.

## Validation Plan

Phase 1 should be considered complete when the following flows work on supported platforms:

1. Install service.
2. Run `coder-studio start` and confirm it proxies to service start.
3. Confirm `coder-studio status` reports managed mode and healthy runtime details.
4. Kill the runtime pid manually and confirm the platform service manager restarts it.
5. Run `coder-studio stop` and confirm the runtime stays stopped.
6. Run `coder-studio open` and confirm it can restore the managed runtime when required.

## Open Items

- Whether `open` auto-starts the service in phase 1 or phase 2.
  - Recommendation: include it in phase 1 if the adapter abstraction is already in place.
- Whether Windows lands in the same implementation batch.
  - Recommendation: no; keep the interface ready and ship Linux/macOS first.

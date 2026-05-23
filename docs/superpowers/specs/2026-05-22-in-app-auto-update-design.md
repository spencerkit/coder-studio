# In-App Auto Update Design

> Status: Draft
> Date: 2026-05-22
> Scope: `packages/server` update orchestration and state persistence, `packages/cli` detached updater execution, `packages/web` Settings About surface and update UX

## Goal

Add an in-app update flow for globally installed npm builds of Coder Studio.

The product should:

- poll npm for newer published versions on a configurable interval
- support manual "Check for updates" from Settings
- add an `About` section in Settings that shows app metadata, current version, latest version, update status, and update actions
- allow users to start an update from the UI when the app is installed through global npm
- warn users before updating if active terminals, agent sessions, or supervisor tasks are still running
- restart the managed service safely after installation without relying on the current server process to survive its own update
- degrade to a manual command when the update requires elevated privileges

## Non-Goals

This design does not include:

- supporting source checkouts, local development installs, or non-global npm installs for in-app update execution
- privilege escalation, `sudo` prompts, or OS-native installer flows
- full historical update audit storage
- progress percentages for `npm install -g`
- background updating without explicit user action

## Problem

Coder Studio already exposes its current app version to the frontend and already runs under managed server control through the CLI and PM2-backed startup flow.

What it does not have today is a safe end-to-end update model.

The hard problem is not version discovery. The hard problem is execution authority:

- checking npm can happen inside the running server
- installing a new global package may replace the code backing the current process
- restarting the service from inside the same process risks killing the only actor that still knows what to do next

If the current server process both installs the new package and then tries to restart itself, the update flow can fail in the exact window where the process has already invalidated its own runtime.

The design therefore has to split update coordination from update execution.

## Decision Summary

Use a split update architecture with four layers:

1. `SettingsRepo`
Persist user preferences in the existing settings store:
`updates.autoCheckEnabled`
`updates.checkIntervalSec`

2. `UpdateStateStore`
Persist update workflow state in a dedicated `update-state.json` file.
This file is not configuration and not a log sink. It is a structured checkpoint for update status across process boundaries and service restarts.

3. `UpdateService`
Run inside the server. It owns update checks, update state transitions, lifecycle recovery, and frontend-facing commands and events. It does not execute the actual install.

4. Detached updater worker
Spawned by the server as a detached child process. It performs:
`npm install -g @spencer-kit/coder-studio@<targetVersion>`
followed by managed service restart.

This is the recommended design because it avoids process self-termination during update execution while reusing the existing managed-server restart model.

## Supported Installation Model

In-app update execution is supported only when Coder Studio is running from a global npm installation.

Behavior by installation shape:

- global npm install: full in-app update supported
- anything else: version detection still works, but `Update now` is disabled and the UI explains that only global npm installs are supported

The server must make this support decision explicitly rather than inferring it loosely from environment assumptions.

## Product Behavior

## Settings Navigation

Add a new `About` section to Settings navigation alongside:

- `General`
- `Providers`
- `Appearance`
- `Shortcuts`

Both desktop sidebar navigation and mobile root settings navigation should expose the new section.

The `About` entry is the canonical surface for update status and update actions.

## About Surface

The `About` section should contain three blocks.

### App Information

Display:

- product name
- current version
- installation/update support status
- server instance identifier as secondary troubleshooting metadata

### Update

Display:

- current version
- latest known version
- last checked time
- availability state
- update execution state
- short error summary when relevant

Actions:

- `Check for updates`
- `Update now`

Button rules:

- `Check for updates` is disabled while an update check or update installation is already in progress
- `Update now` is enabled only when a newer version is known, the install shape is supported, and no update execution is already in progress
- if the result requires manual action, `Update now` is disabled and a visible manual command is shown

### Automatic Checks

Display:

- auto-check enabled toggle
- polling interval control

These settings persist through the existing `settings.json` path, not through `update-state.json`.

Recommended interval options:

- 1 hour
- 6 hours
- 12 hours
- 24 hours

A controlled set of intervals is preferable to arbitrary free-form input because it lowers validation and UX complexity.

## Update Discovery UX

When the server detects a new version:

- show a non-blocking toast
- show a badge or visual marker on Settings entry points
- keep the stronger action UI inside `Settings > About`

The user selected non-blocking discovery, so the app must not force an update modal on detection.

Recommended toast copy pattern:

- zh: `发现新版本 vX.Y.Z，可在 设置 > 关于 中更新`
- en: `Version X.Y.Z is available in Settings > About`

## Confirmation UX for Active Work

If the user chooses `Update now` while work is still running, the frontend must show a confirmation dialog before installation starts.

The server should return an activity summary with at least:

- running terminal count
- running agent session count
- running supervisor count

If all counts are zero, the client may start the update immediately without showing the extra confirmation dialog.

If any counts are non-zero, the client should present a confirmation dialog with explicit impact language:

- updating will install a new version
- the service will restart
- current terminals, agent sessions, or supervisor tasks may be interrupted

The confirmed follow-up request should carry an explicit `force` signal so the backend can distinguish "user already acknowledged activity impact" from a silent start attempt.

## Frontend Runtime Experience

While update execution is in progress:

- the About page should show textual workflow status rather than a fake percentage
- update buttons should be disabled
- the page should show a notice that the service will restart briefly
- websocket disconnect during restart is expected and should reuse the existing reconnect path

After reconnect:

- the frontend fetches the latest update state
- if the current version now matches the target version, the UI shows success
- if the update ended in failure or manual-required state, the UI shows the stored summary and next step

The page must treat the detached worker as the source of truth. Closing or reloading the browser must not cancel the update.

## State Model

The design uses two separate state dimensions.

### Availability

Whether a newer published version exists:

- `unknown`
- `up_to_date`
- `update_available`
- `check_failed`

### Update Execution State

What the workflow is currently doing:

- `idle`
- `checking`
- `installing`
- `restarting`
- `succeeded`
- `failed`
- `manual_required`

These dimensions must remain separate. "A newer version exists" and "an install is currently running" are different questions and should not be collapsed into a single enum.

## Persistent Data Boundaries

## `settings.json`

Use the existing `SettingsRepo` for user preferences only:

- `updates.autoCheckEnabled`
- `updates.checkIntervalSec`

These are durable settings, not workflow state.

## `update-state.json`

Use a dedicated update state file for structured update workflow checkpoints only.

It should contain:

- current version
- latest known version
- availability
- update status
- last checked time
- target version
- started time
- finished time
- requires-manual-step flag
- manual command
- error summary

It should not contain:

- user settings
- verbose logs
- appended text output from npm

Its primary purpose is:

- handoff between the running server and the detached updater
- preserving state across managed server restart
- restoring update UI after reconnect
- reconciling interrupted update flows on next server startup

## `update-worker.log`

Detailed stdout, stderr, and failure output from the detached updater belong in a dedicated log file, not in the JSON state file.

This log is for debugging and support, not for product state rendering.

## Example State Shape

```json
{
  "version": 1,
  "currentVersion": "0.4.0",
  "latestVersion": "0.5.0",
  "availability": "update_available",
  "updateStatus": "idle",
  "lastCheckedAt": 1710000000000,
  "targetVersion": null,
  "startedAt": null,
  "finishedAt": null,
  "requiresManualStep": false,
  "manualCommand": null,
  "errorSummary": null
}
```

## Backend Architecture

## `UpdateService`

Add a server-owned `UpdateService` that is created during server startup and injected into the command context.

Responsibilities:

- read and write update workflow state
- read persisted auto-check settings
- schedule periodic checks
- execute manual update checks
- evaluate installation support
- summarize running work before update
- initiate detached updater execution
- reconcile partially completed flows at startup
- emit update state change events to the frontend

Non-responsibilities:

- it must not run `npm install -g` directly in the server process
- it must not assume the current process can survive its own update

## Server Startup Recovery

When the server starts, `UpdateService` should read `update-state.json` and reconcile it against the actual current version.

Rules:

- if `targetVersion === currentVersion`, transition to `succeeded`
- if the persisted state is `installing` or `restarting` but the current version did not advance, transition to `failed`
- if the state is `manual_required`, preserve it until the user acts or a later successful update replaces it

This keeps restart recovery deterministic and prevents the UI from getting stuck forever in `installing`.

## Version Check Execution

Version checks should happen inside `UpdateService`.

Recommended command:

```bash
npm view @spencer-kit/coder-studio dist-tags.latest --json
```

The service must:

- parse the published latest version
- compare it to current app version using semver semantics
- update `latestVersion`, `availability`, `lastCheckedAt`, and any check error summary
- leave the service otherwise undisturbed if the network or registry fails

Check failures must not change the running service state beyond update metadata.

## Managed Scheduling

The service should:

- perform one initial best-effort check after startup
- create a repeating timer only when `updates.autoCheckEnabled` is true
- rebuild or stop that timer when update settings change

The timer period comes from `updates.checkIntervalSec`.

Disabling auto-check should stop polling without removing manual check capability.

## Command Surface

Expose update behavior through explicit server commands rather than frontend shell execution.

Recommended commands:

### `updates.getState`

Returns the update surface model:

- current version
- latest version
- availability
- update status
- last checked time
- target version
- error summary
- support flag
- unsupported reason

### `updates.check`

Performs a manual update check.

Behavior:

- if another check or install is already in progress, reject with a stable busy error
- transition into `checking`
- perform npm version discovery
- persist and broadcast the resulting state

### `updates.prepareInstall`

Performs preflight validation only.

Returns:

- whether in-app update execution is supported
- whether a newer version is currently known
- current target version recommendation
- activity summary for terminals, agent sessions, and supervisor tasks
- whether manual action is expected
- recommended manual command when applicable

This is the call the frontend uses to decide whether a confirmation dialog is required.

### `updates.startInstall`

Starts the actual update flow.

Input:

- `targetVersion`
- `force`

Rules:

- must reject unsupported install shapes
- must reject when no newer target exists
- must reject when another install or restart is already in progress
- must reject active-work cases unless `force` is true
- once accepted, transition state to `installing`, persist it, spawn detached updater, and return immediately

## Activity Summary

`updates.prepareInstall` should compute an explicit work summary from current managers:

- running terminals from `terminalMgr`
- active agent sessions from `sessionMgr`
- active supervisor work from `supervisorMgr`

The response should include counts rather than only a boolean so the client can render a meaningful confirmation dialog.

## Eventing

Add a control-plane event topic for update state changes:

- `update.state.changed`

Emit it when:

- checking starts
- checking finishes
- a new version is discovered
- install starts
- restart handoff begins
- the update succeeds
- the update fails
- manual action becomes required

This avoids polling from the About page and supports global non-blocking notifications.

## Detached Updater Design

## Why Detached Execution Is Required

Updating in the same long-running server process is unsafe because the process is both the thing being replaced and the thing trying to schedule its own restart.

The updater must therefore run in a separate process whose lifetime is not tied to the current websocket connection or current server process shutdown.

## Updater Launch Contract

When `updates.startInstall` is accepted:

1. persist update state with `updateStatus = "installing"`
2. resolve deterministic paths for `update-state.json` and `update-worker.log`
3. spawn a detached updater process
4. return success immediately to the client

Recommended process configuration:

- `detached: true`
- `stdout` and `stderr` redirected to `update-worker.log`
- `unref()` after spawn

The detached updater must not depend on the currently running server process staying alive.

## Bootstrap Strategy

The safest implementation is a lightweight bootstrap worker that depends only on Node built-ins and explicit paths passed in at launch.

The bootstrap worker should:

1. read `update-state.json`
2. validate target version and install support
3. run global npm installation
4. if install succeeds, update state to `restarting`
5. invoke managed restart through the CLI
6. exit

The worker should not assume that importing the old installed package path remains safe after `npm install -g` replaces files.

## Install Then Restart

The update order should be:

1. install new package
2. restart managed service

The app should not stop the current service before installation completes.

Reason:

- if installation fails, the current service remains available
- users do not lose the app merely because the registry or npm command failed

This is a strict design rule for first implementation.

## Restart Path

After successful installation, the detached updater should restart the managed service through the CLI-managed path rather than trying to restart the Fastify server directly.

Recommended command shape:

```bash
coder-studio serve --restart
```

This reuses the existing managed server lifecycle and keeps service ownership in the CLI/PM2 layer where it already belongs.

## Manual Fallback

If the install cannot be completed without elevated privileges, the flow must degrade to `manual_required`.

The UI should present the manual command, for example:

```bash
npm install -g @spencer-kit/coder-studio@<targetVersion>
coder-studio serve --restart
```

The app must not attempt privilege escalation or present OS-native elevation prompts.

## Installation Support Detection

The backend should determine support explicitly.

Supported:

- global npm installation where the managed CLI can be updated in place by the current user

Unsupported:

- source checkouts
- local development execution
- install shapes where global update path cannot be identified reliably

Insufficient privileges:

- treat as executable in theory but not possible automatically in current environment
- transition to `manual_required` with a clear summary

## Failure Model

## Check Failure

Examples:

- npm registry unreachable
- timeout
- malformed response

Handling:

- set `availability = "check_failed"`
- preserve the running app
- show retry capability through manual check

## Install Failure

Examples:

- npm install exits non-zero
- network failure during install
- permission denied

Handling:

- do not stop the old service preemptively
- persist `failed` or `manual_required`
- capture detailed output in updater log
- store only concise `errorSummary` in state

## Restart Failure

Examples:

- installation succeeded but `coder-studio serve --restart` failed

Handling:

- persist `failed`
- store a precise summary such as "new version installed but service restart failed"
- surface manual restart guidance in the UI

## Interrupted Flow

If the updater or host machine exits mid-flow:

- the next server startup reconciliation should resolve impossible transitional states
- long-lived `installing` or `restarting` without version advancement must collapse to `failed`

## Concurrency Rules

Only one update workflow may run at a time.

Rejected concurrency cases:

- starting a manual check while `installing` or `restarting`
- starting an install while another install is already in progress
- spawning more than one updater worker for the same instance

The state store should be treated as single-writer from the active workflow, and commands should guard against overlapping transitions.

## Frontend Design

## Settings Section Model

Extend the Settings section model to include:

- `about`

This affects:

- settings section metadata
- desktop sidebar navigation
- mobile root list
- icon theme semantics
- localized labels and hints

## About Page View Model

The frontend should call `updates.getState` after entering Settings and after reconnect.

It should subscribe to `update.state.changed` to keep the view current without active polling.

Suggested UI fields:

- current version
- latest version or fallback `unknown`
- last checked time
- support status
- availability state text
- update execution state text
- error summary
- manual command when present

## Button Flow

`Check for updates`:

1. disable button
2. call `updates.check`
3. re-render from returned or broadcast state

`Update now`:

1. call `updates.prepareInstall`
2. if unsupported, show explanatory state
3. if active work exists, open confirmation dialog
4. after confirmation, call `updates.startInstall({ targetVersion, force: true })`
5. show `installing` state and wait for state events / reconnect

## Reconnect Behavior

During the update restart window:

- websocket disconnect is expected
- the About page must not treat it as an update failure
- after reconnect, the frontend should re-fetch update state and compare current version to target version through the server response

## Testing Strategy

## Backend Unit Tests

Cover:

- version check result mapping
- auto-check timer lifecycle
- install support detection
- active work summary generation
- state reconciliation after restart
- update state transitions
- concurrency rejection

## Detached Worker Tests

Cover:

- install-success then restart-success path
- install permission failure to `manual_required`
- install failure to `failed`
- restart failure after successful install

These tests can mock process execution rather than running real global installs.

## Frontend Tests

Cover:

- About section navigation visibility on desktop and mobile
- About page rendering of current and latest version
- auto-check preference persistence through settings
- update check button disabled states
- active-work confirmation flow
- success, failure, and manual-required rendering
- reconnect recovery after update restart

## Residual Risks

The main implementation risks are:

1. accurately detecting whether the current install shape is eligible for in-app update
2. ensuring the detached updater does not rely on files that may be replaced during global npm install
3. keeping restart recovery consistent when update completion and reconnect timing race each other

These are solvable within the proposed architecture, but they should be treated as explicit implementation checkpoints rather than incidental details.

## Recommended First Implementation Slice

Implement in this order:

1. update state store plus server-side `UpdateService`
2. manual `updates.check` and About page rendering
3. persisted auto-check settings and scheduler
4. `updates.prepareInstall` activity summary and confirmation UX
5. detached updater worker and managed restart handoff
6. startup reconciliation and full reconnect recovery

This sequence delivers observable value early while keeping the restart-critical work isolated until the product surface and state model are already stable.

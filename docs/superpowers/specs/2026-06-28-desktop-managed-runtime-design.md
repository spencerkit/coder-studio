# Desktop-Managed Runtime Design

> Status: Draft
> Date: 2026-06-28
> Scope: `packages/desktop` runtime bootstrap and runtime store, `packages/server` desktop-managed update capability, runtime bundle packaging and GitHub Release distribution

## Goal

Turn the desktop product into an Electron shell that manages a versioned local runtime independently from the app installer.

The product should:

- launch the product through Electron while keeping the actual workspace/runtime server in a separate local process
- stop routing desktop runtime startup through `packages/cli`
- separate `appVersion` from `runtimeVersion`
- allow the desktop app to bootstrap a runtime on first launch by downloading the latest compatible runtime bundle
- allow later runtime updates without shipping a new Electron app build
- keep desktop update behavior independent from global npm semantics
- show a built-in Electron HTML error page whenever bootstrap or runtime startup fails
- keep room for a later app-installer auto-update path without coupling it to runtime updates

## Non-Goals

This design does not include:

- merging the server runtime into the Electron main process
- keeping the current `global_npm` update flow as the desktop update model
- requiring a bundled full runtime inside the Electron installer
- implementing a complete Electron installer auto-update flow in this change
- defining a non-GitHub release backend for runtime distribution beyond the required abstraction layer
- supporting offline-first first launch

## Problem

The current desktop app is an Electron shell that launches a sidecar server, but the startup path still inherits CLI-oriented semantics:

- desktop startup goes through a CLI entrypoint
- desktop runtime packaging stages a deployable CLI bundle
- desktop update capability inherits the npm-based `global_npm` model

That coupling is acceptable for early bring-up, but it is the wrong long-term boundary for a packaged desktop product.

The desktop app has different requirements:

- it cannot assume a global Node/npm installation
- it should not update itself through `npm install -g`
- it needs a runtime that can update more frequently than the Electron shell
- it needs a runtime failure path that does not take down the GUI process

The architecture therefore needs two separations:

1. separate desktop runtime startup from CLI startup
2. separate desktop app versioning from runtime versioning

## Current State

### Startup Shape

The current desktop shell launches a child process and waits for a local runtime to become healthy. That isolation boundary is correct and should remain.

The problem is the launched artifact:

- Electron starts a desktop sidecar child process
- the child process uses a CLI desktop entrypoint
- the CLI entrypoint reuses the generic server runner
- the generic server runner injects CLI update semantics

### Update Shape

The current update implementation is designed for globally installed npm builds:

- the server checks npm for the latest version
- a detached worker runs `npm install -g`
- the service restarts afterward

That flow is appropriate for the CLI product and inappropriate for a packaged Electron desktop app.

### Runtime Packaging Shape

The current desktop packaging flow stages a runtime bundle by deploying the CLI package into desktop resources.

That makes the packaged desktop runtime structurally dependent on CLI layout and CLI startup assumptions.

## Decision Summary

Use a desktop-managed runtime architecture with five layers:

1. Electron shell
Owns the window, lifecycle, bootstrap UX, error pages, and future installer updates.

2. Desktop runtime launcher
Finds the currently active runtime bundle and launches it as a child process using the embedded Node executable.

3. Desktop runtime store
Stores downloaded runtime bundles under the user data directory, tracks the active version, and supports atomic activation and rollback.

4. Runtime release provider abstraction
Defines how desktop discovers compatible runtime releases and downloads release metadata and artifacts.

5. Runtime server process
Runs the actual product runtime by calling `@coder-studio/server` directly from a desktop-specific entrypoint.

This is preferred over embedding the server in the Electron main process because the runtime should stay isolated from GUI lifecycle failures and should remain individually restartable and replaceable.

This is preferred over shipping the runtime only through installer updates because runtime changes need a faster release cadence than Electron shell changes.

## Alternatives Considered

### Option A: Electron main process runs the server directly

Rejected.

This removes one process boundary but makes stability worse:

- a server crash becomes an app crash
- runtime restart becomes main-process restart
- terminal, agent, and WSL concerns get mixed into the GUI host
- future runtime replacement and rollback become harder

### Option B: Keep the current CLI-backed sidecar and add desktop-specific exceptions

Rejected.

This keeps the wrong abstraction boundary in place and would continue to leak CLI install/update semantics into the desktop product.

### Option C: Desktop-managed runtime with a dedicated desktop launcher

Chosen.

This preserves process isolation while giving desktop its own runtime lifecycle and update model.

## Architecture

### Product Boundary

The desktop product should be treated as:

- a thin Electron app shell
- plus a versioned runtime that lives outside the installer directory

The desktop app is responsible for obtaining a compatible runtime, activating it, starting it, monitoring it, and recovering when it fails.

The runtime is responsible for:

- web app hosting
- websocket handling
- workspace operations
- agent sessions
- terminal management
- WSL orchestration
- server-side update state exposure

### Process Boundary

The runtime remains a separate child process.

Desktop must not run the server runtime inside the Electron main process. The main process is a controller and fallback shell, not the runtime host.

### Desktop-Specific Runtime Entry

Desktop should stop using the CLI desktop entrypoint and instead use a desktop-specific server entry that directly imports `@coder-studio/server`.

That entrypoint should:

- construct the desktop runtime config
- call `createServer()`
- expose desktop-specific update capability
- avoid reading CLI installation/update semantics as defaults

It may still reuse generic server helpers where that does not reintroduce CLI product assumptions.

## Version Model

The product uses two versions:

### `appVersion`

The Electron app shell version.

It describes:

- Electron shell code
- installer shape
- embedded Node binary
- native dependencies
- app-level preload and window behavior

### `runtimeVersion`

The local runtime bundle version.

It describes:

- server/runtime code
- web assets served by the runtime
- runtime-side dependencies
- runtime-side update behavior

`runtimeVersion` should align with the CLI package version so the same server/runtime build line can serve both CLI and desktop distribution channels.

### Product UI

The desktop product should show both versions in About/Settings:

- App version: `appVersion`
- Runtime version: `runtimeVersion`

Users should be able to understand that the runtime may change independently of the installed app shell.

## Runtime Distribution Model

### Provider Abstraction

Define a `RuntimeReleaseProvider` abstraction in the desktop layer.

The provider must support:

- resolving the latest runtime compatible with a given app version, platform, and architecture
- resolving a specific runtime version
- returning artifact metadata
- returning a download URL or readable download stream

The abstraction is required even though the first implementation is GitHub Release, because the desktop runtime lifecycle should not be hard-coded to one hosting backend.

### First Provider: GitHub Release

The first implementation should use GitHub Release assets.

The provider should resolve the latest compatible runtime rather than the absolute latest runtime. Compatibility must be enforced before installation.

### Runtime Release Metadata

Each runtime release should expose at least:

- `version`
- `platform`
- `arch`
- `artifactUrl`
- `checksumSha256`
- `artifactSize`
- `publishedAt`
- optional `minAppVersion`
- optional `notes`

The metadata may come from either:

- a dedicated manifest asset attached to the release, or
- a repository-level release index fetched through GitHub-backed hosting

The important requirement is deterministic machine-readable metadata, not scraping human release notes.

### Artifact Naming

Runtime artifacts should be versioned by runtime version, platform, and architecture, for example:

- `coder-studio-runtime-1.2.3-windows-x64.zip`
- `coder-studio-runtime-1.2.3-darwin-arm64.tar.gz`

## Runtime Bundle Layout

Each installed runtime bundle should have a stable internal layout so the launcher can find the runtime entry deterministically.

Each bundle should contain at least:

- a runtime manifest
- the server entrypoint for desktop runtime launch
- required server/runtime dependencies
- required web assets

The bundle should not require:

- the CLI package layout
- a global package manager
- access to the Electron installer directory

## Runtime Store

### Location

The runtime store should live under the Electron user data directory.

Recommended structure:

- `userData/runtime-store/current.json`
- `userData/runtime-store/versions/<runtimeVersion>/`
- `userData/runtime-store/downloads/`
- `userData/runtime-store/staging/`

### `current.json`

`current.json` is the activation pointer.

It should record at least:

- `version`
- `installedAt`
- `path`
- `entry`
- `checksumSha256`
- `source`
- optional `previousVersion`

The launcher should treat `current.json` as the single source of truth for which runtime to start.

### Activation Rules

Activation must be atomic.

Desktop should:

1. download into `downloads/`
2. unpack into `staging/`
3. validate the bundle
4. move the fully installed runtime into `versions/<runtimeVersion>/`
5. atomically update `current.json`

Desktop must never partially overwrite the currently active runtime in place.

### Retention Rules

Desktop should keep:

- the current active runtime
- the last successful previous runtime
- optionally one more recent inactive successful runtime

Failed installs may be deleted after diagnostics are recorded. The active runtime must never be deleted while in use.

## Bootstrap and Startup Flow

### First Launch

The app should not ship with a full bundled runtime as the primary model.

On startup:

1. Electron checks `runtime-store/current.json`
2. if an active runtime exists, it launches it
3. if no active runtime exists, Electron enters bootstrap flow
4. bootstrap resolves the latest runtime compatible with the current app version
5. bootstrap downloads, validates, installs, and activates that runtime
6. Electron launches the activated runtime

This keeps the app and runtime fully decoupled and allows a freshly installed app to use the latest compatible runtime immediately.

### Later Launches

If a valid active runtime exists, Electron should launch it immediately without waiting for a new remote check.

Update checks for newer runtime versions happen after the current runtime becomes available.

### Health Check

After spawn, desktop should wait for the runtime to become healthy using the same basic model already used today:

- runtime writes or exposes its runtime config
- desktop resolves the browser URL
- desktop performs a health check request

Only after health check success should the main window navigate to the runtime URL.

## Error Shell and Fallback UX

Electron must own a built-in HTML error page that does not depend on the runtime.

This page is the final fallback surface for:

- bootstrap download failure
- bootstrap validation failure
- active runtime missing or corrupt
- runtime startup failure
- runtime unexpected exit after startup
- runtime page unrecoverable failure

The existing desktop error page direction is correct and should be expanded into a general-purpose bootstrap/runtime fault page.

### Error Page Responsibilities

The fallback page should show:

- error title
- short human-readable explanation
- optional diagnostic excerpt
- retry action where recovery is possible
- quit action
- optional log path or copyable details for troubleshooting

### Bootstrap Failure UX

When first-launch runtime download fails, Electron should remain on the fallback page and should not attempt to open the main runtime URL.

The page should show:

- the target runtime version or resolution target
- the provider/source
- the failure summary

### Runtime Exit UX

If the runtime exits after a successful launch, Electron should replace the current page with the fallback page rather than leaving the user on a broken or stale runtime view.

## Update Model

### Runtime Update Priority

Runtime updates are the primary in-app update path for the desktop product.

The runtime should update more frequently than the app shell.

### App Update Priority

App shell updates are lower-frequency and should mainly carry:

- Electron shell changes
- embedded Node updates
- native dependency updates
- installer-level changes

This design leaves room for a future installer auto-update path, but that path is distinct from runtime updates.

### Desktop-Managed Runtime Update Flow

When the user chooses to update the runtime:

1. desktop or runtime-facing update UI resolves the target compatible runtime
2. desktop downloads the runtime bundle
3. desktop validates checksum and manifest
4. desktop installs the bundle into the runtime store
5. desktop updates `current.json`
6. desktop restarts the runtime child process
7. desktop waits for healthy startup
8. if startup succeeds, the update is complete
9. if startup fails, desktop rolls back to the previous active runtime and restarts it

### Update State Ownership

The runtime server should continue to expose update state to the web client, but desktop-managed install execution should be owned by the desktop layer rather than a generic npm worker.

That means the server update capability model needs to grow beyond:

- `global_npm`
- `unsupported`

It should support at least:

- `global_npm`
- `desktop_managed`
- `unsupported`

### Compatibility Rules

Runtime installation must be gated by compatibility.

At minimum, a runtime release should be able to declare:

- `minAppVersion`

Desktop should only install the latest compatible runtime for the current:

- `appVersion`
- platform
- architecture

Desktop must not assume that the newest published runtime is safe for every installed app shell.

## Server Integration

The runtime server package remains the actual runtime implementation.

The required server-facing change is not to move runtime logic into Electron. The required change is to let the server advertise a desktop-managed update mode and accept desktop-managed lifecycle orchestration.

The server should:

- expose current runtime version
- expose update availability and update state
- surface active-work confirmation information as it already does for updates
- avoid assuming that update installation is always done by npm

The server should not:

- directly call GitHub Release APIs in the first cut
- own Electron-specific downloader logic
- own installer replacement logic

## Packaging Model

Desktop packaging should stop embedding a CLI deploy bundle as the long-term runtime model.

Instead, packaging should produce:

- Electron shell assets
- desktop bootstrap/runtime management code
- embedded Node binary required to launch runtime bundles

Runtime bundles should be built as versioned artifacts for remote distribution and local installation into the runtime store.

## Migration Plan

Implement the architecture in four phases.

### Phase 1: Remove CLI startup coupling

- keep the sidecar process model
- replace the CLI desktop server entry with a desktop-specific runtime entry
- stop inheriting CLI update semantics for desktop runtime startup

This phase keeps behavior similar while correcting the ownership boundary.

### Phase 2: Introduce runtime store and activation model

- add `runtime-store`
- add `current.json`
- make the launcher read from the active runtime pointer
- support local activation and rollback

This phase creates the runtime lifecycle primitives before remote download is introduced.

### Phase 3: Add provider-backed bootstrap and install

- define `RuntimeReleaseProvider`
- implement GitHub Release provider
- support first-launch bootstrap download
- support install, validation, activation, and rollback
- expand fallback error UX for bootstrap failures

This phase decouples runtime delivery from the app installer.

### Phase 4: Complete desktop-managed update UX

- expose `desktop_managed` update capability through the server/update surface
- show both app and runtime versions in About
- wire update actions to desktop-managed runtime installation
- add background check, restart, and rollback UX

This phase completes the user-facing runtime update product.

## Testing

### Desktop Tests

Add coverage for:

- provider compatibility resolution
- runtime download and checksum validation
- runtime store activation and atomic pointer updates
- rollback after failed runtime startup
- first-launch bootstrap without an installed runtime
- fallback error page rendering for bootstrap failure
- fallback error page rendering for unexpected runtime exit

### Server Tests

Add coverage for:

- `desktop_managed` update capability wiring
- update state transitions that do not assume npm install execution
- About/update API responses that distinguish app version from runtime version where applicable

### End-to-End Tests

Add or extend desktop flow coverage for:

- first launch with no installed runtime
- successful runtime bootstrap
- runtime update to a newer compatible version
- failed update followed by rollback
- runtime crash after launch showing the Electron fallback page

## Rollout Notes

- The sidecar process boundary should remain stable throughout the migration.
- Desktop should not regress existing runtime failure reporting while bootstrap support is added.
- The first implementation may use a single GitHub Release-backed provider internally, but the code boundary should remain provider-based from the start.
- App-installer auto-update should remain a separate future track.

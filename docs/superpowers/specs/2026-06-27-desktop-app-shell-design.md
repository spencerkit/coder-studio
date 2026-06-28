# Desktop App Shell Design

## Summary

Add a first-party desktop application shell for Coder Studio so users can install and run the product on macOS and Windows without pre-installing Node.js.

The desktop app should preserve the current product architecture and behavior as much as possible:

- existing `packages/web` UI remains the primary product surface
- existing `packages/server` runtime remains the source of truth
- existing provider CLI requirements remain unchanged
- existing LAN/mobile access capability remains available

The desktop app is therefore a runtime wrapper, not a product rewrite. It embeds a desktop window around the current local-server model, bundles a Node runtime with the app, starts the existing Coder Studio server as a child process, loads the existing web UI from `http://127.0.0.1:<port>`, and shuts the server down automatically when the app exits.

## Goals

- Remove the requirement for users to install Node.js before using Coder Studio.
- Ship a true desktop application for `macOS` and `Windows`.
- Keep the existing web app, server runtime, and provider model intact.
- Preserve current LAN/mobile access behavior for users who want to monitor from phone or tablet.
- Ensure the server process is owned by the desktop app lifecycle and is stopped when the app exits.
- Keep the current npm CLI distribution path intact alongside the new desktop distribution path.

## Non-goals

- No change to provider CLI installation requirements.
- No rewrite of the product into a desktop-native UI.
- No migration from Fastify/WebSocket/browser UI to a new runtime model.
- No always-on background service or tray-only persistence in the first iteration.
- No Linux desktop support in the first iteration.
- No automatic provider bundling inside the desktop app.
- No support for running both the desktop-owned runtime and an external CLI-owned runtime against the same state directory at the same time.

## Current State

### Product architecture today

Coder Studio currently runs as a Node-based local product:

1. the user installs `@spencer-kit/coder-studio` globally through npm
2. the CLI starts the local Fastify/WebSocket server
3. the CLI opens the browser to the local URL
4. the browser loads the bundled web UI

This architecture already cleanly separates:

- frontend UI in `packages/web`
- backend runtime in `packages/server`
- launcher and packaging behavior in `packages/cli`

That separation makes a desktop shell feasible without redesigning the core product.

### Operational constraints today

- `packages/cli` bundles the server-facing entrypoints such as `dist/esm/server-runner.mjs`
- the CLI currently supports a managed-server model through `pm2`
- the server assumes a real Node runtime for child-process and bundled-tool behaviors
- some runtime paths rely on `process.execPath` being the Node executable

These constraints make "run the server inside Electron main" a high-risk option. The desktop app should continue running the server in a real Node sidecar process.

## Approaches Considered

### Approach A: Electron shell with Node sidecar

Description:
- add a desktop package using Electron
- bundle a Node runtime with the app
- launch the existing Coder Studio server as a child process
- load the existing web UI in `BrowserWindow`

Pros:
- smallest behavioral change
- strongest fit for the current architecture
- preserves Fastify/WebSocket/PTTY/LSP/runtime assumptions
- keeps LAN/mobile access straightforward
- keeps desktop shell concerns isolated from server logic

Cons:
- larger installer size
- requires desktop packaging, signing, and child-process lifecycle work

### Approach B: Electron shell with server running directly in Electron main

Description:
- run the existing server code inside the Electron main process

Pros:
- fewer visible binaries

Cons:
- `process.execPath` no longer points to a real Node executable
- bundled-tool and child-process assumptions become fragile
- harder to reason about lifecycle boundaries
- greater regression risk for LSP, automation, and terminal-adjacent workflows

### Approach C: Tauri or alternate WebView shell with sidecar runtime

Description:
- use a lighter desktop shell while still running a Node sidecar

Pros:
- smaller shell footprint

Cons:
- lower leverage for a Node-heavy product
- more packaging complexity for sidecar/runtime distribution
- less payoff than Electron given the current stack

### Recommendation

Choose **Approach A**.

It best matches the user requirement: "all existing behavior stays the same; only add a shell that starts the environment and opens the web page inside the shell." It is also the most conservative technical path.

## Chosen Architecture

### High-level runtime model

The desktop app adds a new outer layer around the existing product:

`Desktop Shell -> Node Sidecar -> Existing Server -> Existing Web UI`

Responsibilities:

- `packages/desktop`
  - Electron main process
  - application lifecycle
  - single-instance guard
  - child-process management
  - startup health checks
  - desktop error surfaces
- `packages/cli`
  - continues to produce the bundled server entrypoint and bundled web assets
  - provides the assembled runtime content reused by desktop packaging
- `packages/server`
  - remains the actual product runtime
- `packages/web`
  - remains the actual product UI

### Why the server stays out of Electron main

The server must remain in a separate real Node process because the current runtime depends on Node semantics in several places:

- bundled tool launch paths
- `process.execPath` expectations
- PTY and child-process orchestration
- runtime helpers and automation entrypoints

Running the server in Electron main would blur the contract between the launcher executable and the runtime executable and create avoidable regression risk.

## Package and Repository Layout

## New package

Add:

- `packages/desktop`

Expected responsibilities inside the package:

- Electron app entrypoint
- window creation
- sidecar process coordinator
- startup state machine
- shutdown coordinator
- desktop-specific error/retry UI
- platform packaging configuration

### Existing packages reused

- `packages/web`
  - unchanged product UI
- `packages/server`
  - unchanged server/runtime core
- `packages/cli`
  - continues to assemble:
    - `dist/esm/server-runner.mjs`
    - `dist/esm/index.mjs`
    - `dist/web/*`

### Build integration

Add a desktop build layer on top of the existing build:

1. build `packages/web`
2. build `packages/cli`
3. assemble the desktop app using the CLI build output plus a bundled Node runtime

This keeps the npm CLI artifact and the desktop artifact as parallel distribution outputs rather than forcing one release path to replace the other.

## Packaging Model

### Desktop app contents

Each desktop package should include:

- Electron application code from `packages/desktop`
- a bundled Node runtime for the target platform
- `packages/cli/dist/esm/*`
- `packages/cli/dist/web/*`
- required production dependencies for the CLI/server runtime

### Distribution outputs

First iteration target outputs:

- `macOS`: `.dmg`
- `Windows`: `.exe` installer

No Linux packaging in the first iteration.

### Packaging tool choice

Use `Electron` with a standard installer-focused packaging tool such as `electron-builder` for the first iteration.

This design treats that choice as part of the implementation direction rather than leaving the packaging layer open-ended, because the required outputs are installer artifacts, not development-only app bundles.

## Startup Flow

### Normal startup

1. the user launches the desktop app
2. Electron main acquires the single-instance lock
3. the desktop coordinator resolves:
   - bundled Node runtime path
   - bundled CLI server entry path
   - app-specific state directory
   - listen host and port
4. the desktop coordinator spawns the Node sidecar process
5. the sidecar starts the existing Coder Studio server
6. Electron polls a health endpoint or local URL readiness check
7. once healthy, `BrowserWindow` loads `http://127.0.0.1:<port>`
8. the user sees the normal Coder Studio UI inside the app window

### Port behavior

- the desktop window should always load `127.0.0.1`
- if server config uses `0.0.0.0`, LAN/mobile access remains available
- the desktop shell should not bind the window to a non-local host even if external listening is enabled

### Configuration inputs

The desktop app should continue to honor the existing server configuration model where practical:

- host
- port
- state directory
- auth password

But the lifecycle owner changes:

- CLI managed mode uses `pm2`
- desktop mode uses a direct child process owned by Electron

The desktop app should pass these values to the sidecar explicitly rather than depending on a reused external managed-runtime lookup path.

## Shutdown and Process Ownership

### Required behavior

When the user closes the desktop app, the server process must be stopped automatically.

This is a hard product rule for the first iteration.

### Shutdown flow

1. user closes the last main window or explicitly quits the app
2. Electron main begins controlled shutdown
3. desktop coordinator sends a graceful stop signal to the Node sidecar
4. wait for a short timeout window such as `5-10s`
5. if the process has not exited, force kill it
6. exit the Electron app only after the child process lifecycle is resolved

### Ownership rules

- the desktop app manages only the runtime it started
- it must not adopt or reuse an already-running `pm2`-managed CLI server
- it must not leave a background runtime alive after app exit

## Managed Runtime Strategy

### Do not use `pm2` in desktop mode

Desktop mode should bypass the existing managed-server CLI flow and launch the sidecar directly.

Reasoning:

- the current CLI managed-server model is designed for service reuse across invocations
- the desktop app needs strict lifecycle ownership
- "close app -> stop server" is incompatible with a reused external process manager model

### Desktop runtime mode

The server sidecar should run in an explicit desktop-owned mode with these properties:

- no `pm2`
- no detached service lifetime
- direct stdout/stderr capture for diagnostics
- explicit startup and shutdown state tracking

This mode can be implemented by reusing the existing server runner entrypoint with desktop-specific launch semantics rather than inventing a new server core.

## LAN and Mobile Access

### Preserved behavior

The desktop app must preserve the current product capability where users can open the same workspace from phone or tablet over their local network.

### First-iteration scope

- retain current host/password configuration semantics
- keep the current local server as the shared source for desktop and mobile clients
- allow the desktop window and external browsers to connect to the same runtime

### Explicit non-goal

The first iteration does not redesign remote access UX, pairing flows, or network onboarding. It only preserves the current capability.

## Error Handling and Recovery

### Startup failures

The desktop app should show a startup-failure surface rather than a blank window when:

- the Node sidecar fails to spawn
- the configured port is unavailable
- bundled web assets are missing
- the server exits before becoming healthy

That surface should include:

- a short human-readable error summary
- a log excerpt
- a retry action
- an exit action

### Runtime failure

If the sidecar exits unexpectedly after startup:

- the desktop app should detect the crash
- the user should see a recovery surface
- actions should include:
  - restart service
  - exit app

The desktop app should not silently sit on a broken page.

## State Directory and Concurrency

### State directory behavior

The desktop app should use the same server persistence model as the current product, with a stable application-owned state directory by default.

### Concurrency guard

First iteration should not allow:

- desktop app runtime and external CLI runtime
- or multiple desktop runtimes

to write to the same state directory simultaneously.

The desktop startup path should detect an active conflicting runtime and block startup with a clear message rather than risking state corruption or split ownership.

The preferred implementation direction is a desktop-owned runtime lock for the resolved state directory, rather than best-effort process guessing alone.

## Security and Surface Area

### Security stance

The desktop app does not change the product's trust model:

- it is still a local-first product
- provider CLIs still run locally
- file access still occurs through the local server/runtime

### Additional desktop constraints

- Electron window should load only the local runtime URL
- Node integration should not be exposed to the renderer unless strictly required
- desktop shell responsibilities should stay in main/preload, not in the web app bundle

## Testing Strategy

### Unit coverage

Add focused tests for:

- sidecar launch argument assembly
- startup health-check behavior
- shutdown sequencing
- graceful-stop timeout fallback
- single-instance handling
- conflict detection around occupied runtime/state ownership

### Integration coverage

Add integration coverage for:

- Electron main launching the bundled Node sidecar
- sidecar bringing up the existing server successfully
- `BrowserWindow` loading the local Coder Studio URL
- app exit stopping the sidecar process

### Smoke validation

Manual or automated smoke tests should verify:

- startup on macOS
- startup on Windows
- workspace open
- provider CLI detection remains unchanged
- terminal/session behavior remains unchanged
- LAN/mobile access still works when host is externally bound
- app exit leaves no runtime process behind

## Release and Build Work

### New scripts

Add a desktop build path, likely including:

- `build:desktop`
- optional platform-specific packaging scripts

Repository build sequencing should become:

1. build web
2. build CLI
3. package desktop app

### Artifact separation

Keep release outputs separate:

- npm CLI package remains publishable as today
- desktop installers are produced by the desktop build pipeline

This avoids coupling desktop release constraints to npm publication constraints.

## Risks

### Technical risks

- bundling the correct Node runtime per platform
- ensuring native dependencies such as `node-pty` work correctly inside the packaged desktop distribution
- preventing path or `process.execPath` regressions in sidecar-launched helper tools
- ensuring shutdown is reliable on both macOS and Windows

### Product risks

- users may assume the desktop app also removes provider CLI installation requirements
- users may expect tray/background behavior after closing the window

These expectations should be handled explicitly in product copy and documentation.

## Rollout Recommendation

Ship the desktop shell as a separate first iteration, without changing the current npm CLI install path.

Recommended sequence:

1. land `packages/desktop` and sidecar lifecycle orchestration
2. verify packaged startup/shutdown on macOS and Windows
3. document that Node is bundled but provider CLIs are still external
4. add installer distribution to release workflow

## Open Questions Resolved In This Design

- Platform scope: `macOS + Windows`
- Product form: true desktop app, not browser launcher
- LAN/mobile access: preserved
- Provider behavior: unchanged
- Runtime ownership: desktop app owns and stops its server
- Distribution model: new desktop artifact alongside existing npm CLI artifact

## Implementation Targets

Expected primary change areas:

- new `packages/desktop`
- desktop packaging scripts under `scripts/`
- limited compatibility adjustments in `packages/cli`
- minimal or no core behavioral changes in `packages/server` and `packages/web`

## Acceptance Criteria

The first desktop-shell iteration is complete when all of the following are true:

- a user can install and launch Coder Studio on macOS or Windows without pre-installing Node.js
- launching the app opens a desktop window that renders the existing Coder Studio web UI
- the app starts the existing server runtime through a bundled Node sidecar
- provider CLI expectations remain unchanged
- LAN/mobile access still works when configured
- closing the app stops the server process
- the npm CLI distribution path still works independently

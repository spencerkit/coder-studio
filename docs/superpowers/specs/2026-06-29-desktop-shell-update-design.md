# Desktop Shell Update Design

**Date:** 2026-06-29
**Status:** Draft
**Scope:** Electron desktop shell auto-update for Windows/macOS, kept separate from the existing runtime update flow

## Goal

Add a first-class auto-update path for the Electron desktop shell while preserving the existing runtime update mechanism as an independent channel. The desktop app must be able to:

- show app version and runtime version separately
- check whether a newer desktop shell build exists on GitHub Releases
- download the shell update inside the app
- prompt the user to restart and apply the new shell build
- continue using the existing runtime updater for the sidecar/runtime bundle

## Current State

### Runtime update already exists

- CLI installs run the server with `appVersion = runtimeVersion = cliVersion`.
- Desktop installs run the server sidecar with:
  - `appVersion = Electron shell version`
  - `runtimeVersion = sidecar/runtime bundle version`
  - `installKind = "desktop_managed"`
- The existing Settings > About "Check now / Update now" actions go through server commands and currently update the runtime only.

Relevant code:

- `packages/cli/src/server-runner.ts`
- `packages/cli/src/update-runtime.ts`
- `packages/server/src/update/update-service.ts`
- `packages/desktop/src/runtime-launch-entry.ts`
- `packages/desktop/src/desktop-update-bridge.ts`
- `packages/web/src/features/settings/components/about-settings.tsx`

### Desktop shell auto-update does not exist yet

- `packages/desktop/src/main.ts` currently bootstraps Electron, handles single-instance behavior, retry, and quit.
- No `autoUpdater`, `electron-updater`, or equivalent shell updater integration is wired today.
- `packages/desktop/package.json` builds desktop installers with `electron-builder`, but publish is disabled via `"publish": "never"`.

## Non-Goals

- Do not merge shell update state into the server runtime update state.
- Do not make Linux shell auto-update part of phase 1.
- Do not move the server into the Electron main process as part of this work.
- Do not redesign the runtime release index format.
- Do not introduce a single blended "product update" button that hides whether the update targets the shell or the runtime.

## Approaches Considered

### Option A: Keep runtime updater, add a separate Electron shell updater

Use the current runtime update path unchanged. Add a new main-process shell update service that uses GitHub Releases via Electron's updater path and exposes state to the renderer over IPC.

Pros:

- minimal disruption to the working runtime update chain
- clear separation of concerns
- no need to teach the server about shell installers, blockmaps, or app restarts
- app version and runtime version remain independently meaningful

Cons:

- two update surfaces must coexist in UI
- desktop-only state must be plumbed through preload instead of the server websocket

### Option B: Move both runtime and shell updates into a single desktop-owned update coordinator

Make Electron own both shell and runtime update logic and let the web frontend talk only to Electron for desktop installs.

Pros:

- one desktop-specific update boundary
- server no longer owns desktop runtime update orchestration

Cons:

- larger refactor
- duplicates existing runtime update state machinery
- higher regression risk during ongoing WSL/runtime work

### Option C: Replace Electron updater with a custom GitHub asset downloader

Implement shell release polling and installer download manually using GitHub release APIs, then execute the installer or zip replacement flow ourselves.

Pros:

- maximum control
- release metadata format can mirror runtime release metadata

Cons:

- much more platform-specific behavior
- easy to get Windows/macOS install flows wrong
- reinvents functionality that Electron ecosystem already provides

## Recommendation

Use **Option A**.

The runtime updater is already correctly split from the desktop shell. The shortest stable path is to leave runtime updates exactly where they are and add a new Electron main-process service for shell updates. The desktop app then exposes two independent update channels:

- `runtime update`: managed by the server/runtime
- `shell update`: managed by Electron main process

## Target Architecture

## Version Model

- `appVersion`: Electron shell version from `app.getVersion()`
- `runtimeVersion`: desktop sidecar/runtime bundle version

Both values continue to be displayed in Settings > About.

Interpretation:

- shell version changes when Electron app binaries/installers change
- runtime version changes when sidecar/runtime bundle changes

## Update Ownership

### Runtime update

Keep current behavior:

- frontend calls server `updates.*`
- server `UpdateService` checks and installs runtime updates
- desktop sidecar bridges to Electron only to resolve/install the runtime bundle

### Shell update

New behavior:

- renderer calls desktop preload API
- preload forwards to Electron main process over IPC
- main process `ShellUpdateService` owns:
  - current shell update state
  - auto-check scheduling
  - latest release lookup
  - download lifecycle
  - "restart to apply" flow

The server remains unaware of shell updater internals.

## Release Source

Shell updates should use **GitHub Releases**.

Recommended implementation:

- use `electron-builder` for packaging
- use `electron-updater` GitHub provider for install/update transport
- publish shell artifacts to GitHub Releases

This keeps the delivery mechanism GitHub-based while avoiding a custom installer/replacement implementation.

Expected release artifacts:

- Windows:
  - `latest.yml`
  - installer `.exe`
  - `.blockmap`
- macOS:
  - `latest-mac.yml`
  - `.zip`
  - `.dmg`
  - `.blockmap`

Runtime release assets remain separate and continue using the existing runtime release index plus runtime bundle artifacts.

## Desktop Main-Process Design

Create a new service:

- `packages/desktop/src/shell-update-service.ts`

Responsibilities:

- wrap Electron updater APIs
- normalize state into a renderer-friendly shape
- expose imperative actions:
  - `getState()`
  - `checkForUpdates()`
  - `downloadUpdate()`
  - `quitAndInstall()`
- subscribe to updater events and emit state changes
- gate support by platform and packaging mode

Phase 1 state shape:

```ts
export type ShellUpdateAvailability =
  | "unknown"
  | "up_to_date"
  | "update_available"
  | "downloaded"
  | "error";

export type ShellUpdateStatus =
  | "idle"
  | "checking"
  | "downloading"
  | "ready_to_restart"
  | "installing"
  | "failed";

export interface ShellUpdateState {
  supported: boolean;
  currentVersion: string;
  latestVersion: string | null;
  availability: ShellUpdateAvailability;
  status: ShellUpdateStatus;
  lastCheckedAt: number | null;
  errorSummary: string | null;
  releaseNotes: string | null;
}
```

Behavior rules:

- dev mode or unpackaged app: `supported = false`
- Linux in phase 1: `supported = false`
- packaged Windows/macOS app: `supported = true`
- no silent install during active user work in phase 1
- after download completes, UI shows "Restart to update"

## IPC Surface

Extend preload API in `packages/desktop/src/preload.ts`.

Current API:

- `retryStartup()`
- `quit()`

New API:

```ts
{
  retryStartup(): void;
  quit(): void;
  shellUpdate: {
    getState(): Promise<ShellUpdateState>;
    check(): Promise<ShellUpdateState>;
    install(): Promise<ShellUpdateState>;
    restartToApply(): Promise<void>;
    subscribe(listener: (state: ShellUpdateState) => void): () => void;
  };
}
```

Main process registers IPC handlers in `packages/desktop/src/main.ts`.

Renderer can feature-detect the API with `window.coderStudioDesktop?.shellUpdate`.

## Renderer / Web UI Design

Keep runtime update UI and shell update UI visibly separate.

Recommended Settings > About structure:

- Product info
  - App version
  - Runtime version
- Runtime update
  - existing server-backed controls
- Desktop app update
  - current shell version
  - latest shell version
  - last checked
  - status
  - `Check for app update`
  - `Download update` or `Restart to update`

Visibility rules:

- only show desktop shell update section when preload desktop API exists
- do not show it in plain browser or CLI mode

This avoids inventing a server flag solely to say "you are inside Electron." The Electron preload bridge is already the authoritative source for that capability.

## Error Handling

### Runtime bootstrap / runtime crash

Keep existing Electron-hosted fallback error page unchanged. That page is still the safety net when the runtime cannot start or dies unexpectedly.

### Shell update errors

Shell updater failures are non-fatal:

- update check failure should remain inside the About page state
- download failure should leave the app usable
- errors should surface as inline notices/toasts, not the full fallback HTML page

## Release and CI Changes

Modify desktop packaging config in `packages/desktop/package.json`:

- stop hardcoding `"publish": "never"`
- configure GitHub publish target for packaged releases

Add release workflow support for desktop artifacts:

- desktop shell release can be published independently from runtime release
- runtime versioning remains aligned to CLI/runtime package version
- shell version remains the Electron app version

Recommended cadence:

- shell releases: less frequent, for Electron/native dependencies/security/fallback UX changes
- runtime releases: more frequent, for server/provider/workspace features

## Implementation Landing Points

### Desktop

- `packages/desktop/package.json`
  - add updater dependency and publish config
- `packages/desktop/src/main.ts`
  - instantiate shell updater and register IPC handlers
- `packages/desktop/src/preload.ts`
  - expose shell update API
- `packages/desktop/src/shell-update-service.ts`
  - new service
- `packages/desktop/src/shell-update-service.test.ts`
  - unit tests for state transitions

### Web

- `packages/web/src/features/settings/components/about-settings.tsx`
  - add desktop app update section
- `packages/web/src/features/settings/components/about-settings.test.tsx`
  - renderer behavior coverage
- `packages/web/src/features/desktop-shell/`
  - optional small adapter/atom layer for preload-backed state

### Shared types

- `packages/web/src/global.d.ts` or existing desktop preload typing location
  - add `window.coderStudioDesktop.shellUpdate` types

## Phase Breakdown

### Phase 1: Main-process shell updater foundation

- wire updater dependency
- expose preload IPC
- support manual check/download/restart
- show state in Settings > About

### Phase 2: Auto-check and UX polish

- periodic background checks
- better toasts
- "update downloaded" badge in settings/topbar if desired

### Phase 3: Release automation

- GitHub Actions workflow for desktop shell publish
- signing/notarization integration
- compatibility guardrails

## Risks

- Windows/macOS code signing and notarization are prerequisites for a production-grade updater
- desktop shell auto-update behavior differs by platform and packaging format
- introducing a custom GitHub asset flow instead of `electron-updater` would materially increase risk
- if shell and runtime are updated simultaneously, UI must clearly identify which component changed

## Decision Summary

- Keep the current runtime updater as-is
- Add a separate Electron main-process shell updater
- Use GitHub Releases as the shell release source
- Prefer `electron-updater` for transport and installer coordination
- Surface shell update state only when running inside the packaged desktop app
- Keep fallback error-page ownership in Electron for runtime startup/runtime crash failures

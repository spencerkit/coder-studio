# Desktop-Managed Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the desktop app's CLI-backed sidecar runtime with a desktop-managed runtime lifecycle that supports first-launch bootstrap, versioned runtime bundles, GitHub Release-backed runtime updates, and Electron fallback error handling.

**Architecture:** Keep Electron as a thin shell and keep the runtime as a separate child process. Move desktop startup off the CLI entry path, introduce a runtime store and activation pointer under the desktop user-data directory, add a provider abstraction with a first GitHub Release implementation, and extend the server/web update surfaces to support `desktop_managed` runtime updates alongside the existing CLI `global_npm` model.

**Tech Stack:** Electron, Node.js child processes, TypeScript, Vitest, esbuild, Fastify server runtime, GitHub Release-backed HTTP downloads

---

## File Map

### Existing files to modify

- `packages/desktop/src/main.ts`
  - Wire bootstrap/runtime install flow into desktop app startup.
- `packages/desktop/src/app-controller.ts`
  - Separate bootstrap failure handling from runtime exit handling and support retrying both flows.
- `packages/desktop/src/sidecar-manager.ts`
  - Launch from an activated runtime bundle rather than the packaged CLI runtime path.
- `packages/desktop/src/runtime-paths.ts`
  - Replace packaged CLI runtime path resolution with runtime-store path resolution and bootstrap helper paths.
- `packages/desktop/src/error-page.ts`
  - Expand the fallback page model to cover bootstrap/runtime failure variants and richer diagnostics.
- `packages/desktop/src/sidecar-manager.test.ts`
  - Update for runtime-store launch semantics.
- `packages/server/src/update/update-service.ts`
  - Extend update capability handling to support `desktop_managed`.
- `packages/server/src/update/update-service.test.ts`
  - Add coverage for desktop-managed update state behavior.
- `packages/server/src/config.ts`
  - Expand update config parsing/types to support desktop-managed install kind.
- `packages/server/src/commands/updates.test.ts`
  - Adjust command expectations if the update response shape grows.
- `packages/core/src/domain/update.ts`
  - Extend update types for `desktop_managed`, app/runtime version display, and desktop-managed update states if needed.
- `packages/web/src/features/settings/components/about-settings.tsx`
  - Show app/runtime versions distinctly and adapt UI to desktop-managed support text.
- `packages/web/src/features/settings/components/settings-page.test.tsx`
  - Cover the About screen changes.
- `packages/web/src/app/providers.tsx`
  - Continue hydrating update state, plus any new app/runtime version fields if required.
- `scripts/build-desktop.ts`
  - Stop staging the CLI deploy bundle as the desktop runtime artifact and instead build/stage desktop runtime bundles and bootstrap assets.
- `scripts/build-desktop.test.ts`
  - Update packaging expectations.

### Existing files likely to delete or stop using from the desktop path

- `packages/cli/src/desktop-server.ts`
  - Remove from the desktop startup path once the desktop-specific runtime entry exists.
- `packages/cli/src/desktop-server.test.ts`
  - Remove or keep only if the file remains for CLI compatibility.
- `packages/cli/src/server-runner.ts`
  - No longer used by desktop startup.
- `packages/cli/src/server-runner.test.ts`
  - Desktop-specific assertions should move out.

### New files to create

- `packages/desktop/src/runtime-store.ts`
  - Read/write `current.json`, manage installed runtime versions, stage and activate runtime bundles atomically.
- `packages/desktop/src/runtime-store.test.ts`
  - Coverage for activation, rollback metadata, and retention behavior.
- `packages/desktop/src/runtime-release-provider.ts`
  - Provider interfaces and shared release metadata types.
- `packages/desktop/src/runtime-release-provider.test.ts`
  - Contract-level tests for compatibility filtering and metadata parsing.
- `packages/desktop/src/runtime-release-github.ts`
  - GitHub Release-backed provider implementation.
- `packages/desktop/src/runtime-release-github.test.ts`
  - GitHub-specific parsing and compatibility resolution tests.
- `packages/desktop/src/runtime-installer.ts`
  - Download, checksum validation, unpack, manifest validation, and activation orchestration.
- `packages/desktop/src/runtime-installer.test.ts`
  - Install success/failure coverage.
- `packages/desktop/src/runtime-bootstrap.ts`
  - First-launch bootstrap flow and recovery helpers.
- `packages/desktop/src/runtime-bootstrap.test.ts`
  - No-runtime startup and retry tests.
- `packages/desktop/src/runtime-launch-entry.ts`
  - Desktop-owned runtime server entrypoint that imports `@coder-studio/server` directly.
- `packages/desktop/src/runtime-launch-entry.test.ts`
  - Runtime config wiring test for the desktop entry.
- `packages/desktop/src/runtime-manifest.ts`
  - Runtime bundle manifest types and validation.
- `packages/desktop/src/runtime-manifest.test.ts`
  - Manifest validation tests.
- `packages/desktop/src/desktop-update-bridge.ts`
  - Bridge between desktop runtime installer operations and server-exposed update state.
- `packages/desktop/src/desktop-update-bridge.test.ts`
  - Bridge behavior coverage.
- `packages/server/src/update/desktop-update-adapter.ts`
  - Server-side adapter interface for desktop-managed update execution.
- `packages/server/src/update/desktop-update-adapter.test.ts`
  - Unit tests for server/desktop update orchestration boundaries.
- `scripts/build-desktop-runtime.ts`
  - Produce the versioned desktop runtime bundle artifact for distribution.
- `scripts/build-desktop-runtime.test.ts`
  - Runtime bundle build coverage.

## Task 1: Define shared desktop-managed update and version contracts

**Files:**
- Modify: `packages/core/src/domain/update.ts`
- Modify: `packages/server/src/config.ts`
- Modify: `packages/server/src/update/update-service.ts`
- Test: `packages/server/src/update/update-service.test.ts`
- Test: `packages/server/src/commands/updates.test.ts`

- [ ] Add `desktop_managed` to the shared install-kind union in `packages/core/src/domain/update.ts`.
- [ ] Add fields needed to distinguish app/runtime versions in the update state shape, keeping existing CLI behavior backward-compatible where possible.
- [ ] Update `packages/server/src/config.ts` so runtime update config parsing accepts `desktop_managed` without requiring npm worker fields.
- [ ] Update `packages/server/src/update/update-service.ts` so:
  - `desktop_managed` is treated as supported
  - prepare/install state can represent a desktop-managed flow
  - the service no longer assumes `workerEntryPath` is required for every supported install kind
- [ ] Introduce or inject a desktop update execution adapter boundary instead of directly forcing the detached npm worker path.
- [ ] Extend `packages/server/src/update/update-service.test.ts` to cover:
  - supported desktop-managed update state
  - prepare-install behavior for desktop-managed runtime
  - no regression for `global_npm`
- [ ] Update `packages/server/src/commands/updates.test.ts` if the command payloads gain app/runtime version fields.
- [ ] Run:
  - `pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts src/commands/updates.test.ts`
- [ ] Commit:
  - `git add packages/core/src/domain/update.ts packages/server/src/config.ts packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/server/src/commands/updates.test.ts`
  - `git commit -m "refactor(server): add desktop managed update capability"`

## Task 2: Add a desktop-owned runtime launch entry and remove desktop startup dependence on CLI

**Files:**
- Create: `packages/desktop/src/runtime-launch-entry.ts`
- Create: `packages/desktop/src/runtime-launch-entry.test.ts`
- Modify: `packages/desktop/src/runtime-paths.ts`
- Modify: `packages/desktop/src/sidecar-manager.ts`
- Modify: `packages/desktop/src/sidecar-manager.test.ts`
- Modify: `scripts/build-desktop.ts`
- Test: `scripts/build-desktop.test.ts`

- [ ] Create `packages/desktop/src/runtime-launch-entry.ts` as the desktop-owned runtime entrypoint that imports `@coder-studio/server` directly and starts the runtime with desktop-specific config defaults.
- [ ] Ensure the new entrypoint writes runtime config explicitly and does not inherit CLI config-store/update-runtime defaults.
- [ ] Update `packages/desktop/src/runtime-paths.ts` so the packaged bootstrap points to the desktop runtime entry instead of `runtime/cli/dist/esm/desktop-server.mjs`.
- [ ] Update `packages/desktop/src/sidecar-manager.ts` to launch the new runtime entry and rename path types if they still mention CLI/desktop-server semantics.
- [ ] Update `packages/desktop/src/sidecar-manager.test.ts` to assert desktop runtime entry paths instead of CLI desktop-server paths.
- [ ] Update `scripts/build-desktop.ts` and `scripts/build-desktop.test.ts` so desktop packaging includes the desktop runtime launch entry in its bootstrap/runtime assets.
- [ ] Decide whether `packages/cli/src/desktop-server.ts` remains temporarily for compatibility or can be removed immediately; if retained, remove desktop references from new code paths.
- [ ] Run:
  - `pnpm exec vitest run packages/desktop/src/sidecar-manager.test.ts scripts/build-desktop.test.ts`
- [ ] Commit:
  - `git add packages/desktop/src/runtime-launch-entry.ts packages/desktop/src/runtime-launch-entry.test.ts packages/desktop/src/runtime-paths.ts packages/desktop/src/sidecar-manager.ts packages/desktop/src/sidecar-manager.test.ts scripts/build-desktop.ts scripts/build-desktop.test.ts`
  - `git commit -m "refactor(desktop): launch runtime without cli wrapper"`

## Task 3: Introduce the runtime store and activation pointer

**Files:**
- Create: `packages/desktop/src/runtime-manifest.ts`
- Create: `packages/desktop/src/runtime-manifest.test.ts`
- Create: `packages/desktop/src/runtime-store.ts`
- Create: `packages/desktop/src/runtime-store.test.ts`
- Modify: `packages/desktop/src/runtime-paths.ts`
- Modify: `packages/desktop/src/sidecar-manager.ts`
- Modify: `packages/desktop/src/sidecar-manager.test.ts`

- [ ] Define runtime bundle manifest types and validation in `packages/desktop/src/runtime-manifest.ts`.
- [ ] Create `packages/desktop/src/runtime-store.ts` to manage:
  - `runtime-store/current.json`
  - `runtime-store/versions/<version>/`
  - `runtime-store/downloads/`
  - `runtime-store/staging/`
- [ ] Implement atomic activation semantics:
  - validate staging bundle
  - move fully installed version into `versions/<version>/`
  - write `current.json` only after the version is ready
- [ ] Include rollback metadata in `current.json`, at least `previousVersion`.
- [ ] Update `packages/desktop/src/runtime-paths.ts` and `packages/desktop/src/sidecar-manager.ts` so launch resolves from the active runtime pointer rather than a fixed packaged runtime location.
- [ ] Add unit tests for:
  - reading an active runtime pointer
  - activating a version
  - rejecting invalid bundle manifests
  - preserving previous-version rollback metadata
- [ ] Run:
  - `pnpm exec vitest run packages/desktop/src/runtime-manifest.test.ts packages/desktop/src/runtime-store.test.ts packages/desktop/src/sidecar-manager.test.ts`
- [ ] Commit:
  - `git add packages/desktop/src/runtime-manifest.ts packages/desktop/src/runtime-manifest.test.ts packages/desktop/src/runtime-store.ts packages/desktop/src/runtime-store.test.ts packages/desktop/src/runtime-paths.ts packages/desktop/src/sidecar-manager.ts packages/desktop/src/sidecar-manager.test.ts`
  - `git commit -m "feat(desktop): add runtime store activation model"`

## Task 4: Add release-provider abstraction with a GitHub Release implementation

**Files:**
- Create: `packages/desktop/src/runtime-release-provider.ts`
- Create: `packages/desktop/src/runtime-release-provider.test.ts`
- Create: `packages/desktop/src/runtime-release-github.ts`
- Create: `packages/desktop/src/runtime-release-github.test.ts`

- [ ] Define `RuntimeReleaseProvider` interfaces for:
  - latest compatible runtime resolution
  - specific-version resolution
  - artifact metadata
  - download access
- [ ] Implement GitHub Release-backed runtime resolution in `packages/desktop/src/runtime-release-github.ts`.
- [ ] Enforce compatibility filtering by:
  - app version
  - platform
  - architecture
- [ ] Parse machine-readable release metadata rather than scraping human release notes.
- [ ] Add tests for:
  - latest compatible release resolution
  - incompatible releases being skipped
  - malformed metadata failures
  - platform/arch filtering
- [ ] Run:
  - `pnpm exec vitest run packages/desktop/src/runtime-release-provider.test.ts packages/desktop/src/runtime-release-github.test.ts`
- [ ] Commit:
  - `git add packages/desktop/src/runtime-release-provider.ts packages/desktop/src/runtime-release-provider.test.ts packages/desktop/src/runtime-release-github.ts packages/desktop/src/runtime-release-github.test.ts`
  - `git commit -m "feat(desktop): add github runtime release provider"`

## Task 5: Implement runtime download, validation, bootstrap, and rollback

**Files:**
- Create: `packages/desktop/src/runtime-installer.ts`
- Create: `packages/desktop/src/runtime-installer.test.ts`
- Create: `packages/desktop/src/runtime-bootstrap.ts`
- Create: `packages/desktop/src/runtime-bootstrap.test.ts`
- Modify: `packages/desktop/src/main.ts`
- Modify: `packages/desktop/src/app-controller.ts`
- Modify: `packages/desktop/src/error-page.ts`

- [ ] Create `packages/desktop/src/runtime-installer.ts` to:
  - download release artifacts
  - checksum-validate them
  - unpack them into staging
  - validate the runtime manifest
  - activate the installed runtime through the runtime store
- [ ] Create `packages/desktop/src/runtime-bootstrap.ts` to:
  - detect first-launch no-runtime state
  - resolve the latest compatible runtime
  - install it before runtime launch
  - retry cleanly when the user requests another attempt
- [ ] Update `packages/desktop/src/main.ts` so startup becomes:
  - resolve launch config
  - bootstrap runtime if missing
  - start runtime from the active pointer
- [ ] Update `packages/desktop/src/app-controller.ts` so bootstrap/install failures and runtime launch failures both route through the fallback error page with specific titles/details.
- [ ] Expand `packages/desktop/src/error-page.ts` to support richer diagnostic variants:
  - bootstrap download failure
  - invalid runtime bundle
  - runtime startup failure
  - runtime exited unexpectedly
- [ ] Add tests for:
  - first launch with no runtime installed
  - bootstrap download failure
  - checksum mismatch failure
  - failed runtime launch triggering rollback metadata use
- [ ] Run:
  - `pnpm exec vitest run packages/desktop/src/runtime-installer.test.ts packages/desktop/src/runtime-bootstrap.test.ts packages/desktop/src/sidecar-manager.test.ts`
- [ ] Commit:
  - `git add packages/desktop/src/runtime-installer.ts packages/desktop/src/runtime-installer.test.ts packages/desktop/src/runtime-bootstrap.ts packages/desktop/src/runtime-bootstrap.test.ts packages/desktop/src/main.ts packages/desktop/src/app-controller.ts packages/desktop/src/error-page.ts`
  - `git commit -m "feat(desktop): bootstrap runtime on first launch"`

## Task 6: Bridge desktop-managed install execution into the server update flow

**Files:**
- Create: `packages/server/src/update/desktop-update-adapter.ts`
- Create: `packages/server/src/update/desktop-update-adapter.test.ts`
- Modify: `packages/server/src/update/update-service.ts`
- Modify: `packages/server/src/update/update-service.test.ts`
- Modify: `packages/desktop/src/desktop-update-bridge.ts`
- Create: `packages/desktop/src/desktop-update-bridge.test.ts`

- [ ] Introduce a server-side desktop update adapter interface so `UpdateService` can request a desktop-managed install without knowing desktop implementation details.
- [ ] Implement a desktop-side bridge that can:
  - receive install requests
  - run the runtime installer
  - update update state through the runtime/server boundary or a local bridge
  - request runtime restart after activation
- [ ] Update `UpdateService` so:
  - `desktop_managed` install requests do not go down the npm worker path
  - install/restart/success/failure state transitions work for desktop-managed installs
- [ ] Add tests for:
  - desktop-managed install request dispatch
  - failure propagation into update state
  - no regression for `global_npm`
- [ ] Run:
  - `pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts src/update/desktop-update-adapter.test.ts`
  - `pnpm exec vitest run packages/desktop/src/desktop-update-bridge.test.ts`
- [ ] Commit:
  - `git add packages/server/src/update/desktop-update-adapter.ts packages/server/src/update/desktop-update-adapter.test.ts packages/server/src/update/update-service.ts packages/server/src/update/update-service.test.ts packages/desktop/src/desktop-update-bridge.ts packages/desktop/src/desktop-update-bridge.test.ts`
  - `git commit -m "feat(desktop): bridge runtime installs into update service"`

## Task 7: Update the About UI to show app/runtime version split and desktop-managed semantics

**Files:**
- Modify: `packages/web/src/features/settings/components/about-settings.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] Update the About view to show:
  - app version
  - runtime version
  - desktop-managed update support messaging
- [ ] Preserve existing CLI update UX for `global_npm` while showing desktop-specific wording for `desktop_managed`.
- [ ] Ensure update prepare/install actions still respect active-work confirmation.
- [ ] Update provider hydration if additional version fields need to be stored in web state.
- [ ] Add locale strings for:
  - app version vs runtime version labels
  - desktop-managed update support text
  - bootstrap/runtime update specific messaging if surfaced in About
- [ ] Extend settings page tests to cover both version rows and desktop-managed support display.
- [ ] Run:
  - `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/app/providers.lifecycle.test.tsx`
- [ ] Commit:
  - `git add packages/web/src/features/settings/components/about-settings.tsx packages/web/src/features/settings/components/settings-page.test.tsx packages/web/src/app/providers.tsx packages/web/src/locales/en.json packages/web/src/locales/zh.json`
  - `git commit -m "feat(web): show desktop runtime update details"`

## Task 8: Add runtime bundle build output for desktop distribution

**Files:**
- Create: `scripts/build-desktop-runtime.ts`
- Create: `scripts/build-desktop-runtime.test.ts`
- Modify: `scripts/build-desktop.ts`
- Modify: `scripts/build-desktop.test.ts`
- Modify: `packages/desktop/package.json`

- [ ] Create `scripts/build-desktop-runtime.ts` to build a versioned desktop runtime bundle that contains:
  - desktop runtime launch entry
  - server/runtime dependencies
  - web assets
  - runtime manifest
- [ ] Update `scripts/build-desktop.ts` so desktop packaging:
  - includes bootstrap/runtime management code in the app
  - does not rely on CLI deploy as the long-term runtime artifact
  - can optionally stage a local dev/runtime seed if needed for test/dev flows
- [ ] Update `packages/desktop/package.json` build metadata if the packaged file list or extra resources need to change.
- [ ] Add tests for:
  - runtime bundle build layout
  - expected manifest presence
  - no regression in installer packaging invocation
- [ ] Run:
  - `pnpm exec vitest run scripts/build-desktop-runtime.test.ts scripts/build-desktop.test.ts`
- [ ] Commit:
  - `git add scripts/build-desktop-runtime.ts scripts/build-desktop-runtime.test.ts scripts/build-desktop.ts scripts/build-desktop.test.ts packages/desktop/package.json`
  - `git commit -m "build(desktop): produce desktop runtime bundles"`

## Task 9: Verify end-to-end desktop-managed runtime startup and update flows

**Files:**
- Modify as needed based on verification findings from previous tasks.

- [ ] Run focused desktop/server/web verification after all tasks:
  - `pnpm --filter @coder-studio/server exec vitest run src/update/update-service.test.ts src/commands/updates.test.ts`
  - `pnpm --filter @coder-studio/web exec vitest run src/features/settings/components/settings-page.test.tsx src/app/providers.lifecycle.test.tsx`
  - `pnpm exec vitest run packages/desktop/src/sidecar-manager.test.ts packages/desktop/src/runtime-store.test.ts packages/desktop/src/runtime-release-github.test.ts packages/desktop/src/runtime-installer.test.ts packages/desktop/src/runtime-bootstrap.test.ts packages/desktop/src/desktop-update-bridge.test.ts`
  - `pnpm exec vitest run scripts/build-desktop-runtime.test.ts scripts/build-desktop.test.ts`
- [ ] Run build verification:
  - `pnpm --filter @coder-studio/server build`
  - `pnpm --filter @coder-studio/web build`
  - `pnpm exec tsx scripts/build-desktop-runtime.ts`
- [ ] If a desktop packaging smoke path is available, run it and confirm:
  - first-launch no-runtime bootstrap path
  - fallback error page on simulated download failure
  - runtime update and restart path
- [ ] Fix any verification failures before declaring the branch complete.
- [ ] Commit the final verification or fixup changes with a focused message.

## Plan Self-Review

- Spec coverage check:
  - desktop no longer routes through CLI startup: covered by Tasks 2 and 8
  - separate `appVersion` and `runtimeVersion`: covered by Tasks 1 and 7
  - first-launch runtime bootstrap with no bundled runtime dependency: covered by Task 5
  - GitHub Release provider abstraction: covered by Task 4
  - runtime store with `current.json`, activation, rollback: covered by Task 3
  - Electron fallback error page for bootstrap/runtime failure: covered by Task 5
  - desktop-managed update capability in server/web: covered by Tasks 1, 6, and 7
  - runtime bundle packaging distinct from CLI deploy: covered by Task 8
- Placeholder scan:
  - No `TODO`/`TBD` placeholders remain; all tasks point to concrete files and verification commands.
- Type consistency:
  - Uses the same `desktop_managed` install-kind name as the design.
  - Uses `appVersion` and `runtimeVersion` consistently.
  - Uses `current.json` and `runtime-store` consistently.

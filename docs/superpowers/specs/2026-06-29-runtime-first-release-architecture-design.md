# Runtime-First Release Architecture

> Status: Draft
> Date: 2026-06-29
> Scope: `packages/server`, `packages/cli`, `packages/desktop`, `packages/runtime`, `scripts`, `.github/workflows`

## Summary

Move Coder Studio to a runtime-first release model.

The product should publish one logical runtime release with multiple platform variants. The CLI and desktop shell should consume the same runtime version family, while selecting the correct artifact for the current host platform, architecture, and runtime environment. The CLI becomes a thin launcher. The desktop shell remains a separate Electron product. `packages/server` stays the core runtime implementation and is not split apart in this change.

## Goals

- Make runtime the primary update target for both CLI and desktop shell.
- Keep `packages/server` as the shared runtime core instead of splitting it into a new subsystem.
- Publish runtime as a self-contained archive, not as a single JS file and not as a client-side npm install.
- Support platform-specific runtime variants for Windows, macOS, Linux, and WSL.
- Keep shell auto-update separate from runtime update.
- Allow CLI release to become low-frequency and only cover launcher-level changes.

## Non-Goals

- Do not split `packages/server` into a new repository or a new service boundary.
- Do not require `npm install` or `pnpm install` on the user machine after downloading a runtime.
- Do not merge Electron shell update into runtime update.
- Do not add a generic plugin marketplace or package-manager-based runtime extension model.

## Current State

- `packages/server` already exposes the server core and update orchestration primitives.
- `packages/desktop` already has runtime store, runtime installer, runtime release provider, and shell update service code.
- The current desktop runtime build already treats runtime as a bundle directory with a manifest, web assets, and vendored dependencies.
- The CLI still owns launcher/runtime entry points that should eventually move into a dedicated runtime package.

## Decision

Use one logical runtime release with many platform artifacts.

The release unit is:

- one runtime version
- many variant records
- each variant targets one platform/arch combination, and optionally libc

CLI and desktop shell both resolve the same logical runtime version, but they may choose different variants:

- CLI on Windows -> Windows runtime variant
- CLI in WSL -> Linux runtime variant
- desktop shell on macOS -> macOS runtime variant
- desktop shell on Windows -> Windows runtime variant

This is preferred over a single universal archive because runtime dependencies include platform-specific native modules and platform-specific Node assets.

## Architecture

### Package Boundaries

`packages/server`

- Remains the runtime core.
- Owns server startup, ws dispatch, commands, workspace logic, and shared update state.
- Does not become a new product boundary.

`packages/runtime`

- New package.
- Owns runtime launch entrypoints, runtime manifest definition, runtime compatibility checks, and runtime bundle composition.
- Produces the artifact that both CLI and desktop shell consume.

`packages/cli`

- Becomes a launcher.
- Resolves and starts a compatible runtime.
- Keeps only launcher-specific command behavior and compatibility gating.

`packages/desktop`

- Remains the Electron shell.
- Handles shell auto-update, runtime installation, runtime activation, and runtime-side launch bridging.

### Runtime Release Model

Publish runtime releases as a JSON index plus per-platform archive assets.

Each release record should identify:

- `version`
- `platform`
- `arch`
- optional `libc`
- `artifactUrl`
- `artifactSize`
- `checksumSha256`
- `publishedAt`
- `minLauncherVersion`

The release index should be flat, with one record per variant. A logical version may appear multiple times, once per variant.

### Runtime Bundle Format

Runtime should be a self-contained archive.

Recommended bundle contents:

- `runtime-manifest.json`
- `dist/esm/runtime-launch-entry.mjs`
- `dist/esm/wsl-runtime-entry.mjs`
- `dist/esm/update-worker.mjs`
- `dist/web/*`
- `node/bin/node` or `node/bin/node.exe`
- `node_modules/*`
- `vendor/*` when needed for platform-specific assets

Archive format is platform-appropriate:

- Windows and macOS: `zip`
- Linux and WSL Linux runtime: `tar.gz`

The client must only perform download, checksum verification, unpacking, and activation.

## Dependency Strategy

Treat runtime dependencies in three groups.

### 1. Bundle Into JS

Use `esbuild` for internal code and small pure-JS dependencies that do not require runtime package-manager resolution.

### 2. Vendor Into Runtime Archive

Keep non-bundled but runtime-required dependencies in the archive, not on the client machine.

Examples:

- `node-pty`
- `pm2`
- `typescript-language-server`
- other dependencies with dynamic loading, native bindings, or path-sensitive runtime behavior

These dependencies should be prepared at build time and packaged into the runtime archive as part of the release artifact.

### 3. Platform Resources

Package platform-specific resources separately from JS bundling.

Examples:

- Node executable
- native addons
- OS-specific tools

These resources belong in the per-platform runtime variant, not in a universal JS bundle.

The runtime installer must not run `npm install` or compile native modules on the user machine.

## Launch and Compatibility

Use a shared runtime resolver for CLI and desktop shell.

Input:

- host kind
- platform
- architecture
- optional libc
- runtime channel
- runtime version preference

Output:

- an activated local runtime directory
- the resolved entry path
- the resolved web root
- the resolved Node executable

Compatibility checks should happen before launch:

- runtime manifest should advertise `version`
- runtime manifest should advertise `minLauncherVersion`
- launcher should reject incompatible runtime versions before starting the server
- launcher should surface a clear upgrade path when the runtime requires a newer launcher or shell

WSL runtime selection must use the Linux variant and the WSL-local runtime store.

## Release Pipelines

Split release responsibilities into three flows.

### Runtime Release

- Build the runtime bundle for each supported variant.
- Publish the runtime archive assets and release index.
- Support both CLI and desktop shell consumers.

### Desktop Shell Release

- Build the Electron installer.
- Publish shell update metadata and installer assets.
- Keep shell update independent from runtime release.

### CLI Release

- Publish the launcher package only when launcher behavior changes.
- Keep CLI npm release low frequency.
- Do not require CLI release for ordinary runtime-only changes.

## Testing

Add coverage for:

- runtime manifest parsing and validation
- runtime release variant selection by platform, architecture, and launcher compatibility
- runtime archive unpacking and activation
- CLI launcher resolution of local runtime stores
- desktop shell runtime installation and activation
- WSL runtime variant selection
- release pipeline validation for variant metadata and artifact naming

## Rollout

Implement in this order:

1. Introduce `packages/runtime` as the new runtime composition layer.
2. Move runtime launch entrypoints and update worker out of `packages/cli`.
3. Convert CLI startup to resolve and launch installed runtime artifacts.
4. Keep desktop shell on the same runtime release feed.
5. Split runtime release from shell release in CI and publishing.
6. Reduce CLI release frequency to launcher-only changes.

## Risks

- Platform-specific native dependencies can make runtime packaging more complex than a pure JS bundle.
- WSL and Windows may both need separate runtime installations on the same machine, which is expected and should be modeled explicitly.
- A launcher/runtime version mismatch can block startup, so compatibility messaging must be clear.


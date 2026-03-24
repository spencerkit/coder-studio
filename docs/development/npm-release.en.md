# npm Packaging and Release

## Package Layout

The repository now publishes these packages:

- `packages/cli`: source manifest and publish metadata for the primary `@spencer-kit/coder-studio` package
- `packages/cli/src`: CLI TypeScript source
- `templates/npm/platform-packages/*`: platform package templates
- `.build/cli`: compiled CLI output
- `.build/stage/npm/*`: generated publish staging directories for the main package and platform packages
- `.artifacts/`: final tarballs, manifest, and checksums

Layer responsibilities:

- source: `packages/cli`, `packages/cli/src`, `apps/web`, `apps/server`
- templates: `templates/npm/platform-packages/*`
- build outputs: `.build/web/dist`, `.build/server/target`, `.build/cli`, `.build/stage/npm/*`, `.artifacts/`

The main package source owns the CLI implementation, `.build/cli` receives compiled output, platform package templates own publish metadata, and the staging directories receive the actual publishable package contents.

## CLI Usage

Install:

```bash
npm install -g @spencer-kit/coder-studio
```

Common commands:

```bash
coder-studio start
coder-studio stop
coder-studio restart
coder-studio status
coder-studio logs -f
coder-studio open
coder-studio doctor
coder-studio config show
coder-studio config validate
coder-studio auth status
coder-studio --version
```

Useful flags:

- `--host`: defaults to `127.0.0.1`
- `--port`: defaults to `41033`
- `--foreground`: keeps the runtime in the foreground for debugging and E2E
- `--json`: machine-readable output for scripts and CI

For the detailed command reference, see `docs/development/cli.en.md`.

## Local Runtime State

The CLI persists runtime metadata in a local state directory:

- `runtime.json`
- `coder-studio.pid`
- `coder-studio.log`
- `config.json`
- `data/`

Use `CODER_STUDIO_HOME` to override the state directory for tests or isolated environments.

## Build Commands

```bash
pnpm version:check
pnpm build:web
pnpm build:server
pnpm build:cli
pnpm build:packages
pnpm pack:local
pnpm release:verify
pnpm release:verify:full
```

What they do:

- `version:check`: verifies the root package, main package, platform packages, and `Cargo.toml` all share the same version
- `build:web`: builds the frontend into `.build/web/dist`
- `build:server`: builds the Rust release binary into `.build/server/target`
- `build:cli`: compiles `packages/cli/src` into `.build/cli`
- `build:packages`: materializes `.build/stage/npm/coder-studio` and `.build/stage/npm/<platform>` by injecting compiled CLI output plus native/frontend assets
- `pack:local`: runs the release build and emits local tarballs into `.artifacts/`
- `release:verify`: runs version checks, CLI tests, Rust tests, local packaging, and smoke validation
- `release:verify:full`: adds release E2E on top of `release:verify`

## Versioning

Versioning is handled with `Changesets`.

Key commands:

```bash
pnpm changeset
pnpm changeset:version
```

A recommended local flow:

```bash
pnpm changeset
pnpm changeset:version
git add .
git commit -m "chore(release): version packages"
```

The version sync step updates:

- `packages/cli/package.json`
- `templates/npm/platform-packages/*/package.json`
- `apps/server/Cargo.toml`
- the root `package.json`

`changeset:version` now runs `pnpm version:check` after syncing so version drift fails immediately.

## Local Pre-Release Validation

Minimum validation:

```bash
pnpm release:verify
```

Full validation:

```bash
pnpm release:verify:full
```

Local artifacts:

```bash
pnpm pack:local
ls .artifacts
```

`.artifacts/` now includes:

- the main package tarball
- the current platform tarball
- `release-manifest.json`
- `SHA256SUMS.txt`

`.build/stage/npm/` holds:

- `coder-studio`: the generated publishable main package
- `<platform>`: the generated publishable runtime package for the current platform

## GitHub Actions

The automation is split into three workflows:

- `ci.yml`
  - adds a `version-consistency` gate
  - runs cross-platform CLI unit tests
  - runs Rust fmt/clippy/check/test on Linux
  - runs `pnpm pack:local`
  - runs smoke and release E2E
  - uploads Linux release artifacts
- `changesets.yml`
  - runs only on `main`
  - creates or updates the version PR
  - now has explicit `contents` / `pull-requests` write permissions
- `release.yml`
  - starts with a `preflight` job that validates the tag and runs `pnpm version:check`
  - publishes the 4 platform runtime packages from `.build/stage/npm/*`
  - publishes the main `@spencer-kit/coder-studio` package from `.build/stage/npm/coder-studio`
  - aggregates tarballs and attaches `release-manifest.json` plus `SHA256SUMS.txt` to the GitHub Release

## Release Trigger

After the version PR is merged, push a tag that matches the package version:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow then:

1. checks that the tag matches `packages/cli/package.json`
2. generates staging packages from templates and publishes platform packages
3. publishes the main package
4. creates the GitHub Release assets

## GitHub / npm Requirements

The current release workflow expects:

- the default GitHub `GITHUB_TOKEN`
- a repository secret named `NPM_TOKEN`

`NPM_TOKEN` must be allowed to publish the `@spencer-kit/*` packages on npm.

## Local Test Matrix

```bash
pnpm test:cli
pnpm test:smoke
pnpm test:e2e
pnpm test:e2e:release
pnpm test:smoke:windows:transport
```

If the Windows machine does not have a usable WSL instance yet, you can temporarily run `pnpm test:smoke:windows:transport -- --skip-wsl-preflight`; to pin a distro, use `-- --wsl-distro Ubuntu`.

The default GitHub-hosted Windows smoke in CI skips that WSL preflight. If you already have a self-hosted Windows runner with WSL enabled, you can manually trigger the `Windows WSL Smoke` workflow. It expects runner labels `self-hosted`, `windows`, `x64`, and `wsl`, runs the full WSL preflight, and accepts an optional `wsl_distro` workflow input when you want to pin a distro.

Coverage:

- `test:cli`: configuration, platform resolution, and state handling
- `test:cli` now also covers release version consistency and release manifest generation
- `test:smoke`: installs local tarballs and runs `start/status/restart/stop`
- `test:e2e`: development-mode frontend/backend integration
- `test:e2e:release`: browser E2E against the built release runtime
- `test:smoke:windows:transport`: real-machine Windows smoke; runs a WSL `wslpath -w` preflight by default, then validates the transport Rust / web / E2E path

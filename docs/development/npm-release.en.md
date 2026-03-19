# npm Packaging and Release

## Package Layout

The repository now publishes these packages:

- `@spencer-kit/coder-studio`: the primary CLI package
- `@spencer-kit/coder-studio-linux-x64`: Linux x64 runtime bundle
- `@spencer-kit/coder-studio-darwin-arm64`: macOS Apple Silicon runtime bundle
- `@spencer-kit/coder-studio-darwin-x64`: macOS Intel runtime bundle
- `@spencer-kit/coder-studio-win32-x64`: Windows x64 runtime bundle

The main package owns the CLI. Platform packages carry the native runtime binary and built frontend assets.

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
coder-studio --version
```

Useful flags:

- `--host`: defaults to `127.0.0.1`
- `--port`: defaults to `41033`
- `--foreground`: keeps the runtime in the foreground for debugging and E2E
- `--json`: machine-readable output for scripts and CI

## Local Runtime State

The CLI persists runtime metadata in a local state directory:

- `runtime.json`
- `coder-studio.pid`
- `coder-studio.log`
- `data/`

Use `CODER_STUDIO_HOME` to override the state directory for tests or isolated environments.

## Build Commands

```bash
pnpm build:web
pnpm build:runtime
pnpm build:packages
pnpm pack:local
```

What they do:

- `build:web`: builds the frontend into `dist/`
- `build:runtime`: builds the Rust/Tauri release binary
- `build:packages`: assembles the current platform runtime package
- `pack:local`: emits local tarballs into `.artifacts/`

## Versioning

Versioning is handled with `Changesets`.

Key commands:

```bash
pnpm changeset
pnpm changeset:version
```

The version sync step updates:

- `packages/*/package.json`
- `src-tauri/Cargo.toml`
- `src-tauri/tauri.conf.json`
- the root `package.json`

## GitHub Actions

The automation is split into three workflows:

- `ci.yml`: PR/main validation for CLI tests, Rust verification, builds, smoke tests, and release E2E
- `changesets.yml`: creates version PRs from pending changesets on `main`
- `release.yml`: publishes platform packages, publishes the main package, and creates a GitHub Release from `v*` tags

## Local Test Matrix

```bash
pnpm test:cli
pnpm test:smoke
pnpm test:e2e
pnpm test:e2e:release
```

Coverage:

- `test:cli`: configuration, platform resolution, and state handling
- `test:smoke`: installs local tarballs and runs `start/status/restart/stop`
- `test:e2e`: development-mode frontend/backend integration
- `test:e2e:release`: browser E2E against the built release runtime

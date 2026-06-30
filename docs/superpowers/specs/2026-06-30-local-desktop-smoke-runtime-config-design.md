# Local Desktop Smoke Runtime Config Design

**Goal:** Add a local desktop smoke-test flow that runs without downloading a managed runtime, and allow the desktop runtime release index URL to come from persisted config.

## Scope

- Add a repository script that builds the desktop shell, prepares an isolated desktop `userData` directory, seeds `runtime-store/current.json`, and launches Electron against local assets.
- Add a persisted CLI/desktop config field for `desktopRuntimeReleaseIndexUrl`.
- Allow desktop startup to resolve the runtime release index URL from `env -> config -> default`.
- Allow the desktop app to override Electron `userData` through a dedicated environment variable for local smoke testing.

## Non-Goals

- Do not change the default production startup semantics.
- Do not make packaged desktop startup automatically fall back to `seed` when managed runtime bootstrap fails.
- Do not add a new CLI flag for the runtime release index URL in this change.

## Design

### Persisted config

`~/.coder-studio/config.json` gains an optional `desktopRuntimeReleaseIndexUrl` string. The CLI config store reads and writes this field. The desktop launch config reads the same persisted file and exposes the field to startup code.

### Runtime release index selection

Desktop startup resolves the runtime release index URL in this order:

1. `CODER_STUDIO_DESKTOP_RUNTIME_RELEASE_INDEX_URL`
2. persisted `desktopRuntimeReleaseIndexUrl`
3. built-in GitHub release index URL

This keeps CI and ad hoc environment overrides working while allowing stable local testing through config.

### Isolated desktop userData

The Electron main process accepts `CODER_STUDIO_DESKTOP_USER_DATA_DIR`. When present, it calls `app.setPath("userData", value)` before constructing desktop startup dependencies. That isolates:

- `runtime-store/current.json`
- downloaded/staged runtimes
- desktop state dir fallback
- `runtime/runtime.json`

### Local smoke-test script

A new root script builds the desktop artifacts, copies the packaged `seed` runtime into an isolated `runtime-store/versions/<version>` directory, writes `current.json`, and launches Electron with the isolated `userData`.

This validates the local desktop package behavior without network bootstrap and without touching the developer's real desktop data directory.

## Testing

- Config-store tests cover reading/writing `desktopRuntimeReleaseIndexUrl`.
- Desktop config tests cover reading the new persisted field.
- Desktop startup tests cover runtime release index priority resolution.
- Desktop user-data tests cover `CODER_STUDIO_DESKTOP_USER_DATA_DIR`.
- Smoke-script tests cover seeded runtime-store creation and Electron launch env.

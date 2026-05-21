# Managed LSP Tools Design

> Status: Draft
> Date: 2026-05-18
> Scope: `packages/server/src/lsp/*`, new `packages/server/src/lsp-tools/*`, new LSP command surface, `packages/web/src/features/code-editor/*`, `packages/core/src/domain/lsp.ts`, workspace editor notices, package dependencies for bundled TypeScript LSP

## Goal

Make editor language features reliable and self-healing by moving from blind `spawn()` of system-installed language servers to a managed LSP tool model.

The product should:

- bundle TypeScript LSP so TypeScript and JavaScript work out of the box
- detect missing Python, Go, and Rust language servers before session startup fails
- keep the editor usable when a language server is missing
- guide the user through installation with one clear action
- install supported language servers from the server into a Coder Studio managed tools directory
- automatically retry the LSP session once installation succeeds

## Problem

The current LSP implementation maps file extensions to default commands such as `typescript-language-server`, `pylsp`, `gopls`, and `rust-analyzer`, then spawns them directly from the server.

That design has two practical failures:

- it depends on ambient system state and `PATH`
- missing commands surface as raw process errors such as `spawn ... ENOENT`

This creates a poor experience:

- TypeScript can fail even when the app itself is otherwise healthy
- Python, Go, and Rust fail in different ways depending on the host machine
- the editor cannot explain what is missing or how to recover
- the current front end cannot distinguish unsupported language, missing tool, install in progress, and startup failure

## Decision

Adopt a managed LSP tool model with four core rules:

1. TypeScript LSP is bundled as an application dependency.
2. Python, Go, and Rust LSP tools are managed by Coder Studio in an app-owned directory.
3. LSP startup resolves tool availability before process spawn and returns structured status instead of raw system errors.
4. The editor treats missing tools as a recoverable degraded state, not as a fatal editor error.

## Product Principles

### Keep Editing Non-Blocking

Missing language tools must not break normal file viewing or text editing. The user can continue editing without hover, go-to-definition, references, symbols, or diagnostics.

### Own the Toolchain

Where possible, Coder Studio should use its own managed tools instead of depending on global machine state.

### Prefer Clear Recovery Over Raw Errors

The product should never expose `spawn ENOENT` or similar low-level failures as the main user-facing message.

### Make Auto-Install Predictable

If the app offers install, it must install to a known location, report progress, and either succeed deterministically or fail with a clear reason.

## Supported Languages for v1

The first managed release covers:

- TypeScript
- JavaScript
- Python
- Go
- Rust

TypeScript and JavaScript share the same bundled TypeScript language server.

## Tool Ownership Model

### Bundled Tool

TypeScript uses bundled dependencies shipped with the app workspace:

- `typescript`
- `typescript-language-server`

The server should resolve the executable from the app installation rather than relying on a global binary.

### Managed Tools

Python, Go, and Rust are installed on demand into a Coder Studio managed tools directory. They are not installed globally.

Managed install root:

- Linux/macOS: `~/.local/share/coder-studio/lsp-tools/`

Each tool is stored under:

- `~/.local/share/coder-studio/lsp-tools/<tool>/<version>/`

Each installed tool version includes a manifest:

- `manifest.json`

The manifest records:

- tool id
- language/server kind
- installed version
- executable path
- install timestamp
- install source
- platform metadata

The server trusts manifest paths instead of scanning arbitrary directories after install.

## Resolution Order

Language server resolution follows this order:

1. environment override
2. managed tool install
3. bundled tool
4. system `PATH`

This order preserves flexibility for advanced users while keeping app-owned tools the normal path.

### Environment Override

Existing override variables remain supported:

- `CODER_STUDIO_LSP_TYPESCRIPT_COMMAND`
- `CODER_STUDIO_LSP_TYPESCRIPT_ARGS_JSON`
- equivalent variables for Python, Go, and Rust

If an override is supplied, the server uses it first.

### Managed Tool

If a matching managed install exists and its manifest points to a valid executable, the server uses it.

### Bundled Tool

For TypeScript only, the server resolves the executable from local application dependencies.

### System PATH

System command lookup remains a last-resort fallback for users who already have a suitable language server installed.

## Server Architecture

Add a new server-side module family:

- `packages/server/src/lsp-tools/definitions.ts`
- `packages/server/src/lsp-tools/manager.ts`
- `packages/server/src/lsp-tools/install-manager.ts`
- `packages/server/src/lsp-tools/manifest-store.ts`
- `packages/server/src/lsp-tools/tool-root.ts`

### `LspToolDefinition`

Each supported language server gets a definition describing:

- tool id
- server kind
- display name
- bundled support
- managed install support
- supported platforms
- prerequisite checks
- install strategy
- documentation URLs

This is intentionally separate from provider definitions. Provider install and LSP tool install solve different product problems and should not share the same top-level domain model.

### `LspToolManager`

`LspToolManager` is responsible for:

- resolving the best available executable for a server kind
- returning structured availability state
- exposing user-facing missing/degraded reasons
- answering whether managed install is supported

It should return resolution results like:

- `ready`
- `tool_missing`
- `installing`
- `unsupported_language`
- `unsupported_platform`
- `failed`

### `LspToolInstallManager`

`LspToolInstallManager` manages install jobs for Python, Go, and Rust. It uses the same general shape as provider install jobs:

- `queued`
- `running`
- `succeeded`
- `failed`

But it is a dedicated manager with its own IDs, status payloads, and failure reasons.

### `LspServerSpec`

The existing `resolveLspServerSpec()` logic should stop deciding only by extension and command string.

Instead it should:

1. map the path to an `LspServerKind`
2. ask `LspToolManager` to resolve the executable
3. return either:
   - a ready spec with command and args
   - a structured missing/installing/failed result

## Session Startup Contract

`LspManager.ensureSession()` should stop throwing raw spawn failures for expected tool-availability cases.

It should return a structured session readiness payload with a shape similar to:

- `ready`
- `unsupported_language`
- `tool_missing`
- `installing`
- `start_failed`

When ready, it includes the current summary and capabilities.

When not ready, it includes:

- server kind
- display name
- machine-readable error code
- user-facing summary message
- missing prerequisite names if relevant
- whether install is supported
- optional install job snapshot if one is running

`LspSession.startConnection()` still handles true runtime failures, but spawn should only be attempted after the tool has been resolved.

## Error Codes

Standardize LSP startup and install failures on explicit codes:

- `lsp_unsupported_language`
- `lsp_tool_missing`
- `lsp_prerequisite_missing`
- `lsp_install_in_progress`
- `lsp_install_failed`
- `lsp_start_failed`

Raw process messages may be logged server-side, but the command surface should normalize them before returning to the client.

## Installation Strategies

### TypeScript

TypeScript is bundled and requires no user install flow in the normal case.

The app adds `typescript-language-server` as a workspace dependency and resolves its executable from local package binaries.

If the bundled binary cannot be found, the product should treat that as `lsp_start_failed`, because it indicates a broken app/runtime installation rather than a normal missing external tool.

### Python

Managed install strategy:

- create a versioned virtual environment in the tool directory
- install `python-lsp-server` into that environment
- record the venv executable path in the manifest

Prerequisite:

- a compatible Python interpreter available on the host

If Python itself is missing, the install flow returns `lsp_prerequisite_missing` with a clear message.

### Go

Managed install strategy:

- create a versioned tool directory with a `bin/`
- run `go install` with `GOBIN` pointed at the managed bin directory
- record the `gopls` path in the manifest

Prerequisite:

- a compatible Go toolchain available on the host

### Rust

Managed install strategy:

- download the platform-specific `rust-analyzer` release binary into the managed directory
- verify executable presence
- record it in the manifest

Rust should not rely on a global `rustup` install for the first version.

This keeps Rust aligned with the managed-tools model instead of requiring a separate ecosystem bootstrap path.

## Frontend Interaction Model

### Editor Bridge

The editor bridge continues to call `lsp.ensureSession`, but now it interprets structured non-ready states.

Behavior:

- `ready`: open document and enable providers
- `unsupported_language`: do nothing silently
- `tool_missing`: show a recoverable notice with install CTA
- `installing`: show progress state and keep editor usable
- `failed` or `start_failed`: show a non-blocking error notice and retry CTA

The bridge must not throw modal errors for these states.

### Notice Surface

The editor should display a lightweight, non-blocking notice in the code editor surface when a supported language lacks its tool.

The notice should include:

- language server display name
- short explanation
- primary `Install` action when install is supported
- `Dismiss` action
- progress or failure summary if an install job exists

The notice must not replace the editor itself.

### Automatic Retry

After a successful install:

1. the frontend re-runs `lsp.ensureSession`
2. if ready, it sends `lsp.openDocument`
3. diagnostics and language features resume without requiring the user to reopen the file

## Command Surface

Add a dedicated LSP tool command surface:

- `lsp.ensureSession`
- `lsp.install.start`
- `lsp.install.get`
- `lsp.runtimeStatus`

`lsp.ensureSession` becomes the main readiness probe for a specific file and server kind.

`lsp.runtimeStatus` can support future settings surfaces and preflight diagnostics, but the editor should still rely on contextual `ensureSession`.

## Data Model

Add shared protocol types for:

- LSP readiness response
- LSP tool runtime status
- LSP install job snapshot
- LSP install failure

These types belong in shared core protocol/domain exports so both web and server can rely on explicit states instead of string parsing.

## Logging

Server logs should retain low-level detail for operator debugging:

- resolved command source
- install strategy chosen
- prerequisite failures
- download/install command output excerpts
- spawn exit codes and stderr excerpts

Client-facing responses should remain normalized and concise.

## Testing Plan

### Server Unit Tests

Add tests for:

- resolution order: override -> managed -> bundled -> path
- missing managed tool returns `tool_missing`
- missing prerequisite returns `lsp_prerequisite_missing`
- bundled TypeScript resolution uses local dependency
- manifest loading and stale-path handling
- install job lifecycle success and failure cases

### Server Integration Tests

Add tests for:

- `lsp.ensureSession` returns structured missing-tool status instead of throwing
- `lsp.install.start` creates a job and progresses to success
- install success followed by retry produces a ready session
- failed installs preserve editor-safe degraded behavior

### Frontend Tests

Add tests for:

- missing tool notice renders for supported languages
- clicking `Install` starts the job
- polling updates notice state
- successful install automatically reopens the document
- failure keeps editing available and shows retryable feedback

### Non-Goals for Test Scope

Do not add live network download tests or real toolchain install tests in CI. Use fake installers, fake manifest stores, and injected command/download adapters.

## Rollout Notes

This design should be implemented incrementally:

1. bundle TypeScript and add structured readiness for missing tools
2. add managed install flow for Python, Go, and Rust
3. add editor notices and auto-retry wiring

This sequencing keeps the first improvement small enough to reduce immediate breakage while still aligning with the full managed-tools architecture.

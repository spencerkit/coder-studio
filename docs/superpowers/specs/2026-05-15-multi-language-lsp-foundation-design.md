# Multi-Language LSP Foundation Design

> Status: Draft
> Date: 2026-05-15
> Scope: `packages/server/src/lsp/*`, `packages/server/src/commands/lsp.ts`, websocket event plumbing, `packages/web/src/features/code-editor/lsp/*`, `packages/web/src/features/code-editor/components/monaco-host.tsx`, related tests

## Goal

Establish a server-managed, multi-language LSP foundation for the Monaco-based code editor.

The first phase should deliver a stable, language-agnostic architecture that supports read-only intelligent editor capabilities across multiple languages without degrading ordinary file editing when language services fail.

Phase 1 targets:

- `Go to Definition`
- `Find References`
- `Hover`
- `Diagnostics`
- `Document Symbols`

This phase does not include completion, rename, code actions, or formatting.

## Problem

The current branch has working Monaco-based editing, shared model reuse, and a functioning navigation landing path through:

- [`packages/web/src/features/code-editor/actions/use-open-location.ts`](../../../packages/web/src/features/code-editor/actions/use-open-location.ts)
- [`packages/web/src/features/code-editor/components/monaco-host.tsx`](../../../packages/web/src/features/code-editor/components/monaco-host.tsx)
- [`packages/web/src/features/code-editor/monaco/model-registry.ts`](../../../packages/web/src/features/code-editor/monaco/model-registry.ts)

That is enough to:

- open files
- preserve shared editor buffers
- apply navigation requests once a target file and range are already known

It is not enough to provide complete editor intelligence across languages.

Today the editor primarily relies on Monaco's built-in JavaScript and TypeScript worker behavior. That creates several product and architectural limits:

- capabilities are language-specific instead of platform-wide
- cross-file navigation quality depends on Monaco worker behavior rather than a workspace-aware language service
- non-JS/TS languages do not have a path to equivalent support
- diagnostics, references, and symbol information are not managed as a unified editor subsystem
- adding support language-by-language in the frontend would create duplicated provider logic and inconsistent UX

The missing layer is a true language-service foundation that owns:

- process lifecycle
- protocol state
- workspace-aware document synchronization
- language-agnostic request routing
- diagnostics fanout to the editor UI

## Decision

Adopt a standard LSP architecture with server-managed language server processes and a thin Monaco bridge in the web app.

The system should use:

- service-side language server lifecycle management per `workspace + server kind`
- a service-side LSP session layer that owns JSON-RPC and protocol state
- frontend-to-backend document synchronization for open editor models
- frontend Monaco providers that translate editor operations into backend LSP queries
- the existing `openLocation` navigation path as the final landing mechanism for cross-file results

This architecture is preferred over a custom backend RPC abstraction that hides LSP semantics entirely because:

- it scales better to new languages
- it keeps process and protocol ownership in one place
- it avoids building a second proprietary "editor intelligence API" alongside LSP
- it lets the frontend stay thin while preserving future extensibility

## Product Semantics

The first phase should follow one strict product rule:

`If LSP fails, the editor must always fall back to ordinary text editing.`

That means:

- syntax highlighting and file editing remain usable even when language servers are unavailable
- LSP capabilities appear incrementally when the session is healthy
- failures in intelligent features do not block typing, file loading, saving, or editor navigation outside LSP

## Scope

### In Scope For Phase 1

- service-side lifecycle management for language servers
- service-side LSP session management
- document synchronization for open editor models
- Monaco providers for:
  - definition
  - references
  - hover
  - document symbols
- diagnostics propagation from language server to Monaco markers
- workspace-aware cross-file navigation using the existing `openLocation` path
- capability detection and graceful feature disabling per session
- server restart and recovery behavior for editor-facing read-only capabilities

### Explicitly Out Of Scope For Phase 1

- completion
- signature help
- rename symbol
- code actions
- format document or format range
- semantic tokens customization beyond what already exists
- a plugin system for third-party LSP registration
- background synchronization of all workspace files from the browser
- editor-independent public APIs for external clients

## Architecture

The phase 1 architecture is split into four layers.

### Layer 1: Language Server Process Lifecycle

The backend owns language server processes.

Each process is keyed by:

- `workspaceId`
- `serverKind`

This layer is responsible for:

- spawning the process
- wiring stdio JSON-RPC transport
- restarting on crash with bounded retry policy
- idle shutdown when no related documents remain open
- exposing health and capability status upward

This layer must not know about Monaco.

### Layer 2: LSP Session And Document State

The backend owns one LSP session per `workspace + serverKind`.

This layer is responsible for:

- `initialize` and `initialized`
- tracking server capabilities
- URI and path mapping
- tracking open documents and their versions
- `didOpen`
- `didChange`
- `didClose`
- request-response routing for definition, references, hover, and symbols
- receiving `publishDiagnostics`

This layer is the protocol authority. It should understand LSP and workspace documents, but not browser UI state.

### Layer 3: Monaco Bridge

The frontend owns a thin adapter that connects Monaco editor models to the backend LSP session.

This layer is responsible for:

- ensuring the relevant session exists when an eligible editor model opens
- synchronizing document open/change/close events to the backend
- registering Monaco providers
- translating returned locations, hovers, references, and symbol data into Monaco-compatible objects
- applying diagnostics as Monaco markers

This layer should not own business UI state beyond editor integration.

### Layer 4: UI Landing And Editor State

Existing editor state remains the final landing zone for LSP-driven navigation and document rendering.

The primary existing integrations are:

- [`packages/web/src/features/code-editor/actions/use-open-location.ts`](../../../packages/web/src/features/code-editor/actions/use-open-location.ts)
- [`packages/web/src/features/code-editor/components/monaco-host.tsx`](../../../packages/web/src/features/code-editor/components/monaco-host.tsx)
- [`packages/web/src/features/code-editor/monaco/model-registry.ts`](../../../packages/web/src/features/code-editor/monaco/model-registry.ts)

The LSP foundation should reuse these instead of inventing a second navigation or model lifecycle.

## Backend Design

### Files And Responsibilities

Recommended initial backend structure:

- `packages/server/src/lsp/manager.ts`
  - owns session lookup and lifecycle per `workspaceId + serverKind`
- `packages/server/src/lsp/session.ts`
  - owns one live LSP session, request routing, capabilities, and diagnostics intake
- `packages/server/src/lsp/document-store.ts`
  - owns open-document snapshots, version counters, URI mapping, and replay state
- `packages/server/src/lsp/server-factory.ts`
  - resolves which language server executable and startup configuration to use for a language
- `packages/server/src/commands/lsp.ts`
  - exposes request entry points used by the frontend bridge

### Session Keying

Sessions should be keyed by:

- `workspaceId`
- `serverKind`

Examples:

- one TypeScript-family session for `ts/js/jsx/tsx`
- one Python session for `py`
- one Go session for `go`
- one Rust session for `rs`

The exact language-to-server mapping can evolve, but the keying rule should remain stable.

### Server Factory

The server factory should be data-driven enough to avoid hardcoding editor logic into process startup.

It should decide, from a file path or normalized language identifier:

- whether the language is supported
- which `serverKind` handles it
- which executable and args to launch
- which root URI and initialization options to send

Phase 1 does not need a user-configurable registry, but it should not bury this logic inside the session implementation.

### Document Store

The document store should maintain:

- `workspaceId`
- `serverKind`
- `path`
- LSP `uri`
- current text content
- monotonically increasing document version
- whether the document is currently open in the session

It should support:

- open document registration
- incremental or full-content version updates
- close tracking
- replay of currently open documents after session restart

### Commands

The frontend-facing backend entry points should be narrow and LSP-oriented.

Recommended first-phase commands:

- `lsp.ensureSession`
- `lsp.openDocument`
- `lsp.changeDocument`
- `lsp.closeDocument`
- `lsp.definition`
- `lsp.references`
- `lsp.hover`
- `lsp.documentSymbols`

Diagnostics should not be polled through commands. They should arrive as server-pushed events.

## Frontend Design

### Files And Responsibilities

Recommended initial frontend structure:

- `packages/web/src/features/code-editor/lsp/bridge.ts`
  - session warmup, document synchronization, and provider registration orchestration
- `packages/web/src/features/code-editor/lsp/providers.ts`
  - Monaco provider implementations for definition, references, hover, and document symbols
- `packages/web/src/features/code-editor/lsp/diagnostics.ts`
  - diagnostics subscription and Monaco marker application
- optionally `packages/web/src/features/code-editor/lsp/language-map.ts`
  - editor-language to server-kind mapping helpers

Existing files reused by design:

- [`packages/web/src/features/code-editor/components/monaco-host.tsx`](../../../packages/web/src/features/code-editor/components/monaco-host.tsx)
- [`packages/web/src/features/code-editor/actions/use-open-location.ts`](../../../packages/web/src/features/code-editor/actions/use-open-location.ts)
- [`packages/web/src/features/code-editor/monaco/model-registry.ts`](../../../packages/web/src/features/code-editor/monaco/model-registry.ts)

### Monaco Bridge Responsibility

The Monaco bridge is responsible for:

- detecting whether the current file participates in an LSP-supported language family
- ensuring the corresponding backend session exists
- sending `open/change/close` events for workspace-backed text models
- registering providers only once per supported language
- discarding stale results when model versions no longer match

It must not own process assumptions, protocol retry policy, or workspace file loading behavior.

### Navigation Integration

Cross-file navigation should continue to land through `openLocation`.

The behavior should be:

- same-file definition:
  - move the current editor selection directly when possible
- cross-file definition:
  - call `openLocation` with `path`, `line`, `column`, and optional range
  - let the existing editor state open the target file
  - let `MonacoHost` apply the pending navigation once the model is mounted

This keeps one navigation landing path across:

- file tree navigation
- search navigation
- LSP navigation

### Diagnostics Integration

Diagnostics pushed from the backend should be translated into Monaco markers per resource URI.

The frontend should also maintain enough state to clear markers when:

- a workspace resets
- a file closes
- diagnostics are superseded
- a session becomes invalid for that workspace

The diagnostics path must be isolated by:

- `workspaceId`
- `path`

That prevents stale markers from leaking across workspaces or file reopen cycles.

## Message Flow

### Open File

When a supported workspace-backed text file is opened:

1. frontend identifies the language family
2. frontend calls `lsp.ensureSession`
3. backend creates or reuses the `workspace + serverKind` session
4. frontend sends `lsp.openDocument`
5. backend document store records version `1`
6. backend sends `didOpen`

### Edit File

When the user edits a supported open document:

1. frontend updates local shared model immediately
2. frontend sends `lsp.changeDocument` using short debounce or batching
3. backend increments stored document version
4. backend sends `didChange`
5. subsequent diagnostics or query results are matched against the latest version

### Close File

When a supported document closes:

1. frontend sends `lsp.closeDocument`
2. backend records the close and sends `didClose`
3. diagnostics for that file are cleared on the frontend
4. session remains alive for reuse until idle-reaped

### Definition

When the user invokes `Go to Definition`:

1. Monaco provider collects URI and position
2. frontend calls `lsp.definition`
3. backend resolves through the appropriate session
4. backend returns one or more locations
5. frontend chooses landing behavior:
   - same resource: navigate within current editor
   - different resource: call `openLocation`

### Hover

When the user hovers:

1. Monaco provider calls `lsp.hover`
2. backend returns hover contents
3. frontend maps contents into Monaco markdown hover output
4. stale responses are dropped if model version has advanced

### References

When the user requests references:

1. Monaco provider calls `lsp.references`
2. backend returns locations
3. frontend maps results into Monaco references
4. navigation from results continues through existing editor open behavior

### Document Symbols

When the user requests symbols:

1. Monaco provider calls `lsp.documentSymbols`
2. backend returns symbol tree
3. frontend maps to Monaco symbol format

### Diagnostics

When the language server emits `publishDiagnostics`:

1. backend session receives the notification
2. backend emits a workspace-scoped websocket event to the frontend
3. frontend applies Monaco markers for the matching file
4. old markers are replaced rather than merged ad hoc

## Failure Handling And Recovery

### Language Server Startup Failure

If a language server fails to start:

- the editor must remain usable
- the corresponding LSP-powered capabilities should be disabled or return empty results
- the failure should be logged with enough context to diagnose startup issues

The UI must not treat this as a fatal editor error.

### Session Crash

If a language server crashes after initialization:

- backend retries startup with bounded backoff
- once a session is restored, backend replays currently open documents
- diagnostics for affected files should be refreshed only from fresh session output

The editor should degrade during the outage, then recover incrementally.

### Request Timeout

If definition, hover, references, or symbols requests time out:

- fail only that request
- do not poison the whole session
- keep editing responsive

Frontend behavior should be silent or minimally informative, not modal or blocking.

### Version Mismatch

If a result arrives for an outdated document version:

- frontend should discard hover, reference, and diagnostic outputs that no longer match the active version expectations
- navigation requests should avoid applying stale offsets to a newer buffer

### Unsupported Language

If a file does not map to a configured server kind:

- do not create a session
- keep ordinary Monaco editing behavior only
- do not surface LSP failure noise

### Missing Or Invalid Cross-File Target

If a definition target cannot be opened or does not map cleanly into a workspace path:

- do not crash the editor
- if possible, open the file without strict selection requirements
- otherwise fail the jump quietly

## Performance And Operational Constraints

### Session Reuse

Only one session per `workspace + serverKind` should exist at a time.

The system must not spawn:

- one process per file
- one process per editor tab
- one process per request

### Open Document Synchronization Only

Phase 1 should only synchronize documents currently opened in the editor.

The frontend should not attempt to preload all workspace files into the backend session. Broader indexing remains the language server's responsibility.

### Debounced Change Propagation

Document changes should be debounced or batched enough to avoid flooding the server on every keystroke while still keeping diagnostics and navigation reasonably fresh.

### Idle Reaping

If no documents remain open for a session for a defined interval, the backend may terminate that server process to control resource use.

### Observability

At minimum, the backend should log:

- process start
- initialize success/failure
- crash and restart count
- command/request latency
- timeout events
- unsupported language or missing server configuration cases

Without this, phase 1 will be difficult to debug under real workspace conditions.

## Testing Requirements

Testing should be added in three layers.

### Backend Tests

Add targeted tests for:

1. session creation and reuse by `workspace + serverKind`
2. document version tracking across `open/change/close`
3. replay of open documents after restart
4. request timeout isolation
5. diagnostics notification forwarding

### Frontend Tests

Add targeted tests for:

1. supported file open triggers session ensure and document open sync
2. document changes trigger debounced change sync
3. unsupported languages do not trigger LSP session work
4. same-file definition navigates correctly
5. cross-file definition uses `openLocation`
6. diagnostics update and clear Monaco markers correctly

### End-To-End Or Integration Tests

At minimum, validate:

1. cross-file definition opens the target file and lands on the right range
2. hover renders for a supported language
3. references produce navigable results
4. diagnostics clear when the file closes or workspace resets
5. server crash degrades and recovers without editor lockup

## Risks

### Risk: process management complexity grows quickly

Mitigation:

- isolate lifecycle concerns in `manager.ts`
- keep session and process responsibilities separate

### Risk: stale diagnostics or navigation state leaks across workspaces

Mitigation:

- key diagnostics and sessions by `workspaceId`
- clear markers on reset, close, and teardown

### Risk: frontend bridge duplicates editor state logic

Mitigation:

- reuse existing `openLocation` and shared Monaco model registry
- keep bridge limited to synchronization and provider glue

### Risk: phase 1 scope expands into completion and write-capable refactors

Mitigation:

- explicitly defer completion, rename, code actions, and formatting
- design APIs that can support them later without implementing them now

## Non-Goals

Phase 1 does not:

- make every supported language feature-complete
- replace Monaco's built-in behavior for unsupported languages
- implement completion, rename, formatting, or code actions
- introduce a public plugin API for arbitrary user-defined language servers
- redesign the code editor UI chrome
- solve all workspace indexing and file watching concerns up front

## Verification

After implementation, verify all of the following:

1. opening supported files establishes or reuses the correct session
2. same-file and cross-file definition both work
3. hover returns symbol information without blocking editing
4. references return and navigate correctly
5. document symbols return structured results
6. diagnostics appear and clear correctly across file close and workspace reset
7. unsupported languages remain editable without LSP noise
8. server startup failure or crash does not break ordinary editing
9. repeated opens of the same language in the same workspace do not spawn duplicate processes

## Implementation Order

The recommended implementation sequence is:

1. backend lifecycle and session layer with `initialize + didOpen/didChange/didClose`
2. frontend bridge for document synchronization
3. definition provider integration using the existing `openLocation` landing path
4. hover, references, and document symbols
5. diagnostics push and marker management
6. restart, timeout, and cleanup hardening
7. backend, frontend, and integration test coverage

This order prioritizes:

- lowest-risk architectural foundation first
- the most visible cross-file editor payoff early
- diagnostics and recovery after the basic query path is proven

## Implementation Boundary

Expected files and areas to change during implementation:

- `packages/server/src/lsp/*`
- `packages/server/src/commands/lsp.ts`
- server websocket event plumbing for diagnostics and server status
- `packages/web/src/features/code-editor/lsp/*`
- `packages/web/src/features/code-editor/components/monaco-host.tsx`
- related code editor, provider lifecycle, and integration tests

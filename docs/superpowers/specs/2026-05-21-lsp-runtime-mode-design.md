# LSP Runtime Mode Design

> Status: Draft
> Date: 2026-05-21
> Scope: `packages/core/src/domain/lsp.ts`, `packages/server/src/lsp/*`, `packages/server/src/commands/{lsp,settings}.ts`, `packages/server/src/server.ts`, `packages/web/src/features/code-editor/*`, `packages/web/src/features/settings/components/settings-page.tsx`

## Goal

Add a user-facing LSP runtime mode setting so users can explicitly turn off LSP and reclaim memory immediately.

The product should:

- preserve the current lazy-start plus idle-reclaim behavior as the default `auto` mode
- let users switch LSP to `off` from Settings
- reclaim LSP memory immediately when switching to `off`
- keep plain editing usable when LSP is disabled
- restore normal on-demand LSP behavior when switching back to `auto`

## Problem

The current LSP lifecycle is service-managed and already avoids eager startup:

- sessions are created only when the editor requests `lsp.ensureSession`
- sessions are reused per `workspace + server kind`
- idle sessions are disposed after `60_000` ms
- workspace teardown disposes all related LSP sessions

This is close to an implicit auto mode, but it is not a user-controlled product feature.

The current design has three gaps:

1. users cannot explicitly disable LSP when they want to reduce memory usage
2. current idle reclaim waits for inactivity instead of reclaiming memory immediately on demand
3. the frontend has no explicit disabled state and cannot distinguish "user turned this off" from unsupported language or missing tools

## Decision

Introduce a global LSP runtime mode with two values:

- `auto`
- `off`

`auto` preserves the current behavior:

- LSP starts on demand
- idle sessions are reclaimed automatically
- supported editor intelligence features remain available

`off` is an explicit hard-disable mode:

- all active LSP sessions are disposed immediately
- all current editor LSP attachments are detached immediately
- diagnostics and LSP notices are cleared from current editor surfaces
- future `lsp.*` requests do not create or restart sessions

This is a global application-level setting, not a per-workspace or per-language setting.

## Product Behavior

### Settings Surface

Add a new control in `Settings > General`:

- title: `LSP Runtime Mode`
- description: `Control code intelligence memory usage.`
- options:
  - `Auto` — `Start on demand and reclaim when idle`
  - `Off` — `Disable LSP and reclaim memory immediately`

This control should use the existing pill-style segmented setting pattern rather than a boolean switch because the design already has a natural multi-mode direction.

### `auto` Mode

`auto` keeps the current system behavior:

- opening a supported file may trigger `lsp.ensureSession`
- session startup remains lazy
- diagnostics, hover, definition, references, declaration, type definition, and document symbols behave as they do today
- idle sessions are reclaimed by the existing TTL logic

### `off` Mode

When the user switches to `off`:

- existing LSP sessions are disposed immediately on the server
- current editor models detach from the LSP bridge immediately on the client
- pending LSP install polling and change-document timers are canceled
- diagnostics markers for attached files are cleared
- future editor activity does not reattach LSP or recreate sessions

Plain editing remains available:

- file loading
- text editing
- saving
- Monaco syntax highlighting
- non-LSP navigation already owned by the workspace UI

LSP-powered features are unavailable:

- hover
- go to definition
- go to declaration
- go to type definition
- references
- document symbols
- diagnostics

### Re-enabling `auto`

When the user switches back to `auto`:

- no LSP sessions are prewarmed
- future supported editor activity resumes the current on-demand startup path

This avoids a memory spike when the user turns LSP back on.

## State Model

### Persistent Setting

Persist the new setting through the existing settings store:

- key: `lsp.mode`
- values: `"auto" | "off"`

The default is `auto` when no stored value exists.

### Shared Domain Type

Add a domain type in `packages/core/src/domain/lsp.ts`:

- `LspRuntimeMode = "auto" | "off"`

Add an explicit disabled readiness result:

- `{ kind: "disabled"; mode: "off"; message: string }`

This prevents the frontend from misclassifying disabled LSP as unsupported language or missing tool.

### Frontend Runtime State

Add a frontend runtime atom for the hydrated mode:

- `lspRuntimeModeAtom`

This atom is driven by server-backed settings hydration and immediate settings changes, not by local-only storage.

## Backend Design

### `LspManager`

Extend `LspManager` to own the current runtime mode.

New responsibilities:

- track `runtimeMode`
- expose `setRuntimeMode(mode)`
- expose `getRuntimeMode()`
- immediately dispose all sessions when switching to `off`
- short-circuit all `lsp.*` behavior when runtime mode is `off`

Behavioral rules:

1. `ensureSession()` returns `{ kind: "disabled", mode: "off", ... }` when mode is `off`
2. `openDocument`, `changeDocument`, `definition`, `references`, `declaration`, `typeDefinition`, `hover`, and `documentSymbols` return `null` without creating sessions when mode is `off`
3. `closeDocument()` remains safe and no-op if no session exists

This makes the backend the final authority for LSP disabled state and protects against frontend race conditions.

### Runtime Mode Command

Add a new LSP runtime command:

- `lsp.setMode`

Input:

- `{ mode: "auto" | "off" }`

Behavior:

- delegates to `ctx.lspMgr.setRuntimeMode(mode)`
- returns `{ mode }`

This command applies runtime state immediately. It does not replace `settings.update`, which remains responsible for persistence.

### Startup Hydration

During server initialization, read `lsp.mode` from `settingsRepo` and apply it to `LspManager`.

This ensures a server restart preserves the user's disabled choice.

## Frontend Design

### Settings Page

Hydrate `lsp.mode` from `settings.get` and render the new General setting.

When the user changes mode:

1. persist with `settings.update({ lsp: { mode } })`
2. apply immediately with `lsp.setMode({ mode })`
3. update frontend runtime state only after both steps succeed

If runtime application fails after persistence succeeds, the UI must not present a false success state. It should either:

- roll the selection back to the last applied runtime mode
- or surface a clear error and reload server-backed settings before allowing further interaction

The simpler and safer implementation is to keep the UI selection unchanged until both requests succeed.

### Monaco Host

`MonacoHost` should subscribe to `lspRuntimeModeAtom`.

When mode is `auto`:

- preserve the current attach flow

When mode is `off`:

- do not call `globalLspBridge.attachModel()`
- if a handle is already attached, run its cleanup immediately through the effect cleanup path
- reset local LSP state so install/retry affordances are not shown

This guarantees the editor surface reflects the disabled state immediately after the setting changes.

### LSP Bridge

The current bridge detach path already does most required cleanup:

- clears change timers
- clears install poll timers
- removes tracked models
- clears diagnostics for the file
- sends `lsp.closeDocument`

The bridge must additionally handle the new disabled readiness result without:

- attempting install flow
- scheduling polls
- attempting follow-up `lsp.openDocument`

### Editor Notice

If the editor shows a notice for disabled LSP, it should be distinct from missing-tool and failed-start notices:

- title: `Language server disabled`
- message: `LSP is turned off in Settings to reduce memory usage.`

No install or retry actions should be shown in this state.

Hiding the notice entirely is also acceptable if the surrounding product already makes the disabled state obvious and there is no empty or confusing UI gap.

## Runtime Transition Flow

### `auto -> off`

1. user selects `Off` in Settings
2. frontend persists `lsp.mode=off` with `settings.update`
3. frontend calls `lsp.setMode({ mode: "off" })`
4. backend updates `LspManager.runtimeMode`
5. backend immediately calls `disposeAll()`
6. frontend runtime atom updates to `off`
7. mounted editors rerun their LSP attachment effect cleanup
8. editor diagnostics and timers are cleared locally

### `off -> auto`

1. user selects `Auto` in Settings
2. frontend persists `lsp.mode=auto`
3. frontend calls `lsp.setMode({ mode: "auto" })`
4. backend updates `LspManager.runtimeMode`
5. frontend runtime atom updates to `auto`
6. later supported editor activity reuses the existing on-demand startup path

## File-Level Impact

### Shared Types

- `packages/core/src/domain/lsp.ts`
  - add `LspRuntimeMode`
  - add disabled ensure-session result

### Backend

- `packages/server/src/commands/settings.ts`
  - accept and return `lsp.mode`
- `packages/server/src/commands/lsp.ts`
  - add `lsp.setMode`
- `packages/server/src/lsp/manager.ts`
  - track runtime mode
  - dispose sessions on `off`
  - short-circuit all LSP entry points on `off`
- `packages/server/src/server.ts`
  - hydrate stored mode into `LspManager` during startup

### Frontend

- new atom or feature state file for `lspRuntimeModeAtom`
- `packages/web/src/features/settings/components/settings-page.tsx`
  - hydrate and save `lsp.mode`
  - render General setting UI
- `packages/web/src/features/code-editor/components/monaco-host.tsx`
  - attach only in `auto`
  - detach immediately on `off`
- `packages/web/src/features/code-editor/lsp/bridge.ts`
  - handle disabled readiness cleanly
- `packages/web/src/features/code-editor/components/lsp-status-notice.tsx`
  - optionally render disabled-state messaging

## Testing Strategy

### Backend Tests

- `settings.get/settings.update` read and persist `lsp.mode`
- `LspManager.setRuntimeMode("off")` disposes active sessions immediately
- `ensureSession()` returns disabled while off
- `definition/openDocument/...` do not create sessions while off
- `lsp.setMode` command applies runtime state
- server startup hydrates persisted `lsp.mode`

### Frontend Tests

- settings page hydrates `lsp.mode`
- settings page only commits UI state after persistence plus runtime apply succeed
- `MonacoHost` does not attach in `off`
- `MonacoHost` detaches immediately on `auto -> off`
- bridge clears timers and diagnostics during detach
- disabled result does not expose install or retry actions

### End-to-End Coverage

Add a focused workflow test:

1. open a supported file with LSP active
2. switch runtime mode to `off`
3. verify editor stays usable
4. verify LSP interactions no longer activate
5. verify returning to `auto` allows later on-demand LSP recovery

## Risks

### Persisted State But Failed Runtime Apply

If `settings.update` succeeds but `lsp.setMode` fails, persistence and runtime behavior can diverge.

The UI should avoid optimistic success and keep the last known applied mode until both operations succeed.

### Race Conditions During Mode Switch

An editor may still issue `lsp.*` requests while the setting is switching.

The backend must remain authoritative. Frontend cleanup improves UX, but backend short-circuiting is what prevents unwanted session recreation.

### Diagnostic Residue

Without explicit marker clearing, users may still see stale diagnostics after disabling LSP.

Detach cleanup must remain mandatory for all mounted models.

## Out of Scope

This design does not include:

- per-workspace LSP mode
- per-language LSP mode
- a third visible product mode beyond `auto` and `off`
- disabling Monaco's built-in non-LSP language workers
- changing existing idle TTL values

## Recommendation

Ship the setting as:

- `LSP Runtime Mode`
- `Auto` by default
- `Off` as the explicit immediate-memory-reclaim option

This matches the current architecture, gives users control, and solves the concrete memory-reclaim requirement without introducing broader LSP policy complexity.

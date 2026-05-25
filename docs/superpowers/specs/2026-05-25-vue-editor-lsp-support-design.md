# Vue Editor and LSP Support Design

> Status: Draft
> Date: 2026-05-25
> Scope: `packages/web/src/features/code-editor/*`, `packages/server/src/lsp/*`, `packages/server/src/lsp-tools/*`, `packages/server/src/commands/lsp.ts`, `packages/core/src/domain/lsp.ts`, related tests, package dependencies for Vue language tooling

## Goal

Add first-class Vue Single File Component support to the Monaco-based editor so `.vue` files behave like supported code files instead of plain text.

The feature should deliver:

- Vue syntax highlighting for `.vue` files
- workspace-backed Vue editor models using a stable Monaco language id
- Vue LSP session startup through the existing lazy `auto` runtime flow
- Vue diagnostics, hover, go-to-definition, references, and document symbols through Volar
- managed installation and recovery UX consistent with the existing Python, Go, and Rust LSP flow

## Problem

The current editor pipeline recognizes TypeScript, JavaScript, Python, Go, Rust, and a few markup styles by extension. `.vue` is not mapped in the editor language detector, so it falls back to `plaintext`.

That creates two failures:

1. the Monaco editor does not provide meaningful Vue syntax highlighting
2. the LSP pipeline does not consider `.vue` eligible for session startup, so no language intelligence is available

For Vue projects, this means:

- `.vue` files are visually degraded
- template and `<script setup>` content are not understood semantically
- cross-file navigation into Vue components is unavailable
- no Vue-aware diagnostics surface in the editor

## Decision

Adopt a dedicated Vue path through both editor language detection and LSP resolution.

The system should use:

1. a distinct Monaco language id: `vue`
2. a dedicated `LspServerKind`: `vue`
3. the official Vue language server package, `@vue/language-server` (Volar), for semantic features
4. the existing managed-tool and lazy-session architecture instead of a Vue-specific side channel

This is preferred over treating `.vue` as `html` or routing it through the TypeScript LSP because Vue SFC semantics require a server that understands the relationship between template, script, styles, props, emits, and generated TypeScript state.

## Non-Goals

This phase does not include:

- Vue-specific autocomplete beyond whatever Volar already exposes through the existing LSP capability surface
- rename, code actions, formatting, or semantic token customization
- support for non-SFC Vue-related formats such as `.astro` or custom template containers
- a generic third-party language registration system

## Product Semantics

### Keep Editing Non-Blocking

If Vue language tooling is unavailable, the editor must still open and edit `.vue` files normally.

The degraded state should be:

- syntax highlighting if Monaco Vue language registration succeeds
- no hover, definition, references, symbols, or diagnostics until LSP is ready
- a recoverable inline notice if the Vue language server is missing or failed

### Match Existing LSP Runtime Behavior

Vue support should follow the same runtime contract as existing LSP-backed languages:

- default mode remains `auto`
- session startup is lazy and only happens when an eligible workspace-backed `.vue` file is attached
- sessions are keyed by `workspaceId + server kind`
- idle sessions are automatically disposed by the existing TTL logic

No Vue-specific eager startup or background indexing should be added.

## Architecture

Vue support should be delivered in two coordinated layers.

### Layer 1: Monaco Vue Language

The web app must stop treating `.vue` as unknown text. It should map `.vue` to a dedicated Monaco language id, `vue`, and ensure the editor model uses that id for both workspace-backed and standalone files.

The Monaco language implementation should be lightweight and pragmatic:

- register `vue` once during editor bootstrap
- provide a tokenizer suitable for Vue SFC structure
- prioritize useful highlighting for `<template>`, `<script>`, `<script setup>`, `<style>`, directives, interpolation, and HTML-like structure

The initial implementation does not need to invent a large custom language subsystem. It only needs to establish a stable `vue` Monaco language id and a reasonable syntax-highlighting baseline.

### Layer 2: Vue LSP Through Volar

The backend must treat `.vue` as a supported LSP language family with a dedicated `vue` server kind.

The LSP path should follow the same flow as existing languages:

1. the editor attaches a workspace-backed model with `monacoLanguage: "vue"`
2. the frontend bridge resolves `vue` as an LSP-capable language
3. the frontend sends `lsp.ensureSession`
4. the backend resolves the `vue` tool definition
5. the backend launches a workspace-scoped Volar session if the tool is available
6. the frontend opens and syncs the document through the existing LSP bridge
7. Monaco providers surface definition, hover, references, symbols, and diagnostics

## Alternatives Considered

### Option 1: Treat `.vue` as `html` and stop there

Pros:

- smallest implementation effort
- improves visual readability quickly

Cons:

- no real Vue semantics
- templates and scripts remain disconnected
- no path to proper diagnostics or navigation

This is insufficient for the requested outcome.

### Option 2: Treat `.vue` as TypeScript-family and reuse `typescript-language-server`

Pros:

- reuses an existing bundled LSP dependency
- may provide some script-block behavior

Cons:

- does not correctly model Vue SFCs
- templates, props, emits, and generated type relationships are unreliable
- conflates Vue support with TypeScript worker assumptions

This is architecturally incorrect for a Vue editor feature.

### Option 3: Dedicated Monaco `vue` + dedicated Volar server

Pros:

- aligns editor language id and server kind cleanly
- fits the existing lazy LSP architecture
- gives Vue SFCs the correct semantic engine
- keeps future expansion straightforward

Cons:

- requires new package dependency and managed-install support
- touches both frontend and backend language maps

This is the recommended design.

## Frontend Design

### Language Detection

`packages/web/src/features/code-editor/components/monaco-host.tsx`

Update the editor language detector so:

- `.vue` resolves to `vue`
- LSP language detection returns `vue` unchanged

The current JSX and TSX special-casing should remain intact.

### Monaco Language Registration

Add a small Monaco Vue language registration module under the code editor feature, for example:

- `packages/web/src/features/code-editor/monaco/vue-language.ts`

Responsibilities:

- register Monaco language id `vue`
- register tokenizer and configuration once
- export an idempotent `ensureVueLanguageRegistered()` helper used by the editor host bootstrap path

This keeps Vue-specific editor setup isolated from the main React component.

### LSP Bridge Language Mapping

`packages/web/src/features/code-editor/lsp/language-map.ts`

Extend the bridge-side LSP server-kind resolver so:

- `.vue` files resolve to `vue`
- `monacoLanguage === "vue"` resolves to `vue`

`packages/web/src/features/code-editor/lsp/bridge.ts`

The provider registration path should register Monaco providers directly for `vue`. No language-id folding is needed for Vue, unlike `typescriptreact` and `javascriptreact`.

### UX Expectations

The editor should behave like existing supported LSP languages:

- no visible notice when Vue is supported and ready
- inline missing-tool notice when the Vue LSP is unavailable
- install and retry actions reuse the existing notice mechanics

## Backend Design

### Core Domain

`packages/core/src/domain/lsp.ts`

Extend `LspServerKind` to include:

- `vue`

Any shared schemas or discriminated unions derived from `LspServerKind` must stay exhaustive after this change.

### Server-Kind Resolution

`packages/server/src/lsp/server-factory.ts`

Extend path-based resolution so:

- `.vue` maps to `vue`

This preserves the existing separation between file-extension routing and process launch configuration.

### Tool Definition

`packages/server/src/lsp-tools/definitions.ts`

Add a new `vue` definition using `@vue/language-server`.

The definition should include:

- `serverKind: "vue"`
- a user-facing display name such as `Vue language server`
- default command and stdio args suitable for Volar
- managed install metadata

Vue should not be bundled in the same way TypeScript is currently bundled. It should use the managed install path so the product behavior matches Python, Go, and Rust: explicit installation, structured status, and recovery UI.

### Managed Install

`packages/server/src/lsp-tools/install-manager.ts`

Extend managed install planning and executable resolution to support `vue`.

The install contract should:

- install `@vue/language-server` into the managed tools root under a versioned directory
- produce a stable executable path recorded in the manifest
- verify the executable exists before reporting success

If Volar requires a Node-based CLI entrypoint rather than a native binary, the manifest and execution path should support launching it through the current Node runtime in the same style already used for bundled TypeScript CLI resolution.

### Command Surface

`packages/server/src/commands/lsp.ts`

Extend any `z.enum([...])` validation that currently enumerates installable server kinds so `vue` is accepted.

This ensures frontend install actions can request Vue tool installation through the same API shape used today.

## Package and Runtime Dependencies

### Server Dependencies

`packages/server/package.json`

Add the Vue language server package required by the chosen launch strategy:

- `@vue/language-server`

If Volar requires additional runtime companions for stable operation, add only the minimum required packages and document why in the dependency comment or surrounding implementation notes.

### No Frontend Framework Runtime Dependency

The web package should not pull in the Vue framework just to highlight or edit `.vue` files. Monaco registration and LSP transport are sufficient.

## Failure Handling

The feature must preserve current degraded-state behavior:

- unsupported or missing Vue tooling must not break file opening
- missing prerequisites must produce structured LSP state
- failed install attempts must remain retryable
- LSP startup failure must degrade to ordinary editing plus notice

The system must not:

- crash the editor when a Vue file opens
- silently misroute `.vue` to the TypeScript server
- report `unsupported_language` for `.vue` after the feature ships

## Testing Strategy

### Frontend Tests

Add or update tests for:

- `.vue` editor language detection
- standalone and workspace-backed model creation using `vue`
- LSP bridge language resolution for Vue
- provider registration and attach flow for `monacoLanguage: "vue"`

Primary files likely affected:

- `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- `packages/web/src/features/code-editor/lsp/providers.test.ts`
- new focused tests for the Vue Monaco registration module

### Backend Tests

Add or update tests for:

- `LspServerKind` exhaustiveness where relevant
- `.vue` path resolution in `server-factory`
- Vue tool definition lookup
- Vue install-manager planning and verification
- LSP command schema accepting `vue`
- `ensureSession()` returning `unsupported_language` no longer applies to `.vue`

Primary files likely affected:

- `packages/server/src/lsp/server-factory.test.ts`
- `packages/server/src/lsp-tools/manager.test.ts`
- `packages/server/src/lsp-tools/install-manager.test.ts`
- `packages/server/src/__tests__/lsp-commands.test.ts`
- `packages/server/src/lsp/manager.test.ts`

## Implementation Notes

### File Boundaries

Recommended new or expanded units:

- `packages/web/src/features/code-editor/monaco/vue-language.ts`
  - Vue Monaco registration only
- `packages/web/src/features/code-editor/components/monaco-host.tsx`
  - detect and apply `vue` language ids
- `packages/web/src/features/code-editor/lsp/language-map.ts`
  - map `.vue` and `vue` to `LspServerKind.vue`
- `packages/core/src/domain/lsp.ts`
  - extend shared server-kind type
- `packages/server/src/lsp/server-factory.ts`
  - resolve `.vue` to `vue`
- `packages/server/src/lsp-tools/definitions.ts`
  - describe Vue tool ownership and launch strategy
- `packages/server/src/lsp-tools/install-manager.ts`
  - install and verify the Vue language server

### Launch Strategy Constraint

The implementation must validate the exact Volar CLI entrypoint shape before coding the install path. The design decision is fixed: use `@vue/language-server` through the managed-tool system. The only implementation choice left is whether the manifest stores:

- a direct executable shim produced by package installation
- or a Node-launched entry script path plus args

That choice should be determined from the installed package structure during implementation and then covered by tests.

## Rollout Outcome

After this work:

- `.vue` files open with Vue-aware syntax highlighting
- Vue files participate in the same lazy LSP lifecycle as other supported languages
- Volar powers diagnostics and navigation for Vue SFCs
- install and recovery behavior matches the existing managed LSP UX

The result is a consistent product story: Vue becomes a first-class editor language instead of a plain-text exception.

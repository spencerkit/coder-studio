# LSP Editor Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing Monaco + server-managed LSP foundation from read-only editor intelligence into practical IDE-style editing flows. Phase 2 should add the highest-value write-path and semantic capabilities without regressing ordinary file editing or the stability guarantees established in Phase 1.

**Prerequisite:** [`2026-05-15-multi-language-lsp-foundation.md`](./2026-05-15-multi-language-lsp-foundation.md) is implemented and stable. This plan assumes the current branch already supports:

- `definition`
- `references`
- `hover`
- `diagnostics`
- `document symbols`
- workspace-backed model attach/detach
- server-managed LSP session reuse and restart recovery

**Target capabilities for Phase 2:**

1. `completion`
2. `signature help`
3. `format document` and `format range`
4. `semantic tokens`
5. `rename symbol`
6. `code actions`

**Priority order:** completion -> formatting -> signature help -> rename -> code actions -> semantic tokens

**Non-goals for this phase:**

- full VS Code extension-host compatibility
- plugin marketplace or third-party LSP registration UX
- code lens
- inlay hints
- workspace symbols
- declaration / implementation / type definition navigation
- refactor preview UI comparable to VS Code

---

## Product Intent

Phase 1 made the editor good at reading and navigating code.

Phase 2 should make it materially better for writing code.

The success condition is not feature count. The success condition is that the editor feels meaningfully closer to an IDE in the most common inner loop:

- type
- receive completion help
- inspect parameters
- format code
- rename symbols safely
- apply obvious quick fixes

All additions must preserve the existing product rule:

`If LSP fails, ordinary text editing must continue to work.`

That implies:

- feature failures are soft failures
- requests may return `null` / empty results without degrading typing
- write-path LSP actions must never corrupt local editor state
- multi-file edits must be validated before application

---

## Architecture Extension

Phase 2 builds on the current four-layer architecture and adds three new responsibilities.

### Layer 1: Shared DTO Expansion

The shared `packages/core/src/domain/lsp.ts` surface must expand beyond read-only payloads to cover:

- completion items
- signature help payloads
- text edits
- workspace edits
- rename payloads
- code action payloads
- semantic token payloads

These DTOs should remain editor-facing and normalized. They should not mirror raw LSP wire objects one-to-one when Monaco-friendly normalization is cheaper and safer.

### Layer 2: Server Edit-Aware Request Routing

The server LSP session layer must support additional requests:

- `textDocument/completion`
- `completionItem/resolve` (optional, phase-gated)
- `textDocument/signatureHelp`
- `textDocument/formatting`
- `textDocument/rangeFormatting`
- `textDocument/rename`
- `textDocument/codeAction`
- `workspace/executeCommand` (only if needed by chosen code actions)
- `textDocument/semanticTokens/full`

The server remains protocol authority. The web client must not need to understand raw LSP protocol shapes.

### Layer 3: Web Edit Application Layer

Phase 1 only needed read-only providers plus marker application.

Phase 2 needs a new editor-facing capability:

- safely apply single-file and multi-file text edits coming back from LSP

That application layer must handle:

- already-open models
- unopened text files inside the active workspace
- version-sensitive stale-result discard
- preserving local dirty state semantics
- rejecting unsupported resource operations in the first iteration

This is the critical dependency for `rename` and a substantial part of `code actions`.

---

## Delivery Strategy

Do not build all six features at once.

Deliver in three stages.

### Stage A: Fast-win request/response features

- completion
- signature help
- formatting

These have the best product impact per unit complexity.

### Stage B: Edit-application features

- rename
- code actions

These require shared text-edit and workspace-edit application infrastructure.

### Stage C: Semantic rendering

- semantic tokens

This improves code comprehension but is less urgent than Stage A and depends least on edit-application logic.

---

## File Structure

### Shared DTOs

- Modify: `packages/core/src/domain/lsp.ts`
  - Add DTOs for completion, signature help, text edits, workspace edits, rename, code actions, semantic tokens.
- Modify: `packages/core/src/domain/lsp.test.ts`
  - Lock the expanded shared editor-facing contracts.

### Server

- Modify: `packages/server/src/lsp/session.ts`
  - Add new request handlers and normalization logic.
- Modify: `packages/server/src/lsp/manager.ts`
  - Add request entry points for new operations.
- Modify: `packages/server/src/commands/lsp.ts`
  - Register websocket commands for all new operations.
- Modify: `packages/server/src/lsp/session.test.ts`
  - Cover normalization and stale failure handling for each new request family.
- Modify: `packages/server/src/lsp/manager.test.ts`
  - Cover routing and no-op behavior on unsupported languages.
- Modify: `packages/server/src/__tests__/fixtures/fake-lsp-server.js`
  - Add deterministic fake responses for completion, signature help, formatting, rename, code actions, semantic tokens.
- Modify: `packages/server/src/__tests__/lsp-commands.test.ts`
  - Cover command-level API for Phase 2 requests.

### Web LSP Integration

- Modify: `packages/web/src/features/code-editor/lsp/providers.ts`
  - Add Monaco providers for completion, signature help, formatting, semantic tokens, rename, code actions.
- Modify: `packages/web/src/features/code-editor/lsp/bridge.ts`
  - Add request bridges and edit-application helpers.
- Create: `packages/web/src/features/code-editor/lsp/edits.ts`
  - Normalize and apply LSP text edits and restricted workspace edits into Monaco models / workspace files.
- Create: `packages/web/src/features/code-editor/lsp/edits.test.ts`
  - Cover same-file edits, multi-file edits, unopened file edits, stale rejection, and unsupported operations.
- Modify: `packages/web/src/features/code-editor/lsp/providers.test.ts`
  - Add coverage for all newly registered Monaco providers.
- Modify: `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
  - Cover bridge request wiring and post-edit state application.

### Editor State / File Actions

- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
  - Expose safe file-content update hooks reusable by LSP edit application.
- Modify: `packages/web/src/features/code-editor/monaco/model-registry.ts`
  - Support controlled updates to open or lazily created models during workspace edit application.
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
  - Ensure new Monaco providers are active for workspace-backed models.
- Modify: related tests in:
  - `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
  - `packages/web/src/features/code-editor/index.test.tsx`
  - `packages/web/src/features/code-editor/monaco/model-registry.test.ts`

---

## Stage A: Completion, Signature Help, Formatting

### Task A1: Expand Shared DTOs

Add editor-facing types for:

- `LspCompletionItem`
- `LspCompletionList`
- `LspSignatureHelp`
- `LspTextEdit`

Keep the first iteration intentionally small:

- `label`
- `kind`
- `detail`
- `documentation`
- `insertText`
- `range`
- `additionalTextEdits?`
- `isIncomplete`

Do not front-load every optional LSP field.

**Acceptance:**

- `packages/core/src/domain/lsp.test.ts` asserts the new DTO shapes.

### Task A2: Add Completion Request Flow

Server:

- Add `lsp.completion`
- Normalize LSP completion responses into shared DTOs
- Support both array and completion-list result shapes

Web:

- Register `monaco.languages.registerCompletionItemProvider`
- Translate shared DTOs into Monaco completion items
- Support trigger characters from the server only in a later iteration; first pass may use Monaco defaults
- Discard stale results when the model version changes

**Acceptance:**

- completion opens for supported workspace-backed files
- same-file symbol suggestions appear from fake LSP fixture
- stale completion responses do not overwrite newer typing state

### Task A3: Add Signature Help Request Flow

Server:

- Add `lsp.signatureHelp`
- Normalize active signature, active parameter, and label/documentation payloads

Web:

- Register `monaco.languages.registerSignatureHelpProvider`
- Convert normalized response into Monaco signature help output

**Acceptance:**

- typing `(` in supported files requests signature help
- active parameter updates correctly on comma-separated arguments in the fake fixture

### Task A4: Add Format Document And Format Range

Server:

- Add `lsp.formatDocument`
- Add `lsp.formatRange`
- Normalize returned text edits

Web:

- Register document and range formatting providers
- Apply edits directly to the active model via Monaco edit APIs
- Preserve dirty-state semantics after formatting
- Ensure a formatting response based on an old model version is discarded

First iteration limit:

- only text edits
- no on-save auto-format yet

**Acceptance:**

- formatting can be invoked for a supported file
- resulting model content matches fake LSP formatting edits
- editor remains dirty until the user saves, unless content returns exactly to `savedContent`

---

## Stage B: Rename And Code Actions

### Task B1: Add Shared Workspace Edit Types

Add normalized DTOs for:

- `LspWorkspaceTextEdit`
- `LspWorkspaceEdit`
- `LspRenameResult`
- `LspCodeAction`

First iteration constraints:

- support text-document edits only
- explicitly reject create/rename/delete file resource operations
- explicitly reject snippet text edits in write paths

Document these limits in code comments and tests.

### Task B2: Build Edit Application Infrastructure

Create `packages/web/src/features/code-editor/lsp/edits.ts`.

Responsibilities:

- sort and apply multiple edits safely
- support active open Monaco models
- support unopened text files by loading or materializing the file through existing workspace actions
- update open-file atoms consistently
- keep `savedContent` untouched unless a real file save happens
- preserve `isDirty` recomputation after edit application

This is the highest-risk technical component in Phase 2.

**Acceptance:**

- same-file multi-edit application is deterministic
- cross-file text edits update multiple open buffers
- unopened file edits are applied into workspace-backed buffers without forcing data loss
- unsupported resource operations return a soft failure instead of partial application

### Task B3: Add Rename Symbol

Server:

- Add `lsp.rename`
- Normalize rename result into restricted workspace edit DTO

Web:

- Register Monaco rename provider
- Use the shared edit-application layer
- Reject stale rename results if the source model version changed

First iteration:

- workspace-scoped text edits only
- no file rename support

**Acceptance:**

- renaming a symbol updates all affected text locations in the fake workspace
- dirty states update correctly for touched buffers
- unsupported resource operations are surfaced as non-destructive failure

### Task B4: Add Code Actions

Server:

- Add `lsp.codeActions`
- Normalize title, kind, diagnostics affinity, preferred flag, and optional embedded workspace edit
- Defer `workspace/executeCommand` support unless needed

Web:

- Register `monaco.languages.registerCodeActionProvider`
- Expose quick-fix actions for diagnostics range selections
- If an action contains a workspace edit, apply through the shared edit layer
- If an action only carries a command, either:
  - reject in first iteration, or
  - add a tightly scoped `lsp.executeCommand` path

Recommendation:

- first implementation only supports code actions that embed a workspace edit

**Acceptance:**

- quick fixes appear for fake diagnostics
- applying a quick fix updates the model(s)
- unsupported command-only actions are filtered or soft-failed

---

## Stage C: Semantic Tokens

### Task C1: Add Shared Semantic Token DTOs

Add compact editor-facing types for:

- semantic token legend
- token data arrays or pre-normalized token tuples

Do not attempt delta support in the first pass.

### Task C2: Add Semantic Tokens Request Flow

Server:

- Add `lsp.semanticTokensFull`
- Normalize semantic token responses into a Monaco-friendly payload

Web:

- Register `monaco.languages.registerDocumentSemanticTokensProvider`
- Provide legend + full tokens
- Invalidate stale results when the model version changes

Recommendation:

- start with TypeScript-family only
- expand to other server kinds after basic rendering is stable

**Acceptance:**

- semantic token provider overlays richer token classes on supported files
- stale responses do not repaint newer content

---

## Testing Strategy

### Unit Tests

Add or extend:

- `packages/core/src/domain/lsp.test.ts`
- `packages/server/src/lsp/session.test.ts`
- `packages/server/src/lsp/manager.test.ts`
- `packages/server/src/__tests__/lsp-commands.test.ts`
- `packages/web/src/features/code-editor/lsp/providers.test.ts`
- `packages/web/src/features/code-editor/lsp/bridge.test.tsx`
- `packages/web/src/features/code-editor/lsp/edits.test.ts`
- `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- `packages/web/src/features/code-editor/index.test.tsx`

### Integration Tests

Extend `fake-lsp-server.js` to provide deterministic responses for:

- completion items
- signature help
- formatting edits
- rename workspace edits
- code actions with embedded text edits
- semantic tokens

### E2E

Create or extend:

- `e2e/specs/workspace/lsp-editor.spec.ts`

Cover at least:

- completion appears
- formatting applies expected edit
- rename updates multiple references
- quick fix resolves fake diagnostic

Semantic tokens may remain unit/integration-only in the first iteration if E2E signal is weak.

---

## Risk Areas

### Risk 1: Multi-file edit corruption

`rename` and `code actions` can touch multiple files. A partial or stale application path is worse than missing the feature.

Mitigation:

- restrict first pass to text edits only
- reject unsupported resource operations
- version-check the initiating model before apply
- test mixed open/unopened file scenarios explicitly

### Risk 2: Dirty-state regressions

Workspace edits can desync `content`, `savedContent`, and `isDirty`.

Mitigation:

- centralize edit application in one module
- add atom-level tests around dirty-state recomputation

### Risk 3: Monaco/LSP shape mismatch

Completion, signature help, and semantic tokens all have nontrivial provider-specific shapes.

Mitigation:

- normalize on the server
- keep web-side adapters shallow
- use fake LSP fixture coverage before any real-server broadening

### Risk 4: Scope blow-up from advanced protocol features

`completionItem/resolve`, command-based code actions, delta semantic tokens, snippet edits, and resource operations can multiply complexity quickly.

Mitigation:

- mark them explicitly out of first-pass scope
- ship restricted but stable behavior first

---

## Recommended Execution Order

- [ ] Task A1: Shared DTO expansion
- [ ] Task A2: Completion
- [ ] Task A3: Signature help
- [ ] Task A4: Formatting
- [ ] Task B1: Workspace edit DTOs
- [ ] Task B2: Edit application infrastructure
- [ ] Task B3: Rename
- [ ] Task B4: Code actions
- [ ] Task C1: Semantic token DTOs
- [ ] Task C2: Semantic tokens
- [ ] Final regression run for all LSP editor suites

---

## Exit Criteria

Phase 2 is complete when:

- supported workspace-backed files expose completion, signature help, formatting, rename, code actions, and semantic tokens at the defined first-pass scope
- unsupported languages still degrade gracefully to plain editing
- multi-file edit application is deterministic and non-destructive
- LSP failures do not block typing, opening, saving, or ordinary navigation
- the LSP-focused regression suite is green


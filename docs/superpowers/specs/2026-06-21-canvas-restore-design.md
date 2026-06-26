# Canvas Restore Design

> Status: Draft for user review
> Date: 2026-06-21
> Scope: `packages/core`, `packages/server`, `packages/web`, `packages/cli`

## Problem

Coder Studio previously shipped a first-class `canvas` artifact flow that let
agents or CLI users create structured workspace artifacts and open them as
editor tabs. That capability was introduced on 2026-06-14 and then removed on
2026-06-14 by the `Refactor skills runtime and remove canvas surfaces` change.

On current `develop`, the following are all gone:

- canvas core contracts
- canvas server commands and service
- canvas API route
- canvas editor-tab type and UI action
- embedded canvas route and renderers
- canvas CLI entrypoints

The goal of this design is to restore the removed canvas feature on top of the
current `develop` architecture without trying to replay the entire pre-removal
branch state.

## Goals

- Restore a minimal but usable canvas feature on current `develop`.
- Restore first-class canvas artifacts as editor tabs inside the existing
  editor surface.
- Restore two v1 artifact kinds:
  - `architecture_canvas`
  - `report_canvas`
- Persist canvas source as real workspace files under
  `.coder-studio/canvases/*.canvas.json`.
- Restore explicit server commands to create, update, render, and list
  canvases.
- Restore a product-owned render path through an embedded route plus a server
  data API.
- Preserve the ability to open the backing source file from the canvas tab.
- Keep the restored scope compatible with the current skills/runtime work on
  `develop`.

## Non-Goals

- Do not restore freeform whiteboard editing.
- Do not restore arbitrary agent-authored HTML.
- Do not restore export, sharing, publishing, or permissions.
- Do not restore advanced background rerender automation in the first pass.
- Do not replay unrelated pre-removal refactors just because they existed in
  the old branch.
- Do not broaden the artifact surface beyond
  `architecture_canvas` and `report_canvas`.

## Current Context

Relevant current files:

- `packages/core/src/domain/types.ts`
- `packages/core/src/domain/ui-actions.ts`
- `packages/server/src/server.ts`
- `packages/server/src/app.ts`
- `packages/server/src/commands/index.ts`
- `packages/server/src/ws/dispatch.ts`
- `packages/web/src/app.tsx`
- `packages/web/src/features/workspace/atoms/files.ts`
- `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
- `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`
- `packages/cli/src/cli.ts`
- `packages/cli/src/parse-args.ts`

The current editor surface already supports mixed tab kinds through
`WorkspaceEditorTab`, but only `file` and `browser` remain on `develop`. The
UI action system also remains intact, so `canvas.open` can be restored without
inventing a new transport.

## User Decisions Captured

- The current branch should restore canvas instead of leaving it removed.
- The restore should target the minimal usable chain, not a full replay of the
  old branch.
- The restored feature should include the previously implemented artifact types:
  `architecture_canvas` and `report_canvas`.
- The restored feature should keep file-backed source and a product-owned
  renderer.
- The restored feature should keep the canvas tab, embedded route, data API,
  and source-file workflow.

## Approaches Considered

### Option A: Minimal restore on top of current `develop`

Restore only the canvas-specific contracts, server flow, editor-tab support,
embedded route, renderers, and CLI commands. Adapt them where necessary to fit
the current codebase.

Pros:

- Lowest risk to the current skills/runtime work.
- Smallest restore surface that still returns visible user value.
- Lets us verify the old canvas model still fits the current editor shell.

Cons:

- Requires some selective adaptation instead of a blind revert.

Decision: accept.

### Option B: Replay the pre-removal canvas implementation wholesale

Try to reapply the removed canvas implementation nearly verbatim.

Pros:

- Conceptually simple.
- Preserves old file structure and behavior.

Cons:

- High conflict risk with post-removal `develop`.
- Risks reintroducing stale assumptions from the old branch.
- Pulls in more incidental surface area than needed.

Decision: reject.

### Option C: Restore only the read-only embedded route first

Bring back just the render route and API, leaving out create/update/list and
editor-tab integration.

Pros:

- Lowest implementation risk.

Cons:

- Incomplete user-facing feature.
- Does not actually restore the original canvas workflow.

Decision: reject.

## Final Design

## 1. Scope Summary

The restore target is the smallest version that feels like the former canvas
feature to an end user:

- a canvas can be created, updated, rendered, and listed through server
  commands
- a canvas source file exists in the workspace
- a canvas can open as an editor tab through a UI action
- the tab shows an embedded canvas page rendered by product-owned UI
- the user can open the source file and manually refresh the render

This pass intentionally excludes automatic rerender orchestration beyond
explicit `canvas.render` and manual refresh.

## 2. High-Level Architecture

The restored flow is:

`agent or CLI -> canvas.create/update/render/list -> server validate/persist/compile -> canvas.open UI action -> editor tab -> embedded route -> /api/canvas/.../data -> renderer`

The important boundary remains:

- source is typed JSON stored in the workspace
- server owns validation and compilation
- frontend owns presentation only
- the canvas tab is a viewer plus control surface, not the source editor

## 3. Data Model

### 3.1 Core schema restoration

Restore `packages/core/src/domain/canvas.ts` with the previously implemented
contracts:

- `CanvasArtifactKind`
- `CanvasRecord`
- `CanvasDocumentEnvelope`
- `CompiledCanvas`
- `CanvasDataResponse`
- render status and render error types

The restore keeps the existing v1 envelope shape:

```json
{
  "version": 1,
  "kind": "architecture_canvas",
  "title": "Runtime Flow",
  "document": {}
}
```

### 3.2 Workspace UI state restoration

Restore `WorkspaceCanvasEditorTab` to `packages/core/src/domain/types.ts` and
re-add it to `WorkspaceEditorTab`.

Expected shape:

```ts
interface WorkspaceCanvasEditorTab {
  kind: "canvas";
  id: string;
  canvasId: string;
  title: string;
  artifactType: "architecture_canvas" | "report_canvas";
  sourcePath: string;
}
```

This allows canvas tabs to participate in:

- open tab persistence
- active tab restoration
- existing mixed-tab editor UI

### 3.3 UI action restoration

Restore `canvas.open` in `packages/core/src/domain/ui-actions.ts` so the server
can tell the frontend to open a persisted canvas.

The action payload should include:

- `workspaceId`
- `canvasId`
- `title`
- `artifactType`
- `sourcePath`

## 4. Server Design

### 4.1 Repository

Restore `packages/server/src/storage/repositories/canvas-repo.ts`.

Responsibilities:

- store workspace-local canvas metadata
- list canvases by workspace
- get by `workspaceId + canvasId`
- upsert records

The repo remains metadata-only. It does not store the source document body.

### 4.2 Source of truth

Canvas content continues to live in real workspace files:

- `.coder-studio/canvases/<canvas-id>.canvas.json`

The repo stores only index/runtime state:

- id
- workspaceId
- sessionId when available
- sourcePath
- artifactType
- title
- updatedAt
- renderStatus
- lastError

### 4.3 Validation and compilation

Restore `packages/server/src/canvas/*`:

- `validation.ts`
- `compiler.ts`
- `service.ts`
- supporting graph/mermaid helpers needed by `architecture_canvas`

Responsibilities:

- parse and validate source JSON
- compile source to frontend render data
- normalize validation and compile failures into structured canvas errors

The restore keeps the previous rendering model:

- `architecture_canvas`
  - diagram section
  - annotations section
- `report_canvas`
  - stats
  - markdown
  - list
  - table
  - callout
  - section

### 4.4 Commands

Restore `packages/server/src/commands/canvas.ts` and register it from
`packages/server/src/commands/index.ts`.

Commands to restore:

- `canvas.list`
- `canvas.create`
- `canvas.update`
- `canvas.render`

Behavior:

- `canvas.create`
  - validate input
  - create a new canvas id
  - write source file
  - persist metadata
  - compile once
  - optionally broadcast `canvas.open`
- `canvas.update`
  - load existing record
  - rewrite source file with optimistic base hash protection
  - compile once
- `canvas.render`
  - rerender an existing canvas by id or source path
- `canvas.list`
  - return workspace canvas records

### 4.5 Route

Restore `packages/server/src/routes/canvas.ts` and register it from
`packages/server/src/app.ts`.

Route:

- `GET /api/canvas/:workspaceId/:canvasId/data`

Behavior:

- resolve workspace
- fetch current compiled data from `CanvasService`
- return `404` for missing workspace or canvas
- return structured error payloads only for expected canvas-not-found cases

### 4.6 Server assembly

Update `packages/server/src/server.ts` and `packages/server/src/ws/dispatch.ts`
to wire `CanvasRepo` and `CanvasService` into `CommandContext`.

This is the only new server dependency added in the restore. No unrelated
server subsystems should change.

## 5. Frontend Design

### 5.1 Router restoration

Restore the embedded canvas route in `packages/web/src/app.tsx`:

- `/embedded/canvas/:workspaceId/:canvasId`

This route should be handled before the normal shell catch-all.

### 5.2 Canvas feature module

Restore `packages/web/src/features/canvas/*`:

- `api.ts`
- `routes/embedded-canvas-route.tsx`
- `components/canvas-route-frame.tsx`
- `components/architecture-canvas-renderer.tsx`
- `components/report-canvas-renderer.tsx`

Responsibilities:

- fetch compiled data from the server
- render loading/error/ready states
- display architecture and report artifacts using product-owned UI

### 5.3 Editor tab support

Update `packages/web/src/features/workspace/atoms/files.ts` to restore:

- `WorkspaceCanvasEditorTab`
- normalization support for persisted canvas tabs
- `canvasRefreshTokenAtomFamily`

The refresh token stays local to the frontend and only exists to force the
embedded iframe URL to reload after a manual rerender.

### 5.4 UI action subscription

Update `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
to handle `canvas.open`.

Behavior:

- create or replace a canvas tab keyed by `canvasId`
- mark the editor view visible
- set the canvas tab as active

This mirrors the existing browser-tab flow instead of introducing a new UI
action subsystem.

### 5.5 Editor surface integration

Update `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
to recognize `canvas` tabs and render a restored `CanvasSurface`.

`CanvasSurface` responsibilities:

- show toolbar actions
- render the embedded route in an iframe
- provide:
  - `Open source`
  - `Refresh`

`Open source` opens the backing `.canvas.json` file in the standard editor.

`Refresh` dispatches `canvas.render` and increments the refresh token for the
iframe when the command succeeds.

### 5.6 Tab chrome integration

Update `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`
to support:

- canvas tab title display
- activation
- close behavior
- canvas-specific iconography

The tab should behave like a first-class mixed tab beside file and browser
tabs, not like a special overlay.

## 6. CLI Design

Restore the `canvas` automation surface in:

- `packages/cli/src/parse-args.ts`
- `packages/cli/src/cli.ts`

Commands to restore:

- `coder-studio canvas list`
- `coder-studio canvas create`
- `coder-studio canvas update`
- `coder-studio canvas render`

The CLI should remain a thin wrapper over the restored server commands. No
special client-side compilation logic should be introduced.

## 7. Error Handling

### 7.1 Validation failures

If `canvas.create` or `canvas.update` receives invalid source content:

- reject the request with a structured validation error
- do not persist invalid source
- do not silently coerce to another shape

### 7.2 Compile failures

If source validation passes but compilation fails:

- persist the source
- mark the record `renderStatus: "error"`
- return `lastError`
- let the frontend render a canvas error state

This preserves user-editable source while surfacing a broken render.

### 7.3 Frontend states

The embedded route must explicitly handle:

- loading
- no data
- error
- ready

The canvas tab itself should not collapse or disappear on render failure. The
failure needs to remain inspectable and refreshable.

## 8. Testing Strategy

### 8.1 Core

Restore or add tests covering:

- source envelope validation
- compiled document contracts
- `CanvasDataResponse` invariants

### 8.2 Server

Restore or add tests covering:

- `CanvasService.create`
- `CanvasService.update`
- `CanvasService.renderFromSourcePath`
- `CanvasService.getCanvasData`
- `canvas` command handlers
- canvas API route responses
- server wiring for route and command context

### 8.3 Frontend

Restore or add tests covering:

- `App` route selection for `/embedded/canvas/...`
- `useUiActionSubscription` handling of `canvas.open`
- `editor-surface` canvas rendering path
- tab header activation and close behavior for canvas tabs
- embedded route loading/error/ready states
- both canvas renderer variants

### 8.4 CLI

Restore or add tests for:

- `parse-args` support for the `canvas` command family
- CLI command dispatch wiring

## 9. Restore Order

Implementation should proceed in this order:

1. restore core contracts
2. restore server repo/service/commands/route
3. restore frontend router, tab model, surface, and renderers
4. restore CLI support
5. run focused tests
6. run repository verification relevant to the touched packages

This ordering keeps the contract and backend ready before the UI starts
consuming them.

## 10. Risks and Constraints

- Current `develop` has moved on in skills/runtime areas, so blind revert
  strategies are unsafe.
- The old canvas implementation used large UI components; restore work should
  avoid incidental UI refactors while still fitting current imports and tests.
- Automatic rerender-on-file-change existed as a design goal before removal,
  but this restore does not depend on reintroducing that behavior.

## 11. Acceptance Criteria

The restore is complete when all of the following are true:

- a canvas can be created through the restored server command path
- source is written under `.coder-studio/canvases/`
- a canvas can be opened as an editor tab through `canvas.open`
- the tab loads `/embedded/canvas/:workspaceId/:canvasId`
- the embedded route fetches `/api/canvas/:workspaceId/:canvasId/data`
- `architecture_canvas` and `report_canvas` both render
- the user can open the backing source file from the canvas tab
- the user can manually refresh the render from the canvas tab
- restored focused tests pass

## 12. Design Summary

This restore intentionally brings back the old canvas user experience without
bringing back the whole old branch. The product shape remains:

- typed source in workspace files
- server-owned validation and compilation
- first-class canvas tabs in the editor
- embedded product renderers for architecture and report artifacts

That is enough to make the previous canvas feature visible and usable again on
today's `develop` while keeping the implementation surface constrained.

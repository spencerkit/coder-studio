# Agent Canvas Design

> Status: Draft for user review
> Date: 2026-06-13
> Scope: `packages/core`, `packages/server`, `packages/web`, `packages/cli`

## Problem

Coder Studio already has several pieces that are adjacent to a canvas system:

- persisted workspace editor tabs for files and browser tabs
- a built-in preview surface for markdown and HTML
- agent-triggered UI actions for opening files and browser URLs
- workspace-level persistence for open editor state

What it does not have is a first-class agent artifact model.

Today an agent can explain things in chat, open files, or open a localhost page,
but it cannot create a durable, structured artifact that:

- opens directly as an editor tab
- has a stable identity in the workspace
- is backed by editable source
- renders through a product-owned runtime instead of arbitrary agent HTML
- can be updated by the agent and re-rendered by the system

The goal of this design is to add a Cursor Canvas-like capability to Coder
Studio, but aligned to Coder Studio's existing editor model. The primary entry
point should be an editor tab, not a chat card.

## Goals

- Add a first-class canvas artifact model that agents can create and update.
- Make canvas artifacts open as editor tabs inside the existing workspace
  editor surface.
- Persist canvas source as real workspace files that users can open and edit.
- Keep agent output structured and typed. Agents must not emit raw HTML.
- Support two first-class artifact types in v1:
  - `architecture_canvas`
  - `report_canvas`
- Compile canvas source through a server-owned runtime before rendering.
- Re-render canvas tabs automatically when the backing source file changes.
- Keep the design extensible for more artifact types later.

## Non-Goals

- Do not make the canvas primary entry point a chat card.
- Do not let agents emit arbitrary raw HTML as the source contract.
- Do not add general whiteboard editing or freeform drag-and-drop editing in
  v1.
- Do not add sharing, publishing, permissions, or exports in v1.
- Do not add arbitrary embedded scripts or user-authored runtime code in v1.
- Do not add complex patch or OT/CRDT editing semantics in v1.
- Do not make canvas a separate workspace surface outside the editor tab
  system in v1.

## Current Context

Relevant current code:

- `packages/core/src/domain/types.ts` defines workspace UI state and the
  persisted editor-tab union.
- `packages/web/src/features/workspace/atoms/files.ts` mirrors the editor-tab
  model and owns editor surface atoms.
- `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
  routes between file and browser editor states.
- `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`
  renders mixed editor tabs.
- `packages/core/src/domain/ui-actions.ts` defines agent-dispatchable UI
  actions such as opening files and browser tabs.
- `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
  applies server-dispatched UI actions in the frontend.
- `packages/web/src/features/code-editor/preview/api.ts` and preview
  components already provide an internal preview rendering path.

These existing pieces make a canvas system feasible without inventing a second
editor container or second persistence model.

## User Decisions Captured

The following decisions were fixed during brainstorming:

- The product should support a feature similar to Cursor Canvas.
- The canvas base rendering technology can be HTML, but the agent must not
  output raw HTML directly.
- The agent should output standardized source, and the canvas runtime should
  own rendering.
- v1 should prioritize:
  - architecture / flow diagrams
  - reports / tables / audit views
- v1 should use separate artifact types instead of one giant universal schema.
- The source contract should be a JSON envelope with typed payloads. Diagram
  content may use an inner DSL.
- Canvas creation and updates should be explicit agent actions, not automatic
  message parsing.
- Users should be able to open and edit canvas source.
- Canvas source should be stored as real workspace files.
- Canvas should be a persisted workspace object.
- The primary entry point should be an editor tab, not a chat card.

## Approaches Considered

### Option A: File-backed source + server compile + editor-tab viewer

Agent calls explicit canvas commands. Server validates and persists typed
source files. Server compiles source into a render model. Frontend opens a
dedicated canvas editor tab and allows source editing via a regular file tab.

Pros:

- Clear product and protocol boundary.
- Fits the user's requirement that source is editable as a real file.
- Centralizes validation and compilation.
- Keeps source semantics and view semantics separate.
- Leaves room for future export, sharing, snapshots, and refresh workflows.
- Fits the existing editor-tab and workspace persistence model.

Cons:

- Requires a new server-side runtime layer.
- Requires coordinated changes across core, server, web, and CLI.

Decision: accept.

### Option B: File-backed source + frontend-only rendering from raw source

Persist source as files, but let the browser interpret source directly and
render without a server compilation step.

Pros:

- Faster to prototype.
- Less backend work initially.

Cons:

- Pushes validation and compilation logic into the UI.
- Makes server-side reuse harder later.
- Weakens a future path to exports, remote rendering, and stable diagnostics.

Decision: reject for v1.

### Option C: Internal canvas store first, project files optional later

Make canvas an internal product object first and optionally sync it to files
later.

Pros:

- Maximum product flexibility long term.
- Hides internal runtime details from the project tree.

Cons:

- Conflicts with the explicit user decision that source should be a real file.
- Makes user editing and Git-based inspection harder.
- Increases persistence and migration complexity.

Decision: reject for v1.

## Final Design

## 1. High-Level Architecture

The v1 architecture is:

`agent -> canvas.create/update -> server validate/persist -> web opens canvas tab -> canvas route fetches compiled data`

The core boundary is:

- agent writes structured source, not HTML
- source is persisted as a workspace file
- server validates and compiles into a render model
- frontend renders the compiled artifact in a dedicated canvas tab route
- users edit source through a normal file editor tab

Canvas is therefore a first-class editor artifact, not a transient preview and
not a chat attachment.

## 2. Persisted Source and Metadata Model

V1 uses two related but distinct concepts:

### 2.1 Canvas source file

This is the source of truth for artifact content and is stored in the
workspace, for example:

`.coder-studio/canvases/<canvas-id>.canvas.json`

The user can open and edit this file directly.

### 2.2 Canvas record

This is product metadata used for indexing, reopen behavior, status, and tab
identity. It should not replace the source file.

Recommended record shape:

```ts
interface CanvasRecord {
  id: string;
  workspaceId: string;
  sessionId?: string;
  sourcePath: string;
  artifactType: "architecture_canvas" | "report_canvas";
  title: string;
  updatedAt: number;
  renderStatus: "ready" | "error" | "rendering";
  lastError?: CanvasRenderError | null;
}
```

The source file owns content. The canvas record owns indexing and runtime
state.

## 3. Source Contract

All canvas source files share one common outer envelope:

```json
{
  "version": 1,
  "kind": "architecture_canvas",
  "title": "Workspace Runtime Architecture",
  "document": {}
}
```

or:

```json
{
  "version": 1,
  "kind": "report_canvas",
  "title": "Workspace Audit Report",
  "document": {}
}
```

Required properties:

- `version`
- `kind`
- `title`
- `document`

This shared envelope provides:

- schema routing on the server
- forward-compatible versioning
- a stable editing target for users
- a clean place to add more artifact types later

## 4. Artifact Types

### 4.1 `architecture_canvas`

This artifact type is optimized for architecture diagrams and flow diagrams.

It should use a JSON envelope plus a tightly scoped inner diagram DSL.

Recommended shape:

```json
{
  "version": 1,
  "kind": "architecture_canvas",
  "title": "Coder Studio Workspace Flow",
  "document": {
    "summary": "How agent actions move from web to server runtime.",
    "diagram": {
      "dsl": "graph_v1",
      "source": "service WebUI -> command Server\ncommand Server -> runtime ProviderRuntime"
    },
    "annotations": [
      {
        "title": "Execution boundary",
        "body": "Server owns command execution."
      }
    ]
  }
}
```

Recommended required or stable fields:

- `summary`
- `diagram.dsl`
- `diagram.source`
- `annotations[]`

V1 should not attempt to support a broad third-party DSL surface such as the
full Mermaid or PlantUML feature set. Instead, it should define a small,
product-owned `graph_v1` dialect or AST subset that covers:

- node
- edge
- direction
- group / subgraph
- label
- simple style variants

This keeps generation stable, validation strict, and rendering predictable.

### 4.2 `report_canvas`

This artifact type is optimized for reports, audits, stats, tables, and
structured summaries.

It should use pure structured JSON blocks instead of a nested DSL.

Recommended shape:

```json
{
  "version": 1,
  "kind": "report_canvas",
  "title": "Workspace Audit Report",
  "document": {
    "summary": "Audit of the current monorepo state.",
    "stats": [
      { "label": "Packages", "value": 6 },
      { "label": "Failing Checks", "value": 2, "tone": "danger" }
    ],
    "sections": [
      {
        "title": "Key Findings",
        "blocks": [
          {
            "type": "list",
            "items": [
              "Server commands are cohesive.",
              "UI action path already exists."
            ]
          }
        ]
      }
    ]
  }
}
```

V1 block types should be intentionally small:

- `markdown`
- `stats`
- `list`
- `table`
- `callout`

The design should not support arbitrary nested layout grammars in v1.

## 5. Agent-Facing Command Interface

V1 should expose three core commands:

1. `canvas.create`
2. `canvas.update`
3. `canvas.render`

Only the first two are primary agent entry points. `canvas.render` mainly
exists for system-triggered re-render flows such as user-edited source files.

### 5.1 `canvas.create`

Recommended input:

```json
{
  "workspaceId": "ws_123",
  "sessionId": "sess_123",
  "title": "Workspace Runtime Architecture",
  "kind": "architecture_canvas",
  "document": {
    "summary": "How requests move through the runtime.",
    "diagram": {
      "dsl": "graph_v1",
      "source": "service Web -> server Dispatch\nserver Dispatch -> runtime Commands"
    },
    "annotations": [
      {
        "title": "Execution boundary",
        "body": "Server owns command execution."
      }
    ]
  },
  "openInEditor": true
}
```

Behavior:

- generate `canvasId`
- persist source file
- validate and compile
- create or update canvas record
- open a canvas editor tab when requested
- return `canvasId`, `sourcePath`, `renderStatus`

### 5.2 `canvas.update`

Recommended input:

```json
{
  "workspaceId": "ws_123",
  "canvasId": "canvas_456",
  "title": "Workspace Runtime Architecture v2",
  "document": {
    "summary": "Updated flow.",
    "diagram": {
      "dsl": "graph_v1",
      "source": "service Web -> commandBus Dispatch\ncommandBus Dispatch -> runtime Commands"
    },
    "annotations": []
  }
}
```

V1 semantics should be full-document replacement:

- overwrite the source file with the new document
- re-run validation and compile
- refresh any open canvas tab for that artifact

V1 should not add JSON Patch, block-level patching, or multi-author merge
semantics.

### 5.3 `canvas.render`

This command exists mainly for product-owned workflows:

- source file changed on disk
- source file saved by the user
- server wants to refresh render state

V1 does not require agents to call this directly.

### 5.4 Update type constraints

V1 should not allow cross-type mutation. For example:

- `architecture_canvas` cannot be updated into `report_canvas`
- `report_canvas` cannot be updated into `architecture_canvas`

This keeps the state model and compiler selection simple.

## 6. User Editing Flow

The user should be able to open the backing source file and edit it directly.

Expected flow:

1. Canvas opens as a canvas tab.
2. User chooses `Open Source`.
3. The backing `.canvas.json` file opens in a normal file editor tab.
4. User saves the file.
5. Server detects the change and triggers re-render.
6. The corresponding canvas tab refreshes.

If rendering fails:

- the source file remains as authored
- the canvas tab enters an error state
- the user can keep editing the source and retry by saving or re-rendering

V1 should not silently roll back source edits.

## 7. Runtime Pipeline

The canvas runtime should have three explicit layers:

1. `validate`
2. `compile`
3. `render`

The internal data flow is:

`source json -> typed document -> compiled canvas model -> frontend route render`

V1 should not collapse this into a direct `json -> html` transformation.

### 7.1 Validate

Validation responsibilities:

- parse JSON
- validate outer envelope
- route by `kind` and `version`
- validate artifact-specific schema
- reject illegal raw HTML source payloads

Examples:

- missing `diagram.source`
- unknown report block type
- malformed version

### 7.2 Compile

Compilation converts typed documents into a unified render model.

Examples:

- `architecture_canvas` compiles to diagram data plus annotation panels
- `report_canvas` compiles to a block tree with stats, sections, tables, and
  callouts

The compiled model is the compatibility boundary between schema semantics and
frontend presentation.

### 7.3 Render

Rendering is owned by the frontend canvas route and its renderer components.

The backend should not maintain a per-canvas HTML output cache in v1. Instead:

- the backend owns source validation
- the backend owns source-to-model compilation
- the frontend route owns turning the compiled model into visible UI

The recommended transport shape is:

- persisted source: `.coder-studio/canvases/<canvas-id>.canvas.json`
- canvas metadata: `CanvasRecord`
- compiled response: `GET /api/canvas/:workspaceId/:canvasId/data`

This keeps HTML as a product implementation detail rather than a persisted or
server-cached artifact.

## 8. Error Model

V1 should distinguish at least three error categories:

- `validation_error`
- `compile_error`
- `render_error`

Examples:

- `validation_error`: `document.diagram.source is required`
- `compile_error`: diagram edge references a missing node
- `render_error`: frontend renderer fails to mount a valid compiled model

Recommended UX:

- do not blank the source file or roll back
- show a clear canvas-tab error state
- include a field path and human-readable message
- prefer catching issues in validation or compile rather than render

V1 should keep error handling simple and not try to show a stale last-good
render underneath the error state.

## 9. Frontend Integration

### 9.1 Canvas becomes a third editor-tab kind

Today the persisted editor tab model only includes file and browser tabs.
V1 should extend it with a third type:

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

`WorkspaceEditorTab` then becomes:

- `file`
- `browser`
- `canvas`

This change must be reflected in both:

- `packages/core/src/domain/types.ts`
- `packages/web/src/features/workspace/atoms/files.ts`

### 9.2 Open behavior

Canvas should open as an editor tab in the existing main editor surface.

The primary flow should be:

`canvas.create/update -> server dispatches canvas.open -> frontend inserts canvas tab`

The product should not depend on a chat card as the primary entry point.

### 9.3 Editor surface routing

The current editor surface already routes based on active editor state. V1
should extend that routing:

- `file` -> existing Monaco / preview / diff flow
- `browser` -> existing dev-browser surface
- `canvas` -> new `CanvasSurface`

`CanvasSurface` should support at least:

- `iframe`-hosted canvas display
- `Open Source`
- `Re-render`
- clear error state display

V1 should not embed a split source editor inside the canvas tab itself.

### 9.4 Canvas rendering route

Canvas rendering should still use `iframe` isolation, but the `iframe` should
point at a frontend-owned route rather than a backend HTML artifact endpoint.

Recommended shape:

- editor tab renders `CanvasSurface`
- `CanvasSurface` mounts an `iframe`
- `iframe src` points to a web route such as
  `/embedded/canvas/:workspaceId/:canvasId`
- that route loads a dedicated React entry for canvas rendering
- the route requests `GET /api/canvas/:workspaceId/:canvasId/data`
- the route chooses a renderer by `kind`

This gives v1:

- style isolation from the main product shell
- product-owned rendering without arbitrary agent HTML
- a clear path for richer frontend interactions later

### 9.5 Canvas renderer boundary

The frontend route should render from compiled data, not directly from raw
source JSON.

Recommended boundary:

- source contract is for agent output and user editing
- compiled model is for renderer consumption

This keeps renderer complexity lower and avoids coupling the web runtime to
every source-schema detail or future DSL evolution.

### 9.6 Tab UI

The existing tab header can be extended rather than replaced.

Canvas tabs should:

- display a canvas-specific icon
- display the canvas title
- optionally display a compact artifact marker such as `ARCH` or `REPORT`
- use the existing activate and close patterns

### 9.7 Reopen and listing

Because canvas is persisted, the workspace should provide a secondary reopen
path.

V1 should include at least one lightweight reopen mechanism, such as:

- a `Canvases` section in the explorer/sidebar, or
- command palette / quick open support for canvases

V1 does not require a complex canvas management page.

## 10. Protocol Surface

The existing UI action protocol already handles opening files and browser tabs.
Canvas should not be modeled as a browser URL in the workspace tab model, even
though it uses an `iframe` internally for isolation.

V1 should add a parallel canvas-specific action, for example:

- `canvas.open`
- optionally `canvas.close`

This avoids overloading the meaning of `browser.openUrl` and keeps tab
semantics correct.

In addition to websocket commands, the runtime should expose a read-only data
endpoint for the embedded renderer:

- `GET /api/canvas/:workspaceId/:canvasId/data`

Recommended response:

```ts
interface CanvasDataResponse {
  canvasId: string;
  workspaceId: string;
  title: string;
  kind: "architecture_canvas" | "report_canvas";
  renderStatus: "ready" | "error";
  lastError?: CanvasRenderError | null;
  compiledDocument?: CompiledCanvas;
}
```

`canvas.render` remains useful, but its v1 job is to force a fresh
validate/compile pass and update status. It should not return or cache full
HTML output.

## 11. Persistence and Workspace State

Canvas tabs should participate in persisted workspace editor state in the same
way browser tabs do.

That means:

- open canvas tabs persist across refresh
- active canvas tab persists across refresh
- the canvas tab restores by `canvasId` and `sourcePath`
- runtime render state is rebuilt from persisted source and metadata
- iframe route state is disposable and derived on demand

Short-lived render caches should not become the source of truth. In the
recommended route-based design, v1 does not need a server-side HTML cache at
all.

## 12. Testing Strategy

At minimum, add tests for:

1. schema validation for both artifact types
2. compiler outputs for valid architecture and report documents
3. validation and compile failures with clear error payloads
4. `canvas.create` persisting source and returning metadata
5. `canvas.update` replacing the document and refreshing the tab
6. `GET /api/canvas/:workspaceId/:canvasId/data` returning compiled data and
   error states
7. opening a canvas as a new editor tab
8. restoring persisted canvas tabs after refresh
9. opening and editing source files followed by automatic re-render
10. iframe canvas route rendering the correct renderer by `kind`
11. canvas tab error-state rendering after invalid source edits

The most important v1 stability investment is in schema and compiler tests.

## 13. Acceptance Criteria

- an agent can explicitly create a canvas artifact through a command interface
- the resulting artifact opens as a new canvas editor tab
- canvas source is stored as a real workspace file
- the user can open and edit the source file directly
- saving the source file triggers re-render of the associated canvas tab
- the agent never needs to emit raw HTML
- the canvas tab renders through a frontend-owned route fed by compiled canvas
  data
- v1 supports both `architecture_canvas` and `report_canvas`
- invalid source yields a clear canvas error state without destroying user
  edits
- canvas tabs participate in persisted workspace editor state

## 14. Rollout Notes

Implement this incrementally:

1. core types and protocol
2. server create/update/render commands and persistence
3. server data endpoint plus validation/compile pipeline
4. frontend iframe route and canvas renderer support
5. source-edit re-render loop
6. lightweight canvas reopen entry

This keeps the work decomposed while preserving the core contract.

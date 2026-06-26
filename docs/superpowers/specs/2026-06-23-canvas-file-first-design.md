# Canvas File-First Design

> Status: Draft for user review
> Date: 2026-06-23
> Scope: `packages/core`, `packages/server`, `packages/web`, `packages/cli`

## Problem

The current canvas model is still artifact-first:

- canvas source is stored as `.coder-studio/canvases/<canvas-id>.canvas.json`
- render flow is keyed by `canvasId`
- the editor opens a dedicated `canvas` tab that points back to a source file
- source editing and rendered viewing are related, but they are not modeled as the same file-first resource

This causes three problems:

- canvas does not behave like a normal workspace file
- manual open flows need canvas-specific entry points or commands
- future editing features risk splitting into two identities: a source file and a separate rendered artifact

The user wants to move canvas to a file-first model:

- the real source of truth is a workspace file
- opening that file should default to rendered canvas view
- source editing should operate on the same file
- rename and delete semantics should match normal file behavior
- this phase should not implement future drawing or exported image features yet

## Goals

- Make canvas a file-first document type backed by `.csc` files.
- Treat `.csc` as the single source of truth for canvas content.
- Open `.csc` files into a rendered canvas view by default.
- Keep source editing available for the same `.csc` file.
- Remove `canvasId` as a required user-facing or render-time identity.
- Align rename and delete behavior with current normal file handling.
- Require meaningful human-readable canvas names at creation time so users can tell what a canvas is for from the tab title, list view, and file name.
- Preserve future compatibility with richer direct canvas editing.

## Non-Goals

- Do not add drawing, brush, selection, masking, or image annotation tools in this phase.
- Do not implement automatic exported PNG generation for agent consumption in this phase.
- Do not generalize the editor into a reusable framework for every future rendered document type yet.
- Do not keep a separate artifact identity model just for backward familiarity.
- Do not add a new dedicated “manual open canvas” button or panel in this phase.

## Current Context

Relevant current behavior:

- Canvas files are created under `.coder-studio/canvases/<canvas-id>.canvas.json`.
- `canvas.open` opens a non-file editor tab carrying `canvasId`, `artifactType`, and `sourcePath`.
- The canvas surface renders through `/embedded/canvas/:workspaceId/:canvasId`.
- The canvas surface already exposes `Open Source` and `Refresh`, but source editing opens a separate file tab.
- Standard file rename behavior in the workspace rewrites active/open editor paths instead of treating rename as delete-plus-create.

Relevant files:

- `packages/core/src/domain/canvas.ts`
- `packages/core/src/domain/types.ts`
- `packages/core/src/domain/ui-actions.ts`
- `packages/server/src/canvas/service.ts`
- `packages/server/src/commands/canvas.ts`
- `packages/server/src/commands/ui-actions.ts`
- `packages/server/src/routes/canvas.ts`
- `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
- `packages/web/src/features/workspace/actions/use-file-actions.ts`
- `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`

## User Decisions Captured

- Canvas should move to a file-first model now rather than keep the current id-first model.
- `.csc` should be the real canvas source file, not a pointer file that only stores an id.
- Opening a `.csc` file should default to rendered canvas view.
- Source editing and rendered viewing should refer to the same file.
- Rename semantics should follow the existing normal editor/file rename behavior.
- Canvas creation should use meaningful user-visible names rather than generic placeholders so users can find the right canvas later.
- Future direct canvas editing should remain compatible with this model.
- Future agent reading can rely on an automatically updated final image, but that is explicitly out of scope for this phase.

## Approaches Considered

### Option A: Keep the current artifact-first model and add more manual entry points

Pros:

- Lowest short-term implementation cost
- Reuses current `canvasId` infrastructure

Cons:

- Canvas still does not behave like a normal file
- Source and render remain split identities
- Future editing features would need another migration

Decision: reject.

### Option B: File-first `.csc`, but keep `canvasId` as the primary render identity

Pros:

- Smaller migration than fully removing id-based render paths
- Preserves more current behavior

Cons:

- Still models the same canvas as both a file and a separate artifact
- Keeps unnecessary metadata synchronization
- Rename and file-open flows stay more complex than needed

Decision: reject.

### Option C: Fully file-first `.csc`, render by `sourcePath`, remove required `canvasId`

Pros:

- Cleanest user and system model
- Canvas becomes a normal workspace file with a custom renderer
- Source and render are two views of one resource
- Best base for future direct canvas editing

Cons:

- Requires broader changes across server, web, and command surfaces

Decision: accept.

## Final Design

## 1. File Model

Canvas source files become real workspace files with the `.csc` extension.

The `.csc` file remains the only source of truth. It stores the full canvas document envelope, not a pointer to another artifact.

Example path:

- `.coder-studio/canvases/runtime-flow.csc`

The current JSON-based envelope shape can remain in v1, but the file extension changes and the model is explicitly file-first.

Creation naming rules:

- Every canvas create flow must provide a meaningful title that describes the canvas content, such as `Runtime Request Flow` or `Workspace Audit Summary`.
- Generic titles such as `Canvas`, `Diagram`, `Architecture`, `Untitled`, or id-like placeholder names should not be used by agent-driven create flows.
- The initial `.csc` file path should be derived from that title by slugifying it, for example `Runtime Request Flow` -> `.coder-studio/canvases/runtime-request-flow.csc`.
- If the slug already exists, the create flow should keep the readable base name and append a numeric suffix, for example `runtime-request-flow-2.csc`.
- Editing the title inside the `.csc` document does not automatically rename the file path. File rename remains an explicit workspace file operation, matching normal file behavior.

## 2. Identity Model

Render identity moves from `canvasId` to `sourcePath`.

The system should treat a canvas as:

- workspace id
- source path

This pair is sufficient for:

- opening render view
- refreshing render
- restoring editor state
- rename propagation
- delete handling

`canvasId` is removed from the primary runtime model for this feature. If compatibility shims are temporarily needed during migration, they stay internal and should not remain part of the intended steady-state API.

## 3. Opening Behavior

Opening a `.csc` file through normal file flows should default to rendered canvas view rather than plain text source view.

This includes:

- explorer click
- quick open / open file flows
- drag-and-drop open flows that resolve to a workspace file path

The rendered view should still expose source access for the same file.

Initial phase behavior:

- default open target for `.csc`: render view
- explicit source access: `Open Source` from the canvas surface

Future work may replace `Open Source` with a stronger `Render / Source` toggle, but that is not required now.

## 4. Editor Tab Model

Canvas tabs remain a non-file editor tab in the current editor architecture, but they become file-addressed rather than artifact-addressed.

Expected tab shape after migration:

```ts
interface WorkspaceCanvasEditorTab {
  kind: "canvas";
  id: `canvas:${sourcePath}`;
  sourcePath: string;
  title: string;
}
```

The tab should not require `canvasId` or artifact metadata to render.

The path row and persistence model should treat the canvas tab as belonging to the `.csc` file it represents.

## 5. Render Flow

Render requests and embedded routes should take `sourcePath` instead of `canvasId`.

Target flow:

- open `.csc`
- construct canvas editor tab keyed by `sourcePath`
- render through a route and command surface addressed by `workspaceId + sourcePath`
- read and validate the `.csc` file
- compile and display the rendered canvas

Expected route direction:

- current: `/embedded/canvas/:workspaceId/:canvasId`
- target: `/embedded/canvas/:workspaceId?sourcePath=<percent-encoded-workspace-relative-path>`

The same query-based addressing should be used for the data route:

- target: `/api/canvas/:workspaceId/data?sourcePath=<percent-encoded-workspace-relative-path>`

## 6. Server Responsibilities

Server canvas handling changes from record-first to source-file-first:

- create canvas writes a `.csc` file
- render reads by `sourcePath`
- open-canvas style APIs become compatibility shims or are removed
- file-backed validation remains server-owned
- compile remains server-owned

This phase should prefer these command shapes:

- `canvas.render` requires `workspaceId + sourcePath`
- file open flows trigger render view for `.csc`

Any remaining repo or record layer should be treated as optional cache/compatibility infrastructure, not the canonical model.

## 7. Rename and Delete Semantics

Canvas files should follow the same semantics as ordinary file rename/delete handling.

Rename:

- rename of a `.csc` file is treated as the same file moving to a new path
- open render tabs follow the new path
- source tabs follow the new path
- active state and persisted UI state are rewritten to the new path

Delete:

- delete of a `.csc` file closes any render tab for that path
- delete of a `.csc` file closes any source tab for that path

This avoids special-case “delete then recreate” semantics and keeps behavior aligned with the rest of the editor.

## 8. Compatibility With Future Direct Canvas Editing

This model is intentionally compatible with future in-canvas editing.

Future direct manipulation features such as brush strokes, selections, or annotations should update the `.csc` source document rather than a separate artifact identity.

That keeps:

- rendered view
- source view
- future export or derived image generation

all anchored to one file.

This phase does not implement those features, but it must not block them.

## 9. CLI and UI Action Direction

The long-term preferred open path becomes normal file open behavior for `.csc`.

Implications:

- `ui open-canvas` no longer needs to be the primary user-facing or agent-facing path
- `ui open-file --path <file>.csc` can become sufficient once `.csc` opens into render view by default

Short-term compatibility is acceptable, but the target state is that canvas behaves like a file type, not like a separate workspace artifact class.

## 10. Builtin Skill Guidance

The builtin canvas skill and any related agent instructions should explicitly require meaningful names when creating canvases.

Required guidance:

- When calling `coder-studio canvas create`, always pass a specific `--title` that tells the user what the canvas represents.
- Prefer concise descriptive names such as `Runtime Request Flow`, `Agent Tooling Overview`, or `Workspace Audit Summary`.
- Do not create canvases with placeholder names such as `Canvas`, `Diagram`, `Architecture`, `New Canvas`, or timestamp-only labels.
- The reason for this rule is user-facing discoverability: the canvas title and derived file name should make it obvious what the canvas is for in tabs, lists, and file explorers.

## Testing

Required verification coverage:

- canvas creation with a meaningful title produces a readable `.csc` path and preserves the intended title
- `.csc` files open into render view from normal file-open flows
- `Open Source` opens the same `.csc` file in text mode
- render refresh reads by `sourcePath`
- editor tab persistence restores canvas tabs by `sourcePath`
- rename of `.csc` rewrites render/source tab state like ordinary files
- delete of `.csc` closes render/source tab state
- server render route rejects invalid or missing `.csc` files with clear errors

## Risks

- Current canvas code assumes `canvasId` in multiple places; migration needs careful end-to-end updates.
- Existing persisted canvas tabs may need normalization if older state still contains `canvasId`-based entries.
- Drag-and-drop behavior needs care if some flows bypass normal open-file routing.

## Rollout Recommendation

Implement this as a focused migration in one pass:

1. Move server render/read paths to `sourcePath`.
2. Change canvas source file extension and creation/update behavior to `.csc`.
3. Make `.csc` open through render view in the editor.
4. Update canvas tab persistence and rename/delete handling to be path-based.
5. Leave future exported image generation and direct drawing features for a later phase.

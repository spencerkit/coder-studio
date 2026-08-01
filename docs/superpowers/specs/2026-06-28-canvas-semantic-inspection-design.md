# Canvas Semantic Inspection Design

> Status: Draft for user review
> Date: 2026-06-28
> Scope: `packages/core`, `packages/server`, `packages/web`, `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`

## Summary

Coder Studio already has two important canvas foundations:

- typed file-backed canvas artifacts
- persistent geometric annotation overlays

What it still lacks is the layer that makes on-canvas interaction reliably
useful to an agent. A rectangle drawn on top of a chart is visually helpful to
the human, but it does not yet tell the system which chart block, series,
point, node, or table cell the user meant.

This design adds a semantic inspection layer between the rendered canvas and the
agent. The system produces a structured `sceneManifest` for rendered canvas
elements, lets the user attach comment instructions to selected elements, stores
a compact semantic snapshot with each saved comment, and returns both the
visual and structural context through a dedicated inspection payload.

The first phase intentionally stops short of full design-mode editing. It
focuses on the smallest product slice that closes the largest competitive gap
with Cursor-style point-and-prompt canvas workflows.

## Problem

Current canvas capabilities in this worktree:

- `report_canvas` supports text-heavy report blocks and typed charts
- `architecture_canvas` supports Mermaid-backed diagrams
- users can draw and edit persistent overlay annotations
- `canvas.render` already returns `compiledDocument` and `overlayDocument`

Current gap:

- agent flows still do not know what visual element a user pointed at
- overlay shapes are geometric, not semantic
- there is no first-class comment instruction object attached to a selection
- there is no dedicated inspection payload that combines source, overlay,
  semantic hits, and saved semantic comment targets

Without those pieces, canvas editing remains annotation-first rather than
agent-readable.

## Goals

- Add a typed semantic manifest for rendered canvas elements.
- Let users select one or more rendered elements and attach a text instruction.
- Persist those instructions separately from the source `.csc` file.
- Expose a dedicated inspection response that agents can re-read after the user
  edits a canvas.
- Reuse existing canvas rendering paths instead of introducing a second canvas
  runtime.
- Keep the design artifact-first and file-backed.

## Non-Goals

- No reverse-write into `.csc` in this phase.
- No CRDT, collaboration, or presence model.
- No freeform arbitrary HTML/JS canvas runtime.
- No guarantee of pixel-perfect element binding for every future chart kind.
- No attempt to make every annotation object semantically anchored in phase 1.
- No mandatory screenshot generation on every save.
- No active push from the canvas UI into an agent session in phase 1.
- No security interaction block work in this roadmap.

## Product Direction

The product should move from:

- `compiledDocument + overlayDocument`

to:

- `compiledDocument + overlayDocument + sceneManifest + anchorCommentsWithTargets`

The important distinction is that the primary source of meaning is the typed
semantic manifest plus the user-authored instruction attached to selected
elements. Agents do not need the canvas UI to push those comments into an
active session. Instead, after the user says the canvas changed, the agent can
re-run `canvas.inspect` for the known `.csc` source path and consume the latest
saved semantic comment targets.

## Phase 1: 0-30 Days

### Objective

Ship a minimal point-and-prompt loop for canvases:

1. render a semantic scene manifest
2. let the user select rendered elements
3. attach an instruction comment to that selection
4. return a structured inspection payload for agent re-read

### Deliverables

1. Add a shared `CanvasSceneManifest` contract.
2. Add a shared `CanvasAnchorCommentDocument` contract.
3. Add server persistence for anchor comments keyed by `workspaceId +
   sourcePath`.
4. Add a web-side scene registration path for report blocks, chart blocks, and
   Mermaid nodes/edges.
5. Add a new inline canvas mode for inspect/comment selection.
6. Add a dedicated inspection API/command that returns semantic context.
7. Update the built-in canvas skill so agents know to re-run `canvas.inspect`
   after the user changes a canvas.

### Why this is the first slice

This is the highest-value gap because it determines whether the agent can
reliably understand what the user meant by a gesture. More shape tools or more
chart kinds improve editing breadth, but semantic selection is the piece that
raises canvas from “annotated screenshot” to “inspectable artifact”.

## Shared Data Model

### Scene manifest

Add a typed scene manifest to describe render-time selectable elements:

```ts
type CanvasSceneRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type CanvasSceneElementKind =
  | "chart-block"
  | "chart-series"
  | "chart-point"
  | "report-stat"
  | "table-cell"
  | "callout"
  | "markdown-block"
  | "list-block"
  | "mermaid-node"
  | "mermaid-edge"
  | "overlay-object";

type CanvasSceneElement = {
  id: string;
  kind: CanvasSceneElementKind;
  rect: CanvasSceneRect;
  label?: string;
  payload?: Record<string, unknown>;
};

type CanvasSceneManifest = {
  version: 1;
  elements: CanvasSceneElement[];
};
```

Design rules:

- `id` is stable within one rendered canvas response.
- `rect` is always scene-relative, matching overlay coordinates.
- `payload` is structured metadata safe for agent consumption.
- the manifest is an inspection artifact, not source-of-truth source content.

### Anchor comments

Anchor comments are distinct from overlay drawing objects. They represent user
intent attached to one or more semantic elements and persist a compact snapshot
of the selected semantic target:

```ts
type CanvasAnchorComment = {
  id: string;
  elementIds: string[];
  targets?: CanvasSceneElement[];
  selectionRect?: CanvasSceneRect;
  body: string;
  status: "open" | "resolved";
  createdAt: string;
  updatedAt: string;
};

type CanvasAnchorCommentDocument = {
  version: 1;
  comments: CanvasAnchorComment[];
};
```

Design rules:

- comments persist separately from `.csc`
- comments are not embedded into overlay geometry objects
- `targets` stores a semantic snapshot of what the user selected at save time so
  later agent reads do not depend on reconstructing the exact runtime hit
  result
- `elementIds` may be empty only for a pure area selection fallback
- `selectionRect` is optional because element binding is the preferred anchor

## Server Design

### Storage

Add a dedicated anchor comment repository, parallel to the overlay repository:

- `CanvasOverlayRepo` remains responsible for geometric overlay data
- `CanvasAnchorCommentRepo` stores semantic user comments

Persistence key:

- `workspaceId`
- `sourcePath`

### Service changes

Extend `CanvasService` with:

- `getCanvasInspectionData()`
- `saveAnchorComments()`

`getCanvasInspectionData()` should return:

- the normal canvas render payload
- the latest saved anchor comment document
- the latest scene manifest provided by the rendering path, if available

The service should not attempt to generate screenshot images on every render.
Image generation should remain opt-in and can be deferred to a later phase.
The service also does not need to push canvas context into a live session. The
phase-1 contract is pull-based: agent opens or creates a canvas, remembers the
`.csc` source path, and later re-runs `canvas.inspect` when the user says the
canvas changed.

### API and command surface

Add:

- `PUT /api/canvas/:workspaceId/comments?sourcePath=...`
- a new command such as `canvas.inspect`

Recommended `canvas.inspect` response shape:

```ts
{
  workspaceId: string;
  sourcePath: string;
  title: string;
  kind: CanvasArtifactKind;
  renderStatus: CanvasRenderStatus;
  overlayDocument?: CanvasOverlayDocument;
  compiledDocument?: CompiledCanvasDocument;
  sceneManifest?: CanvasSceneManifest;
  anchorCommentDocument?: CanvasAnchorCommentDocument;
}
```

## Web Design

### Rendering architecture

Canvas rendering already happens through:

- `CanvasContent`
- `ArchitectureCanvasRenderer`
- `ReportCanvasRenderer`
- `CanvasOverlayLayer`

This phase adds a parallel semantic registration path rather than replacing
those renderers.

Recommended model:

- each renderer can register scene elements into a local manifest collector
- `CanvasContent` owns the current manifest state for the scene
- the inspect/comment UI reads from the manifest and overlay together

### Scene registration

#### Report blocks

For block-level elements that already render through DOM:

- stats
- table cells
- callouts
- markdown blocks
- list blocks

register elements through DOM refs and `getBoundingClientRect()` normalization.

#### Charts

For chart blocks:

- always register at least one `chart-block` element
- for phase 1 line/bar/sparkline charts, also register:
  - `chart-series`
  - `chart-point`

Use ECharts geometry APIs or renderer hooks to derive scene-relative positions.
If per-point extraction is temporarily unavailable for a block, the renderer may
fall back to block-level registration rather than failing the entire manifest.

#### Architecture canvases

For Mermaid-backed diagrams:

- register visible nodes as `mermaid-node`
- register visible edges as `mermaid-edge`

Use the rendered SVG DOM and bounding boxes after Mermaid output mounts.

#### Overlay objects

Overlay objects may also be reflected into the manifest as `overlay-object`
elements, mainly so the agent can reason about existing user drawings together
with source-rendered elements.

### Interaction model

Add an inline `inspect/comment` mode to `CanvasSurface`.

Behavior:

- clicking a scene element selects the top semantic hit
- drag selection can collect multiple overlapping semantic elements
- the selected region remains visually highlighted
- the user gets a small inline comment composer
- submitting the comment persists a `CanvasAnchorComment`

This mode is separate from current draw/edit tools:

- `select`
- `pen`
- `arrow`
- `rect`
- `text`
- `inspect`

Phase 1 does not require a floating inspector redesign. A modest inline panel or
popover is sufficient if it stays inside the current canvas surface patterns.

## Agent Consumption Model

Phase 1 should support a simple but precise flow:

1. user selects visual content
2. user writes an instruction
3. the product calls `canvas.inspect`
4. agent receives:
   - compiled source structure
   - geometric overlay state
   - semantic hit map
   - anchored user instruction
   - optional screenshot evidence if later requested

The agent should prefer `anchorCommentDocument + sceneManifest` over raw image
guessing.

Example:

- comment body: “Explain why this bar is the peak and change its color to
  warning”
- selected `elementIds`:
  - `chart-point:prompt_tokens:10:00`
  - `chart-series:prompt_tokens`

That payload is much less ambiguous than a screenshot-only arrow.

## Phase 2: 60-90 Days

### Objective

Extend the semantic inspection foundation into a broader design-mode and sharing
workflow.

### Deliverables

1. Add richer design-mode editing:
   - inline text edit
   - property editing for color / stroke / font
   - multi-select
   - undo / redo
   - keyboard shortcuts
2. Add read-only and shareable inspection snapshots that include anchor comments.
3. Add explicit “ask agent about selection” actions from the canvas surface.
4. Expand semantic adapters to more chart kinds beyond the initial chart family.
5. Add resolved/open review flows for anchor comments.

### Design rules for phase 2

- new chart kinds must always have block-level semantic coverage
- high-value chart kinds should get point-level adapters incrementally
- screenshot/image export remains support evidence, not the only evidence
- source files remain canonical; semantic inspection data remains companion state

## Competitive Positioning

Cursor’s recent public canvas direction has moved toward:

- shareable canvases
- design mode
- point-and-prompt visual workflows
- broader artifact interaction, not just static rendering

Coder Studio does not need to copy every part of that direction. The strongest
fit is:

- typed, file-backed artifacts
- server-owned compilation
- structured inspection payloads for agents

That means the best next move is not unlimited freeform drawing. It is
structured semantic interpretation layered on top of the existing canvas system.

## Risks

- Chart geometry extraction may differ by chart kind and renderer internals.
  - Mitigation: require block-level coverage first, then add point-level
    adapters selectively.
- Scene element ids could become unstable if renderers do not derive them from
  source structure.
  - Mitigation: derive ids from block/series/category/node identity rather than
    random values.
- Mermaid DOM extraction may be brittle across Mermaid output changes.
  - Mitigation: keep the extraction helper localized to the architecture canvas
    renderer and cover it with renderer tests.
- Too much UI ambition could turn phase 1 into a full canvas editor rewrite.
  - Mitigation: limit phase 1 to inspect/comment mode and comment persistence.

## Testing

0-30 day coverage should include:

- core schema tests for `CanvasSceneManifest` and `CanvasAnchorCommentDocument`
- server service tests for saving/loading anchor comments
- route tests for the new comment save API
- command tests for `canvas.inspect`
- web renderer tests for manifest registration on report and architecture scenes
- canvas surface tests for inspect/comment selection and persistence

60-90 day coverage should additionally include:

- undo/redo interaction tests
- multi-select tests
- property editing tests
- share/snapshot route coverage for semantic comments
- adapter tests for additional chart kinds

## Recommendation

Treat this as a separate roadmap from chart expansion and annotation geometry:

- keep chart-type work inside the report canvas roadmap
- keep overlay drawing/editing work inside annotations v1/v1.1
- run semantic inspection as the next focused canvas capability line

That separation keeps the architecture understandable:

- chart roadmap answers “what can the canvas render?”
- annotation roadmap answers “what can the user draw/edit?”
- semantic inspection roadmap answers “what can the agent understand?”

# Canvas PNG Export Design

> Status: Approved for implementation
> Date: 2026-06-29
> Scope: `packages/web`

## Summary

Add a PNG export action to the inline editor canvas so users can download the
full current canvas as an image for sharing or for handing back to an agent.

The export is intentionally client-side and content-scoped. It captures the
canvas content tree only, not editor chrome, toolbars, tabs, or viewport state.
The exported image includes the rendered source canvas, saved overlay
annotations, and saved semantic comments as visible on-canvas content.

V1 only supports direct PNG download from the inline editor canvas surface.

## Goals

- Let users download the current canvas as a PNG from the editor.
- Export the full canvas content, not the visible viewport.
- Include rendered canvas content, saved overlay annotations, and saved
  comments.
- Keep export behavior aligned with what the user sees in the canvas content
  area.
- Reuse the current mixed HTML/SVG/chart rendering model rather than requiring
  a new pure-SVG scene architecture.

## Non-Goals

- No clipboard image copy in V1.
- No export entry point in embedded routes or snapshot routes.
- No server-side export pipeline.
- No SVG export format.
- No viewport-only screenshot mode.
- No export of editor chrome, container frames, or toolbars.
- No export while a comment draft is still unsaved.

## Current State

The inline editor canvas is rendered by `CanvasSurface`, which applies zoom and
hosts the annotation toolbar around `CanvasContent`.

`CanvasContent` renders the compiled canvas body and the editable overlay layer.
The current canvas body is not a single pure SVG scene:

- report canvases are mostly HTML layout plus ECharts charts
- architecture canvases mix HTML layout with Mermaid-generated SVG
- the annotation overlay is a separate SVG layer

Because the visible content is already a mixed DOM tree, exporting by
serializing one unified SVG scene would require a broad renderer rewrite and
would not be a good fit for this phase.

## Chosen Approach

Export the rendered canvas content root as a PNG using a lightweight client-side
DOM-to-image pipeline.

This approach is preferred over a pure-SVG rewrite or a separate offscreen
export compositor because it:

- works with the current mixed HTML/SVG/ECharts renderer stack
- keeps the exported result close to the visible canvas content
- applies to all existing canvas kinds without per-kind export code
- limits V1 complexity to one export flow and one content root

The export pipeline should operate on a dedicated canvas content root inside
`CanvasContent`, not on the viewport wrapper in `CanvasSurface`.

## User Experience

### Entry Point

Add an `Export PNG` action to the inline canvas controls in `CanvasSurface`.

The action is only shown in the editor canvas tab. It is not added to embedded
canvas routes.

### Export Behavior

When the user clicks `Export PNG`:

1. validate that the canvas content is loaded and exportable
2. block export if an unsaved comment draft exists
3. switch the content into a temporary export render mode
4. render the full content root at `1x`
5. download a `.png` file
6. restore normal interactive state

Recommended filename shape:

- `<canvas-title>.png` when a stable title is available
- otherwise `<source-file-basename>.canvas.png`

### What The PNG Includes

- compiled canvas body content
- saved overlay annotations
- saved semantic comments rendered as visible on-canvas markers or bubbles
- resolved comments, but with weaker visual treatment than open comments

### What The PNG Excludes

- tab chrome
- editor container styling
- annotation toolbar
- zoom controls
- transient selection outlines and resize handles
- inspect selection highlight
- text-edit textarea
- unsaved comment composer
- hover-only affordances

## Comment Rendering Rules

Saved comments must become part of the canvas content layer so the exported
image matches the visible canvas content state.

V1 comment rendering should be intentionally simple:

- each saved comment renders as a lightweight anchored bubble or marker
- open comments use normal emphasis
- resolved comments use reduced emphasis
- comment markers render inside the exportable content root

Draft comments remain editor-only UI and are not exported. If a draft exists,
export is blocked until the draft is saved or dismissed.

## Rendering And Export Rules

- Export is based on the full canvas content tree, not current scroll position.
- Export ignores the current zoom level in `CanvasSurface`.
- Export resolution is fixed at `1x` in V1.
- The export target is the normalized content state, not an interactive editing
  state.
- Canvas content should be rendered in a deterministic export mode before the
  PNG capture runs.

The export mode should suppress interactive affordances while preserving the
final visual content that the user considers part of the canvas.

## Technical Design

### CanvasSurface

`CanvasSurface` remains the user entry point for export. It should:

- add the `Export PNG` control
- track export-in-progress UI state
- hold a ref or callback for the exportable content node
- receive child state about whether export is currently blocked by an unsaved
  draft
- trigger the client-side download flow

The export action should not capture the scaled viewport wrapper. It should
capture a content root provided by `CanvasContent`.

### CanvasContent

`CanvasContent` should expose one stable export root that contains all visual
canvas content intended for export.

It should also support an explicit export render mode that:

- removes editing affordances
- ensures saved comments are visible in the content layer
- keeps overlay annotations rendered
- preserves the full content size independent of viewport zoom

`CanvasContent` should surface whether an unsaved comment draft exists so
`CanvasSurface` can disable or block export.

### Export Utility

Add a focused client-side export helper in `packages/web` that:

- accepts an element reference
- rasterizes the DOM subtree to PNG
- returns or downloads a blob
- reports failure cleanly

The helper should be implementation-local to web canvas export rather than a
general repository-wide abstraction in this phase.

### Dependency Direction

Introduce a small DOM-to-image dependency in `packages/web` rather than writing
a custom offscreen compositor.

This is acceptable because:

- the project does not already have a DOM export utility
- the canvas content is already a mixed DOM tree
- V1 only needs download, not a long-lived export platform

## Error Handling

- If canvas content is still loading, export is disabled.
- If no export root is available, export fails with a user-facing error.
- If a comment draft is unsaved, export is blocked with a prompt to save or
  dismiss the draft first.
- If rasterization fails, show a non-destructive failure message and leave the
  current canvas state untouched.

Export failures must not mutate saved canvas, overlay, or comment state.

## Testing

Add targeted web tests for:

- export control visibility in `CanvasSurface`
- export disabled or blocked when a comment draft exists
- export mode suppressing editor-only affordances
- saved comments rendering inside the content root
- export helper invocation with the correct content node
- failure-state messaging when export cannot complete

This phase does not require end-to-end binary image snapshot assertions. Unit
and interaction coverage around the export flow is sufficient.

## Risks And Trade-Offs

- PNG output is raster, not vector. This is acceptable for V1 download.
- DOM-to-image output can differ slightly from live DOM rendering depending on
  fonts or chart internals.
- ECharts content is part of the mixed export tree, so export quality depends on
  the chosen client-side rasterization library.
- Making comments visible in the content layer is a required UI change, not just
  an export implementation detail.

These trade-offs are preferable to forcing the current canvas system into a new
pure-SVG rendering model solely for export support.

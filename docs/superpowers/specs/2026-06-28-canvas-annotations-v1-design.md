# Canvas Annotations V1 Design

> Status: Approved for implementation
> Date: 2026-06-28
> Scope: `packages/core`, `packages/server`, `packages/web`

## Summary

Canvas v1 annotations add a transparent structured overlay on top of existing
canvas rendering. Users can draw freehand strokes, rectangles, arrows, and text
notes directly in the canvas preview. The overlay is persisted separately from
the `.csc` source file and is rendered back on every canvas view.

This phase does not attempt reverse-write into `.csc`, fine-grained chart
element binding, collaboration, or snapshot composition.

## Goals

- Let users annotate existing canvases directly in the inline canvas preview.
- Persist annotations by `workspaceId + sourcePath`.
- Keep annotations structured so they can be consumed by future agent flows.
- Render saved annotations in both inline and embedded canvas views.
- Keep the source-first `.csc` model unchanged.

## Non-Goals

- No `.csc` reverse-write from visual edits.
- No CRDT or multi-user sync.
- No semantic region manifest or element-level anchoring.
- No screenshot export pipeline in this phase.
- No chart-internal hit testing.

## Data Model

Annotations are stored as a `CanvasOverlayDocument`:

```ts
type CanvasOverlayDocument = {
  version: 1;
  objects: CanvasOverlayObject[];
};

type CanvasOverlayObject =
  | {
      id: string;
      type: "stroke";
      color: string;
      width: number;
      points: Array<{ x: number; y: number }>;
    }
  | {
      id: string;
      type: "rect";
      color: string;
      width: number;
      x: number;
      y: number;
      height: number;
      rectWidth: number;
    }
  | {
      id: string;
      type: "arrow";
      color: string;
      width: number;
      from: { x: number; y: number };
      to: { x: number; y: number };
    }
  | {
      id: string;
      type: "text";
      color: string;
      fontSize: number;
      x: number;
      y: number;
      text: string;
    };
```

The overlay document is separate from the canvas source envelope. It is a
per-canvas companion artifact.

## Server Design

- Add a dedicated canvas overlay repository under server state storage.
- Extend `CanvasService.getCanvasData()` to include the saved overlay document.
- Add `CanvasService.saveOverlay()` to validate source path existence and store
  the overlay.
- Add an HTTP `PUT /api/canvas/:workspaceId/annotations?sourcePath=...` route
  for saving overlay state from the web app.
- Extend `canvas.render` command output to return the full render payload,
  including `compiledDocument` and `overlayDocument`, so future agent flows can
  consume both.

## Web Design

- Keep the existing `CanvasSurface` preview shell.
- Add an annotation toolbar to the inline canvas preview with:
  - select
  - pen
  - arrow
  - rectangle
  - text
  - delete selected
  - clear all
- Render annotations through a shared overlay layer component.
- Use structured SVG objects rather than a bitmap-only layer so saved objects
  remain editable.
- Save on commit events:
  - stroke end
  - rectangle end
  - arrow end
  - text commit
  - delete
  - clear

## Interaction Rules

- `select` allows selecting existing objects.
- `pen` creates a freehand stroke.
- `arrow` creates a single straight arrow from drag start to drag end.
- `rect` creates a rectangle from drag start to drag end.
- `text` opens an inline textarea anchored at the click position.
- `Delete` removes the selected object.
- `Clear` removes all objects.

## Rendering Rules

- Annotations render in all canvas views when saved.
- Only the inline editor canvas enables pointer-based editing.
- Overlay coordinates are viewport-relative to the rendered canvas scene.
- The overlay scales together with the existing zoom transform because it lives
  inside the same scaled content tree.

## Risks

- V1 annotations are geometric only, so they do not yet identify specific chart
  elements or Mermaid nodes.
- Large freehand paths may need future point simplification if users draw long
  strokes aggressively.
- The current inline canvas header is outside the annotation scene, so v1
  annotations cover the rendered body, not the page title area.

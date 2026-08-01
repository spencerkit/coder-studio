# Canvas Chart Roadmap Design

> Status: Draft for user review
> Date: 2026-06-28
> Scope: `packages/core`, `packages/server`, `packages/web`, `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`

## Summary

Coder Studio canvas is already useful for architecture diagrams and structured
reports, but it stops short of the higher-density, reusable artifact model that
Cursor-style canvas has moved toward.

This roadmap keeps the existing canvas model intact and extends
`report_canvas` first. The 0-30 day scope is now chart support only. Presets,
immutable snapshots, and clone flows remain explicit 60-90 day follow-up work.

## Problem

Current canvas behavior is intentionally narrow:

- `architecture_canvas` is a Mermaid-backed flow/architecture surface.
- `report_canvas` is a structured document surface with stats, markdown,
  lists, tables, and callouts.
- The web app already renders both, and `echarts` is already available in
  `packages/web`.

What is missing:

- compact trend and comparison charts
- a stable chart schema that agents can generate safely
- reusable templates for common report shapes
- a read-only snapshot path for sharing or replaying a finished canvas

Without those pieces, canvas stays good for summaries and diagrams but cannot
become a durable delivery surface for analysis-heavy artifacts.

## Goals

- Add chart rendering to the existing `report_canvas` family.
- Keep `architecture_canvas` unchanged in this roadmap.
- Keep source file-backed and typed.
- Keep the chart schema deterministic and validation-friendly.
- Reuse existing `echarts` in the web app rather than adding a new chart stack.
- Stage presets, snapshots, and clone flows as a separate 60-90 day phase
  rather than mixing them into the first implementation slice.

## Non-Goals

- No interactive widget runtime.
- No arbitrary JS or HTML inside canvas source.
- No new `analytics_canvas` kind.
- No live data binding or background queries in phase 1.
- No collaboration or permissions system in this roadmap.
- No CRDT, patch, or multi-writer semantics.
- No redesign of `architecture_canvas`.

## Current State

Relevant current files:

- `packages/core/src/domain/canvas.ts` defines the current canvas envelope and
  compiled model.
- `packages/server/src/canvas/validation.ts` validates the current JSON source.
- `packages/server/src/canvas/compiler.ts` compiles architecture and report
  canvases into renderable models.
- `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`
  renders the report surface.
- `packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx`
  renders the architecture surface.
- `packages/web/package.json` already includes `echarts`.
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
  teaches the agent how to author canvases today.

Current behavior is enough for text-heavy summaries and static architecture
flows. Before this work, it did not provide the kind of chart-first report
composition that Cursor public canvas examples imply.

## Direction

### Chosen model

Extend `report_canvas` with a new `chart` block type.

Why this path:

- it keeps the existing canvas taxonomy stable
- it avoids a second report-specific canvas kind
- it matches the current repo structure and renderer split
- it gives us a safe place to add visual density without introducing a runtime
  execution model

### Chart shape

Use a category-based chart schema, not a raw ECharts option pass-through.

Recommended v1 shape:

```json
{
  "type": "chart",
  "kind": "line",
  "title": "Token Consumption",
  "summary": "24 hour prompt and completion token trend",
  "unit": "tokens",
  "categories": ["09:00", "10:00", "11:00"],
  "series": [
    { "name": "Prompt", "values": [1200, 1800, 900] },
    { "name": "Completion", "values": [400, 700, 500] }
  ],
  "showLegend": true
}
```

Approved chart kinds in phase 1:

- `line`
- `bar`
- `sparkline`

The renderer can map these into ECharts, but the source contract stays small and
predictable.

### Rendering rule

Charts are authored as static snapshots of already-known data. The canvas does
not fetch live chart data from external sources at render time.

That keeps authoring simple and avoids turning canvas into a data pipeline.

## Phase 1: 0-30 Days

### Objective

Turn `report_canvas` into a report surface that can show real charts, without
changing the canvas entry model or adding a new artifact kind.

### Deliverables

1. Add `chart` to the report block schema in `packages/core/src/domain/canvas.ts`.
2. Update server validation and compilation to accept chart blocks and enforce
   aligned `categories` / `series.values` lengths.
3. Add a dedicated chart renderer in the web canvas report path.
4. Reuse `echarts` for actual chart drawing, but keep the canvas schema
   framework-owned.
5. Update the canvas skill instructions so agents know when to use chart blocks.
6. Add tests for schema validation, compilation, chart rendering, and embedded
   route rendering.

### File impact

- `packages/core/src/domain/canvas.ts`
- `packages/server/src/canvas/validation.ts`
- `packages/server/src/canvas/compiler.ts`
- `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`
- `packages/web/src/features/canvas/components/report-canvas-chart-renderer.tsx`
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
- `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx`
- `packages/web/src/features/canvas/components/report-canvas-chart-renderer.test.tsx`

### Behavior rules

- `architecture_canvas` remains unchanged.
- `report_canvas` can mix stats, text blocks, and chart blocks in the same
  section tree.
- Chart blocks do not accept raw chart library options.
- Sparkline is a presentation variant of the same chart family, not a separate
  data model.

### Exit criteria

- A real report canvas can render at least one line chart without regressions.
- A real report canvas can also render bar and sparkline variants from the same
  typed block family.
- Existing report block types still render unchanged.
- The embedded canvas route and page route both render chart canvases
  correctly.
- Tooltip content is escaped before returning HTML to the charting library.

### Phase 1 Status

The 0-30 day slice is implemented in the current worktree:

- `report_canvas` now supports `chart` blocks with `line`, `bar`, and
  `sparkline` kinds.
- Core schema validation rejects series/category length mismatches.
- The web renderer delegates chart blocks to a dedicated ECharts-backed
  renderer.
- The built-in `coder-studio-canvas` skill now teaches agents how to author
  chart blocks.
- Focused core, web, server, and build verification has already passed for this
  slice.

Phase 1 does not include presets, snapshots, clone flows, or an interactive
canvas editor.

## Phase 2: 60-90 Days

### Objective

Turn canvases from one-off generated artifacts into reusable delivery units.

### Deliverables

1. Add a small preset/template registry for common canvases.
2. Allow a canvas to be created from a preset instead of hand-authoring the
   entire JSON document.
3. Add an immutable read-only snapshot path for finished canvases.
4. Add duplicate/clone behavior so a user or agent can turn a finished canvas
   into a new working copy.
5. Expand the preset set only after the first templates prove useful.

### Snapshot model

Snapshots are read-only render artifacts.

Recommended snapshot properties:

- snapshot id
- immutable content
- title
- canvas kind
- source hash
- created timestamp
- compiled render model

The important product rule is that a snapshot is view-only. It is not the same
thing as a live editable source file.

### File and route impact

- `packages/server/src/canvas/presets.ts`
- `packages/server/src/storage/repositories/canvas-snapshot-repo.ts`
- `packages/server/src/canvas/service.ts`
- `packages/server/src/commands/canvas.ts`
- `packages/server/src/routes/canvas-snapshots.ts`
- `packages/server/src/app.ts`
- `packages/server/src/server.ts`
- `packages/core/src/domain/canvas.ts`
- `packages/web/src/features/canvas/api.ts`
- `packages/web/src/features/canvas/components/canvas-content.tsx`
- `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.tsx`
- new `canvas.snapshot.create` server command
- new read-only route such as `/embedded/canvas-snapshot/:snapshotId`
- new `GET /api/canvas-snapshots/:snapshotId` data endpoint
- new storage entry for snapshot metadata
- update the canvas skill so agents know how to create presets and open
  snapshots

### Exit criteria

- A finished canvas can be turned into a stable snapshot view.
- A common report shape can be recreated from a preset without retyping the
  whole document.
- Users can duplicate a canvas into a new editable copy.

## Competitive Gap Summary

Cursor-style canvas has already moved toward:

- chart-heavy reports
- reusable canvas patterns
- shareable read-only outputs
- a more general artifact mindset

This roadmap intentionally does not chase full interactive canvas parity. It
focuses on the parts that best fit Coder Studio's existing strengths:

- file-backed artifacts
- typed source
- server-owned compilation
- workspace-local persistence

## Risks

- The chart schema could drift toward raw ECharts complexity.
  - Mitigation: keep the source contract category-based and narrow.
- Template sprawl could make the system feel inconsistent.
  - Mitigation: start with 2-3 presets only.
- Snapshots could diverge from the source if their lifecycle is unclear.
  - Mitigation: store source hash and treat the snapshot as immutable.
- `report_canvas` could grow too large if every visualization lands there.
  - Mitigation: keep `architecture_canvas` separate and do not add a new kind
    unless a future use case truly needs it.

## Testing

0-30 day coverage should include:

- core schema tests for chart validation
- compiler tests for chart normalization
- web renderer tests for line, bar, and sparkline output
- embedded canvas route tests for chart canvases
- skill text tests for the updated canvas guidance

60-90 day coverage should additionally include:

- preset list/create tests at the service and command layers
- snapshot storage and read-only route tests
- clone behavior tests for editable copies from existing canvases or snapshots
- web API and route tests for snapshot fetch/render flows

## Recommendation

Keep the current implementation boundary intact:

- ship the 0-30 day chart extension as the first delivered slice
- do not fold presets, snapshots, clone, or editor work into the same branch
- use the follow-up 60-90 day plan to stage reusable artifact capabilities on
  top of the chart-enabled `report_canvas` base

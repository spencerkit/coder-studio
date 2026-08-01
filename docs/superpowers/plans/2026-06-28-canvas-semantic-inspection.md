# Canvas Semantic Inspection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a typed semantic inspection layer for canvases so users can select rendered elements, attach instruction comments, and return an agent-readable inspection payload that the agent can re-read with `canvas.inspect`.

**Architecture:** Keep `.csc` source files canonical, keep overlay drawing state separate, and add a third companion state for semantic comments. Renderers register scene elements into a `sceneManifest`, the server persists `anchorCommentDocument`, each saved comment carries a semantic `targets` snapshot, and a dedicated `canvas.inspect` payload combines compiled canvas data, overlays, semantic hits, and saved comments.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, ECharts, Mermaid-backed SVG rendering, existing canvas service/storage stack

---

## File Map

- `packages/core/src/domain/canvas.ts`
  Add shared scene manifest and anchor comment schemas, plus the inspection response schema.
- `packages/core/src/domain/canvas.test.ts`
  Lock shared semantic inspection contracts.
- `packages/server/src/storage/repositories/canvas-anchor-comment-repo.ts`
  Persist anchor comment documents by workspace/sourcePath.
- `packages/server/src/storage/index.ts`
  Export the anchor comment repo.
- `packages/server/src/canvas/service.ts`
  Read/save anchor comments and return inspection payloads.
- `packages/server/src/canvas/service.test.ts`
  Cover semantic inspection load/save behavior.
- `packages/server/src/routes/canvas.ts`
  Add the anchor comment save route.
- `packages/server/src/routes/canvas.test.ts`
  Cover the new route and inspection response shape.
- `packages/server/src/commands/canvas.ts`
  Add `canvas.inspect`.
- `packages/server/src/commands/canvas.test.ts`
  Cover semantic inspection command responses.
- `packages/server/src/server.ts`
  Wire the new repo into `CanvasService`.
- `packages/server/src/app.ts`
  Ensure the new route remains mounted through the existing canvas route surface.
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
  Teach agents how to consume semantic inspection payloads and re-run `canvas.inspect` after the user says the canvas changed.
- `packages/web/src/features/canvas/api.ts`
  Add comment save and inspection fetch helpers.
- `packages/web/src/features/canvas/api.test.ts`
  Cover those request helpers.
- `packages/web/src/features/canvas/components/canvas-content.tsx`
  Own the current `sceneManifest` state and pass semantic hooks to renderers and surface overlays.
- `packages/web/src/features/canvas/components/canvas-scene-registry.ts`
  New focused helper for scene manifest collection and normalization.
- `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`
  Register report block-level semantic elements.
- `packages/web/src/features/canvas/components/report-canvas-chart-renderer.tsx`
  Register chart block / series / point semantic elements for line, bar, and sparkline charts.
- `packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx`
  Register Mermaid node/edge semantic elements.
- `packages/web/src/features/canvas/components/canvas-overlay-layer.tsx`
  Render inspect-mode selection highlights and selection rectangle interactions.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
  Add inspect mode and inline comment composition controls.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
  Cover inspect/comment interactions.
- `packages/web/src/locales/en.json`
  Add inspect-mode labels.
- `packages/web/src/locales/zh.json`
  Add inspect-mode labels.
- `packages/web/src/styles/components.css`
  Add inspect-mode and comment-composer styles.

## Final Verification

Run these after all tasks are complete:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts
pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas.test.ts
pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/canvas/components/report-canvas-chart-renderer.test.tsx src/features/canvas/components/report-canvas-renderer.test.tsx
pnpm build
```

Expected: all targeted tests pass and `pnpm build` exits `0`.

## Task 1: Add Shared Semantic Inspection Contracts

**Files:**
- Modify: `packages/core/src/domain/canvas.ts`
- Modify: `packages/core/src/domain/canvas.test.ts`

- [ ] **Step 1: Write the failing core tests**

Add tests that parse:

- a `CanvasSceneManifest`
- a `CanvasAnchorCommentDocument` that includes `targets`
- a `canvas.inspect` style response payload that includes:
  - `compiledDocument`
  - `overlayDocument`
  - `sceneManifest`
  - `anchorCommentDocument`

Comments should persist a semantic snapshot like:

```ts
targets: [
  {
    id: "chart-point:prompt_tokens:10:00",
    kind: "chart-point",
    rect: { x: 112, y: 40, width: 28, height: 24 },
    label: "Prompt at 10:00",
    payload: { seriesName: "Prompt", category: "10:00", value: 1800 },
  },
]
```

Use concrete ids like:

```ts
sceneManifest: {
  version: 1,
  elements: [
    {
      id: "chart-point:prompt_tokens:10:00",
      kind: "chart-point",
      rect: { x: 120, y: 48, width: 12, height: 12 },
      label: "Prompt at 10:00",
      payload: { seriesName: "Prompt", category: "10:00", value: 1800 },
    },
  ],
}
```

- [ ] **Step 2: Run the core test to verify it fails**

Run:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts
```

Expected: FAIL because the semantic inspection schemas do not exist yet.

- [ ] **Step 3: Add the shared schemas**

In `packages/core/src/domain/canvas.ts`, add:

- `CanvasSceneRectSchema`
- `CanvasSceneElementKindSchema`
- `CanvasSceneElementSchema`
- `CanvasSceneManifestSchema`
- `CanvasAnchorCommentSchema`
- `CanvasAnchorCommentDocumentSchema`
- `CanvasInspectionResponseSchema`

Keep these companion-state contracts versioned at `1`, matching the current
overlay document style.

- [ ] **Step 4: Run the core test to verify it passes**

Run:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts
```

Expected: PASS.

## Task 2: Persist Anchor Comment Documents On The Server

**Files:**
- Create: `packages/server/src/storage/repositories/canvas-anchor-comment-repo.ts`
- Modify: `packages/server/src/storage/index.ts`
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/canvas/service.test.ts`
- Modify: `packages/server/src/server.ts`

- [ ] **Step 1: Write the failing server service tests**

Add service tests that verify:

1. saving a `CanvasAnchorCommentDocument` succeeds for an existing canvas source
2. reading inspection data returns the saved anchor comment document
3. missing saved comments fall back to an empty document

Use a concrete comment like:

```ts
{
  version: 1,
  comments: [
    {
      id: "comment-1",
      elementIds: ["chart-point:prompt_tokens:10:00"],
      targets: [
        {
          id: "chart-point:prompt_tokens:10:00",
          kind: "chart-point",
          rect: { x: 112, y: 40, width: 28, height: 24 },
          label: "Prompt at 10:00",
          payload: { seriesName: "Prompt", category: "10:00", value: 1800 },
        },
      ],
      selectionRect: { x: 112, y: 40, width: 28, height: 24 },
      body: "Explain this peak and switch it to warning color.",
      status: "open",
      createdAt: "2026-06-28T10:00:00.000Z",
      updatedAt: "2026-06-28T10:00:00.000Z",
    },
  ],
}
```

- [ ] **Step 2: Run the server service tests to verify they fail**

Run:

```bash
pnpm --dir packages/server exec vitest run src/canvas/service.test.ts
```

Expected: FAIL because the repo and service methods do not exist yet.

- [ ] **Step 3: Add the repo and service wiring**

Implement:

- `CanvasAnchorCommentRepo` with the same storage style and keying pattern used
  by `CanvasOverlayRepo`
- `CanvasService.saveAnchorComments()`
- `CanvasService.getCanvasInspectionData()`

Keep `getCanvasData()` intact; this is additive, not a replacement.

- [ ] **Step 4: Wire the repo into server construction**

Update:

- `packages/server/src/storage/index.ts`
- `packages/server/src/server.ts`

so `CanvasService` receives the new repo.

- [ ] **Step 5: Re-run the server service tests**

Run:

```bash
pnpm --dir packages/server exec vitest run src/canvas/service.test.ts
```

Expected: PASS.

## Task 3: Add HTTP And Command Inspection Surfaces

**Files:**
- Modify: `packages/server/src/routes/canvas.ts`
- Modify: `packages/server/src/routes/canvas.test.ts`
- Modify: `packages/server/src/commands/canvas.ts`
- Modify: `packages/server/src/commands/canvas.test.ts`
- Modify: `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`

- [ ] **Step 1: Write the failing route and command tests**

Add route tests that verify:

- `PUT /api/canvas/:workspaceId/comments?sourcePath=...` saves a
  `CanvasAnchorCommentDocument`

Add command tests that verify:

- `canvas.inspect` returns:
  - `compiledDocument`
  - `overlayDocument`
  - `anchorCommentDocument`
  - `sceneManifest` when available

For phase 1, allow `sceneManifest` to be optional at the server command layer if
the web-side renderer has not yet persisted one. Agents should use the saved
comment `targets` snapshot plus the latest `canvas.inspect` response after the
user says they changed the canvas.

- [ ] **Step 2: Run the route and command tests to verify they fail**

Run:

```bash
pnpm --dir packages/server exec vitest run src/routes/canvas.test.ts src/commands/canvas.test.ts
```

Expected: FAIL because the new route and command do not exist yet.

- [ ] **Step 3: Implement the route and command**

Add:

- a `PUT` route for comment persistence
- a `canvas.inspect` command that delegates to
  `CanvasService.getCanvasInspectionData()`

Update the built-in canvas skill instructions so they mention:

- `canvas.render` for normal rendering
- `canvas.inspect` for semantic selection/comment context

- [ ] **Step 4: Re-run the route and command tests**

Run:

```bash
pnpm --dir packages/server exec vitest run src/routes/canvas.test.ts src/commands/canvas.test.ts
```

Expected: PASS.

## Task 4: Add Web API Helpers For Comments And Inspection

**Files:**
- Modify: `packages/web/src/features/canvas/api.ts`
- Modify: `packages/web/src/features/canvas/api.test.ts`

- [ ] **Step 1: Write the failing web API tests**

Add tests that verify:

- saving anchor comments calls the new `PUT /api/canvas/:workspaceId/comments`
  endpoint
- fetching inspection data calls the new inspection endpoint or command-backed
  route chosen by the implementation

Reuse the existing API test style and fetch mocking patterns already used for
overlay requests.

- [ ] **Step 2: Run the API tests to verify they fail**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts
```

Expected: FAIL because the helpers do not exist yet.

- [ ] **Step 3: Add the API helpers**

Implement:

- `saveCanvasAnchorComments(...)`
- `fetchCanvasInspectionData(...)`

Keep naming aligned with the current `fetchCanvasData(...)` and
`saveCanvasOverlay(...)` helpers.

- [ ] **Step 4: Re-run the API tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts
```

Expected: PASS.

## Task 5: Add A Focused Scene Manifest Registry On The Web

**Files:**
- Create: `packages/web/src/features/canvas/components/canvas-scene-registry.ts`
- Modify: `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`
- Modify: `packages/web/src/features/canvas/components/report-canvas-renderer.test.tsx`

- [ ] **Step 1: Write the failing report-scene tests**

Add renderer tests that verify report block rendering can register semantic
elements for:

- chart blocks at block level
- stat blocks
- callouts
- table cells

The tests should assert ids/kinds, not browser pixel perfection. For example:

- `chart-block:section-0:block-1`
- `table-cell:section-1:block-0:row-2:col-1`

- [ ] **Step 2: Run the report renderer tests to verify they fail**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/report-canvas-renderer.test.tsx
```

Expected: FAIL because no registry/registration path exists yet.

- [ ] **Step 3: Add the scene registry helper and report block registration**

Create a small helper that can:

- collect scene elements
- dedupe by id
- normalize DOM rects into scene-relative coordinates

Update `CanvasContent` and `ReportCanvasRenderer` so block-level report content
can register semantic elements through refs.

- [ ] **Step 4: Re-run the report renderer tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/report-canvas-renderer.test.tsx
```

Expected: PASS.

## Task 6: Add Chart Point And Series Registration

**Files:**
- Modify: `packages/web/src/features/canvas/components/report-canvas-chart-renderer.tsx`
- Modify: `packages/web/src/features/canvas/components/report-canvas-chart-renderer.test.tsx`

- [ ] **Step 1: Write the failing chart semantic tests**

Add tests that verify line/bar/sparkline chart rendering can register:

- one `chart-block`
- one or more `chart-series`
- one or more `chart-point`

Assert stable ids and payload metadata such as:

```ts
{
  id: "chart-point:prompt:10:00",
  kind: "chart-point",
  payload: { seriesName: "Prompt", category: "10:00", value: 1800 },
}
```

- [ ] **Step 2: Run the chart renderer tests to verify they fail**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/report-canvas-chart-renderer.test.tsx
```

Expected: FAIL because the chart renderer does not register semantic elements
yet.

- [ ] **Step 3: Add chart semantic registration**

Use the existing chart renderer integration to derive point-level positions.
Design constraints:

- always register at least a block-level chart element
- register point-level semantic elements only for line/bar/sparkline in this
  phase
- derive ids from series name + category, not random values

- [ ] **Step 4: Re-run the chart renderer tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/report-canvas-chart-renderer.test.tsx
```

Expected: PASS.

## Task 7: Add Mermaid Node And Edge Registration

**Files:**
- Modify: `packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx`
- Add or Modify: focused renderer tests near the architecture canvas renderer if not already present

- [ ] **Step 1: Write the failing architecture semantic tests**

Add tests that verify rendered Mermaid-backed content can register:

- `mermaid-node`
- `mermaid-edge`

The tests should mock or inspect rendered SVG output and assert stable semantic
element ids and kinds.

- [ ] **Step 2: Run the architecture renderer tests to verify they fail**

Run the focused renderer test command for the architecture canvas component.

Expected: FAIL because Mermaid semantic extraction is not implemented yet.

- [ ] **Step 3: Add Mermaid semantic extraction**

Implement a localized helper in the architecture renderer that:

- inspects mounted SVG output
- extracts node/edge DOM bounds
- normalizes them into scene-relative rects

Avoid broad renderer refactors; keep the extraction helper local to this
component.

- [ ] **Step 4: Re-run the architecture renderer tests**

Run the same focused renderer test command.

Expected: PASS.

## Task 8: Add Inspect Mode And Comment Composition UI

**Files:**
- Modify: `packages/web/src/features/canvas/components/canvas-content.tsx`
- Modify: `packages/web/src/features/canvas/components/canvas-overlay-layer.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing inspect-mode UI tests**

Add tests that verify:

1. the annotation toolbar includes an inspect-mode button
2. clicking a semantic scene element in inspect mode selects it
3. entering a comment and committing it calls `saveCanvasAnchorComments(...)`

Use a concrete expectation like:

```ts
expect(saveCanvasAnchorComments).toHaveBeenCalledWith(
  "ws-1",
  ".coder-studio/canvases/runtime-flow.csc",
  expect.objectContaining({
    comments: [
      expect.objectContaining({
        elementIds: ["chart-point:prompt:10:00"],
        body: "Explain this peak",
      }),
    ],
  })
);
```

- [ ] **Step 2: Run the canvas surface tests to verify they fail**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: FAIL because inspect mode and comment composition do not exist yet.

- [ ] **Step 3: Implement inspect mode with the smallest UI**

Add:

- an `inspect` tool in `CanvasSurface`
- selection highlight behavior in `CanvasOverlayLayer`
- a small inline composer for comment text
- save behavior through `saveCanvasAnchorComments(...)`

Phase 1 constraints:

- single selection is sufficient for the first passing slice
- multi-select drag can be deferred unless it falls out cheaply
- do not redesign the whole surface into a panel-based inspector

- [ ] **Step 4: Add the new strings and styles**

Update:

- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`
- `packages/web/src/styles/components.css`

with inspect/comment labels and modest surface styling.

- [ ] **Step 5: Re-run the canvas surface tests**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: PASS.

## Task 9: Final Regression Verification

**Files:**
- No new files; verification only

- [ ] **Step 1: Run all targeted package tests**

Run:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts
pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas.test.ts
pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/canvas/components/report-canvas-chart-renderer.test.tsx src/features/canvas/components/report-canvas-renderer.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the full build**

Run:

```bash
pnpm build
```

Expected: exit `0`. Existing unrelated warnings may remain, but new failures are
not acceptable.

- [ ] **Step 3: Review the implementation boundary**

Confirm the delivered slice includes only:

- scene manifest contracts
- anchor comment persistence
- inspect-mode comment flow
- `canvas.inspect`

Confirm it does **not** expand into:

- full design-mode property editing
- undo/redo
- multi-user sync
- mandatory screenshot export
- snapshot/share UI work

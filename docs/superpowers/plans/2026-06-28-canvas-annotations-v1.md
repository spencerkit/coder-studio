# Canvas Annotations V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistent structured annotations to canvas previews without changing `.csc` source semantics.

**Architecture:** Keep canvas source files canonical and persist a separate overlay document keyed by `workspaceId + sourcePath`. The server exposes overlay save/read through the existing canvas service, and the web inline canvas preview renders an editable SVG overlay with a small annotation toolbar.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, existing canvas service/storage

---

## File Map

- `packages/core/src/domain/canvas.ts`
  Add shared overlay schemas and attach overlay payloads to canvas render data.
- `packages/core/src/domain/canvas.test.ts`
  Lock shared overlay contracts.
- `packages/server/src/storage/repositories/canvas-overlay-repo.ts`
  Persist overlay documents by workspace/sourcePath.
- `packages/server/src/storage/index.ts`
  Export the new overlay repo.
- `packages/server/src/canvas/service.ts`
  Read and save overlay documents, and include them in render payloads.
- `packages/server/src/canvas/service.test.ts`
  Cover overlay save/load behavior.
- `packages/server/src/routes/canvas.ts`
  Add the HTTP save route.
- `packages/server/src/routes/canvas.test.ts`
  Cover overlay save route and render payload shape.
- `packages/server/src/server.ts`
  Wire the overlay repo into `CanvasService`.
- `packages/server/src/commands/canvas.ts`
  Return full render payloads from `canvas.render`.
- `packages/server/src/commands/canvas.test.ts`
  Cover command-level overlay visibility.
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
  Note that `canvas.render` includes overlay annotations when present.
- `packages/web/src/features/canvas/api.ts`
  Add overlay save support.
- `packages/web/src/features/canvas/api.test.ts`
  Cover overlay save requests.
- `packages/web/src/features/canvas/components/canvas-content.tsx`
  Render the overlay layer and save changes in edit mode.
- `packages/web/src/features/canvas/components/canvas-overlay-layer.tsx`
  New overlay rendering and editing component.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
  Add the annotation toolbar and pass edit state into `CanvasContent`.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
  Cover toolbar rendering and an annotation save interaction.
- `packages/web/src/locales/en.json`
  Add annotation labels.
- `packages/web/src/locales/zh.json`
  Add annotation labels.
- `packages/web/src/styles/components.css`
  Add canvas annotation toolbar and overlay styles.

## Final Verification

Run these after all tasks are complete:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts
pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas.test.ts
pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx
pnpm build
```

Expected: all targeted tests pass and `pnpm build` exits `0`.

## Task 1: Add Shared Overlay Contracts

- [ ] Add `CanvasOverlayDocumentSchema` and overlay object schemas in `packages/core/src/domain/canvas.ts`.
- [ ] Extend `CanvasDataResponseSchema` to accept `overlayDocument`.
- [ ] Add core tests for overlay parsing and render response parsing.

## Task 2: Persist Overlay State On The Server

- [ ] Create `CanvasOverlayRepo`.
- [ ] Extend `CanvasService` to read and save overlay documents.
- [ ] Add `PUT /api/canvas/:workspaceId/annotations` route coverage.
- [ ] Return full render payloads from `canvas.render`.

## Task 3: Add Web Annotation Editing

- [ ] Add a structured SVG overlay layer component.
- [ ] Add inline annotation toolbar controls to `CanvasSurface`.
- [ ] Save overlay changes through the new API.
- [ ] Render saved overlays in read-only canvas views.

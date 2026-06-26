# Canvas File-First Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate canvas from an artifact-first `canvasId` render model to a file-first `.csc` document model where normal file opens render the canvas by `sourcePath`.

**Architecture:** Keep the existing canvas repo and `canvasId` command compatibility shims only where they are still useful for `canvas.list`, `canvas.update`, and `ui open-canvas`, but move steady-state rendering, tab identity, route addressing, and default open behavior to `workspaceId + sourcePath`. The server will create readable `.csc` files from meaningful titles, the web editor will treat `.csc` as a renderable document type with a path-addressed canvas tab, and rename/delete flows will rewrite or close those tabs the same way normal file state already does.

**Tech Stack:** TypeScript, Zod, Fastify, React 19, Jotai, Vitest, Testing Library

---

## File Map

- `packages/server/src/canvas/source-path.ts`
  Creates readable `.csc` source paths from canvas titles and handles collision suffixes locally inside the canvas subsystem.
- `packages/server/src/canvas/service.ts`
  Owns canvas create, update, render, repo sync, and source-file reads. This becomes the main file-first server entry.
- `packages/server/src/storage/repositories/canvas-repo.ts`
  Keeps compatibility metadata for list/update/open-canvas and gains path rewrite/delete helpers for generic file rename/delete.
- `packages/server/src/commands/canvas.ts`
  Keeps command compatibility, but makes `canvas.render` resolve to `sourcePath` first and emits canonical path-based `canvas.open`.
- `packages/server/src/commands/ui-actions.ts`
  Resolves legacy `canvas.open` requests by `canvasId` and rebroadcasts canonical file-first metadata.
- `packages/server/src/routes/canvas.ts`
  Switches the canvas API from `/:canvasId/data` to `/data?sourcePath=...`.
- `packages/server/src/commands/file.ts`
  Calls canvas repo sync hooks after generic file rename/delete so compatibility records do not drift.
- `packages/core/src/domain/canvas.ts`
  Shared render response contract; this must stop requiring `canvasId` for runtime rendering and must carry `sourcePath`.
- `packages/core/src/domain/types.ts`
  Shared workspace tab contract; the canvas editor tab becomes path-addressed.
- `packages/core/src/domain/ui-actions.ts`
  Shared UI action contract; `canvas.open` becomes canonicalized around `sourcePath`.
- `packages/web/src/features/workspace/atoms/files.ts`
  Adds `.csc` classification, path-based canvas tab construction, normalization, and refresh-token keys.
- `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`
  Intercepts `.csc` from ordinary file-open flows and opens a render tab instead of a text file tab.
- `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
  Opens or replaces canvas tabs by `sourcePath`, not `canvasId`.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
  Refreshes and embeds canvases by `sourcePath`.
- `packages/web/src/features/canvas/api.ts`
  Fetches canvas data by query `sourcePath`.
- `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`
  Reads `sourcePath` from search params and renders the embedded canvas.
- `packages/web/src/features/workspace/actions/open-editor-state.ts`
  Normalizes persisted canvas tabs by `sourcePath`.
- `packages/web/src/features/workspace/actions/use-file-actions.ts`
  Rewrites or closes canvas tabs during file rename/delete.
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
  Updates builtin skill guidance to require meaningful titles and to open existing canvases through normal `.csc` file flows.

## Final Verification

Run these after all tasks are complete:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts src/domain/ui-actions.test.ts src/domain/types.test.ts
pnpm --dir packages/server exec vitest run src/canvas/source-path.test.ts src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas.test.ts src/__tests__/ui-actions-commands.test.ts src/__tests__/file-commands.test.ts src/storage/repositories/canvas-repo.test.ts src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts
pnpm --dir packages/web exec vitest run src/features/workspace/atoms/files.test.ts src/features/workspace/actions/open-editor-state.test.ts src/features/workspace/actions/use-open-workspace-file.test.tsx src/features/workspace/actions/use-file-actions.test.tsx src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx src/features/ui-actions/use-ui-action-subscription.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/canvas/routes/embedded-canvas-route.test.tsx src/app.test.tsx src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx
pnpm ci:verify
```

Expected: all targeted tests pass, then `pnpm ci:verify` exits `0`.

### Task 1: Create Readable `.csc` Source Paths From Canvas Titles

**Files:**
- Create: `packages/server/src/canvas/source-path.ts`
- Create: `packages/server/src/canvas/source-path.test.ts`
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/canvas/service.test.ts`
- Test: `packages/server/src/canvas/source-path.test.ts`
- Test: `packages/server/src/canvas/service.test.ts`

- [ ] **Step 1: Write the failing slug and create-path tests**

Add a focused helper test file:

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCanvasSourcePath, slugifyCanvasTitle } from "./source-path.js";

describe("canvas source paths", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("slugifies meaningful canvas titles into readable file names", () => {
    expect(slugifyCanvasTitle("Runtime Request Flow")).toBe("runtime-request-flow");
    expect(slugifyCanvasTitle(" Workspace Audit Summary ")).toBe("workspace-audit-summary");
  });

  it("allocates .csc file names and appends numeric suffixes on collision", () => {
    tempDir = mkdtempSync(join(tmpdir(), "canvas-source-path-"));
    mkdirSync(join(tempDir, ".coder-studio", "canvases"), { recursive: true });
    writeFileSync(
      join(tempDir, ".coder-studio", "canvases", "runtime-request-flow.csc"),
      "{}\n"
    );

    expect(
      createCanvasSourcePath({
        workspaceRootPath: tempDir,
        title: "Runtime Request Flow",
      })
    ).toBe(".coder-studio/canvases/runtime-request-flow-2.csc");
  });
});
```

Extend `packages/server/src/canvas/service.test.ts` so create now expects a readable `.csc` path:

```ts
    expect(result.record.title).toBe("Runtime Flow");
    expect(result.record.sourcePath).toBe(".coder-studio/canvases/runtime-flow.csc");
```

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/canvas/source-path.test.ts src/canvas/service.test.ts`

Expected: FAIL because `source-path.ts` does not exist and `CanvasService.create()` still writes `<canvas-id>.canvas.json`.

- [ ] **Step 3: Add the source-path helper and switch create to `.csc`**

Create `packages/server/src/canvas/source-path.ts`:

```ts
import { existsSync } from "node:fs";
import { join } from "node:path";

export function slugifyCanvasTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function createCanvasSourcePath(input: {
  workspaceRootPath: string;
  title: string;
}): string {
  const slug = slugifyCanvasTitle(input.title);
  if (!slug) {
    throw { code: "invalid_canvas_title", message: "Canvas title must produce a valid file name" };
  }

  let suffix = 0;
  while (true) {
    const fileName = suffix === 0 ? `${slug}.csc` : `${slug}-${suffix + 1}.csc`;
    const sourcePath = `.coder-studio/canvases/${fileName}`;
    if (!existsSync(join(input.workspaceRootPath, sourcePath))) {
      return sourcePath;
    }
    suffix += 1;
  }
}
```

Update the create path in `packages/server/src/canvas/service.ts`:

```ts
import { createCanvasSourcePath } from "./source-path.js";

// inside CanvasService.create()
    const timestamp = this.now();
    const canvasId = createCanvasId(timestamp);
    const sourcePath = createCanvasSourcePath({
      workspaceRootPath: input.workspaceRootPath,
      title: input.title,
    });
```

Do not change the internal `canvasId` record generation in this task; it remains a compatibility identifier.

- [ ] **Step 4: Run the server tests to verify they pass**

Run: `pnpm --dir packages/server exec vitest run src/canvas/source-path.test.ts src/canvas/service.test.ts`

Expected: PASS with `.coder-studio/canvases/<slug>.csc` paths.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/canvas/source-path.ts packages/server/src/canvas/source-path.test.ts packages/server/src/canvas/service.ts packages/server/src/canvas/service.test.ts
git commit -m "feat: create canvases as readable csc files"
```

### Task 2: Move Shared Contracts to Source-Path-First Canvas Identity

**Files:**
- Modify: `packages/core/src/domain/canvas.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/core/src/domain/ui-actions.ts`
- Modify: `packages/core/src/domain/canvas.test.ts`
- Modify: `packages/core/src/domain/types.test.ts`
- Modify: `packages/core/src/domain/ui-actions.test.ts`
- Test: `packages/core/src/domain/canvas.test.ts`
- Test: `packages/core/src/domain/types.test.ts`
- Test: `packages/core/src/domain/ui-actions.test.ts`

- [ ] **Step 1: Write the failing shared-contract tests**

Add a response-shape assertion in `packages/core/src/domain/canvas.test.ts`:

```ts
  it("requires sourcePath for canvas render responses", () => {
    expect(() =>
      CanvasDataResponseSchema.parse({
        workspaceId: "ws-1",
        title: "Runtime Flow",
        kind: "architecture_canvas",
        renderStatus: "ready",
        lastError: null,
        compiledDocument: {
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [],
        },
      })
    ).toThrow();

    expect(
      CanvasDataResponseSchema.parse({
        workspaceId: "ws-1",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        kind: "architecture_canvas",
        renderStatus: "ready",
        lastError: null,
        compiledDocument: {
          kind: "architecture_canvas",
          title: "Runtime Flow",
          summary: "How requests move.",
          sections: [],
        },
      })
    ).toMatchObject({
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });
  });
```

Add a type assertion in `packages/core/src/domain/types.test.ts`:

```ts
import type { WorkspaceCanvasEditorTab } from "./types";

describe("WorkspaceCanvasEditorTab", () => {
  it("is keyed by sourcePath instead of requiring canvasId", () => {
    expectTypeOf<WorkspaceCanvasEditorTab>().toEqualTypeOf<{
      kind: "canvas";
      id: string;
      title: string;
      sourcePath: string;
      artifactType?: "architecture_canvas" | "report_canvas";
      canvasId?: string;
    }>();
  });
});
```

Update `packages/core/src/domain/ui-actions.test.ts` with a canonical file-first `canvas.open` case:

```ts
    expect(
      validateUiActionIntent({
        type: "canvas.open",
        workspaceId: "ws-1",
        title: " Runtime Flow ",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      })
    ).toEqual({
      type: "canvas.open",
      workspaceId: "ws-1",
      title: "Runtime Flow",
      artifactType: "architecture_canvas",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });
```

Keep one compatibility case with `canvasId` only in the same test file.

- [ ] **Step 2: Run the core tests to verify they fail**

Run: `pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts src/domain/types.test.ts src/domain/ui-actions.test.ts`

Expected: FAIL because `CanvasDataResponseSchema` does not require `sourcePath`, `WorkspaceCanvasEditorTab` still requires `canvasId`, and `canvas.open` still rejects the canonical path-based payload.

- [ ] **Step 3: Update the shared contracts**

In `packages/core/src/domain/canvas.ts`, change the response shape:

```ts
export const CanvasDataResponseSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    sourcePath: z.string().trim().min(1),
    canvasId: z.string().trim().min(1).optional(),
    title: z.string().trim().min(1),
    kind: CanvasArtifactKind,
    renderStatus: z.enum(["ready", "error"]),
    lastError: CanvasRenderErrorSchema.nullable().optional(),
    compiledDocument: CompiledCanvasSchema.optional(),
  })
```

In `packages/core/src/domain/types.ts`, change the tab contract:

```ts
export interface WorkspaceCanvasEditorTab {
  kind: "canvas";
  id: string;
  title: string;
  sourcePath: string;
  artifactType?: "architecture_canvas" | "report_canvas";
  canvasId?: string;
}
```

In `packages/core/src/domain/ui-actions.ts`, make canonical `canvas.open` path-first while preserving `canvasId` as an optional compatibility field:

```ts
export type CanvasOpenUiActionIntent = {
  type: "canvas.open";
  workspaceId?: string;
  title: string;
  artifactType: CanvasArtifactKind;
  sourcePath: string;
  canvasId?: string;
};

export type CanvasOpenUiActionDispatchIntent = {
  type: "canvas.open";
  workspaceId?: string;
  canvasId?: string;
  title?: string;
  artifactType?: CanvasArtifactKind;
  sourcePath?: string;
};
```

Update `validateUiActionIntent()` so it accepts either:

```ts
      const hasCanvasId = typeof intent.canvasId === "string" && intent.canvasId.trim().length > 0;
      const hasMetadata =
        intent.title !== undefined &&
        intent.artifactType !== undefined &&
        intent.sourcePath !== undefined;

      if (!hasCanvasId && !hasMetadata) {
        throw new Error("canvas.open requires canvasId or sourcePath metadata");
      }
```

- [ ] **Step 4: Run the core tests to verify they pass**

Run: `pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts src/domain/types.test.ts src/domain/ui-actions.test.ts`

Expected: PASS with source-path-first contracts.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/canvas.ts packages/core/src/domain/types.ts packages/core/src/domain/ui-actions.ts packages/core/src/domain/canvas.test.ts packages/core/src/domain/types.test.ts packages/core/src/domain/ui-actions.test.ts
git commit -m "feat: make shared canvas contracts source-path first"
```

### Task 3: Make Server Render, Routes, and Canonical `canvas.open` File-First

**Files:**
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/commands/canvas.ts`
- Modify: `packages/server/src/commands/ui-actions.ts`
- Modify: `packages/server/src/routes/canvas.ts`
- Modify: `packages/server/src/commands/canvas.test.ts`
- Modify: `packages/server/src/routes/canvas.test.ts`
- Modify: `packages/server/src/__tests__/ui-actions-commands.test.ts`
- Test: `packages/server/src/commands/canvas.test.ts`
- Test: `packages/server/src/routes/canvas.test.ts`
- Test: `packages/server/src/__tests__/ui-actions-commands.test.ts`

- [ ] **Step 1: Write the failing server path-first tests**

Update `packages/server/src/routes/canvas.test.ts` to use query `sourcePath`:

```ts
    const response = await app.inject({
      method: "GET",
      url: "/api/canvas/ws-1/data?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
    });

    expect(getCanvasData).toHaveBeenCalledWith({
      workspaceId: "ws-1",
      workspaceRootPath: "/workspace",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });
```

Update `packages/server/src/commands/canvas.test.ts` so `canvas.render` asserts a file-first response:

```ts
    const renderResult = await dispatch(
      command("canvas.render", {
        workspaceId: "ws-1",
        sourcePath: created.record.sourcePath,
      }),
      ctx
    );

    expect(renderResult.ok).toBe(true);
    expect(renderResult.data).toEqual({
      sourcePath: created.record.sourcePath,
      canvasId: created.record.id,
      renderStatus: "ready",
      lastError: null,
    });
```

Update `packages/server/src/__tests__/ui-actions-commands.test.ts` so canonical `canvas.open` expectations assert `sourcePath` and do not require the caller to supply metadata.

- [ ] **Step 2: Run the server tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/commands/canvas.test.ts src/routes/canvas.test.ts src/__tests__/ui-actions-commands.test.ts`

Expected: FAIL because the route still expects `:canvasId`, `canvas.render` still returns `canvasId`-only output, and canonical UI action handling is still id-first.

- [ ] **Step 3: Update the service, command, and route flow**

In `packages/server/src/canvas/service.ts`, render directly from the source file instead of requiring a repo hit:

```ts
  async getCanvasData(input: {
    workspaceId: string;
    workspaceRootPath: string;
    sourcePath: string;
  }): Promise<CanvasDataResponse> {
    const sourceRead = await readFile(input.workspaceId, input.workspaceRootPath, input.sourcePath);
    if (sourceRead.kind !== "text") {
      throw { code: "canvas_source_invalid", message: "Canvas source must be a text file" };
    }

    const validated = validateCanvasSource(sourceRead.content);
    const fallbackTitle = input.sourcePath.split("/").pop() ?? input.sourcePath;
    if (!validated.ok) {
      return {
        workspaceId: input.workspaceId,
        sourcePath: input.sourcePath,
        title: fallbackTitle,
        kind: "architecture_canvas",
        renderStatus: "error",
        lastError: validated.error,
      };
    }

    const record = this.getRecordBySourcePath(input.workspaceId, input.sourcePath);
    const compiledDocument = compileCanvasDocument(validated.document);

    return {
      workspaceId: input.workspaceId,
      sourcePath: input.sourcePath,
      ...(record ? { canvasId: record.id } : {}),
      title: validated.document.title,
      kind: validated.document.kind,
      renderStatus: "ready",
      lastError: null,
      compiledDocument,
    };
  }
```

In `packages/server/src/commands/canvas.ts`, keep `canvasId` as a compatibility input but resolve to `sourcePath` before rendering:

```ts
    const sourcePath =
      args.sourcePath ?? canvasService.getRecord(args.workspaceId, args.canvasId ?? "")?.sourcePath;

    if (!sourcePath) {
      throw {
        code: "canvas_not_found",
        message: `Canvas not found: ${args.canvasId ?? args.sourcePath ?? "unknown"}`,
      };
    }

    const result = await canvasService.getCanvasData({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sourcePath,
    });

    return {
      sourcePath: result.sourcePath,
      ...(result.canvasId ? { canvasId: result.canvasId } : {}),
      renderStatus: result.renderStatus,
      lastError: result.lastError ?? null,
    };
```

In `packages/server/src/routes/canvas.ts`, switch to query-based addressing:

```ts
  app.get("/api/canvas/:workspaceId/data", async (request, reply) => {
    const { workspaceId } = request.params as { workspaceId: string };
    const { sourcePath } = request.query as { sourcePath?: string };

    if (!sourcePath) {
      return reply.status(400).send({ error: "source_path_required" });
    }

    const data = await deps.canvasService.getCanvasData({
      workspaceId,
      workspaceRootPath: workspace.path,
      sourcePath,
    });

    return reply.send(data);
  });
```

In `packages/server/src/commands/ui-actions.ts`, first relax the server dispatch schema so `canvasId` is optional for path-first callers:

```ts
  z.object({
    type: z.literal("canvas.open"),
    workspaceId: z.string().optional(),
    canvasId: z.string().optional(),
    title: z.string().optional(),
    artifactType: z.enum(["architecture_canvas", "report_canvas"]).optional(),
    sourcePath: z.string().optional(),
  }),
```

Then canonicalize `canvas.open` to file metadata:

```ts
          const sourcePath =
            request.intent.sourcePath ??
            ctx.canvasService?.getRecord(workspaceId, request.intent.canvasId ?? "")?.sourcePath;
          if (!sourcePath) {
            throw {
              code: "canvas_not_found",
              message: `Canvas not found: ${request.intent.canvasId ?? "unknown"}`,
            };
          }

          const data = await ctx.canvasService.getCanvasData({
            workspaceId,
            workspaceRootPath: workspace.path,
            sourcePath,
          });

          return {
            ...request,
            intent: {
              type: "canvas.open" as const,
              workspaceId,
              sourcePath: data.sourcePath,
              title: data.title,
              artifactType: data.kind,
              ...(data.canvasId ? { canvasId: data.canvasId } : {}),
            },
          };
```

- [ ] **Step 4: Run the server tests to verify they pass**

Run: `pnpm --dir packages/server exec vitest run src/commands/canvas.test.ts src/routes/canvas.test.ts src/__tests__/ui-actions-commands.test.ts`

Expected: PASS with query-based render routes and canonical path-first `canvas.open`.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/canvas/service.ts packages/server/src/commands/canvas.ts packages/server/src/commands/ui-actions.ts packages/server/src/routes/canvas.ts packages/server/src/commands/canvas.test.ts packages/server/src/routes/canvas.test.ts packages/server/src/__tests__/ui-actions-commands.test.ts
git commit -m "feat: render canvases by source path"
```

### Task 4: Make Web Canvas Tabs, Fetching, and Embedded Routes Path-Based

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/files.ts`
- Modify: `packages/web/src/features/workspace/actions/open-editor-state.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Modify: `packages/web/src/features/canvas/api.ts`
- Modify: `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`
- Modify: `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx`
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/app.test.tsx`
- Modify: `packages/web/src/features/workspace/atoms/files.test.ts`
- Modify: `packages/web/src/features/workspace/actions/open-editor-state.test.ts`
- Test: `packages/web/src/features/workspace/atoms/files.test.ts`
- Test: `packages/web/src/features/workspace/actions/open-editor-state.test.ts`
- Test: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Test: `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx`
- Test: `packages/web/src/app.test.tsx`

- [ ] **Step 1: Write the failing web path-based tests**

Update `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx` to render a path-keyed canvas tab without `canvasId`:

```ts
        <CanvasSurface
          workspaceId="ws-1"
          tab={{
            kind: "canvas",
            id: "canvas:.coder-studio/canvases/runtime-flow.csc",
            title: "Runtime Flow",
            sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          }}
        />
```

Then assert:

```ts
    expect(frame).toHaveAttribute(
      "src",
      "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc&refresh=0"
    );
```

Update the refresh assertion:

```ts
      expect(dispatch).toHaveBeenCalledWith(
        "canvas.render",
        {
          workspaceId: "ws-1",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        },
        undefined
      );
```

Update the refresh-token assertion in the same test:

```ts
      expect(
        store.get(
          canvasRefreshTokenAtomFamily({
            workspaceId: "ws-1",
            sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          })
        )
      ).toBe(1);
```

Update `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx` to mount:

```tsx
      <MemoryRouter
        initialEntries={[
          "/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc",
        ]}
      >
        <Routes>
          <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
        </Routes>
      </MemoryRouter>
```

and assert:

```ts
    expect(fetchCanvasDataMock).toHaveBeenCalledWith(
      "ws-1",
      ".coder-studio/canvases/runtime-flow.csc"
    );
```

Update `packages/web/src/app.test.tsx` so the embedded canvas route test uses `/embedded/canvas/ws-1?sourcePath=.coder-studio%2Fcanvases%2Fruntime-flow.csc`.

Add a new normalization test in `packages/web/src/features/workspace/atoms/files.test.ts`:

```ts
  it("deduplicates canvas tabs by sourcePath", () => {
    expect(
      normalizeWorkspaceEditorTabs([
        {
          kind: "canvas",
          id: "canvas:.coder-studio/canvases/runtime-flow.csc",
          title: "Runtime Flow",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        },
        {
          kind: "canvas",
          id: "canvas:legacy-id",
          title: "Runtime Flow",
          sourcePath: ".coder-studio/canvases/runtime-flow.csc",
          canvasId: "canvas-1",
        },
      ])
    ).toHaveLength(1);
  });
```

- [ ] **Step 2: Run the web tests to verify they fail**

Run: `pnpm --dir packages/web exec vitest run src/features/workspace/atoms/files.test.ts src/features/workspace/actions/open-editor-state.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/canvas/routes/embedded-canvas-route.test.tsx src/app.test.tsx`

Expected: FAIL because the web still keys tabs and fetch URLs by `canvasId`.

- [ ] **Step 3: Add path-based canvas helpers and route/query handling**

In `packages/web/src/features/workspace/atoms/files.ts`, add file-type helpers and a tab factory:

```ts
const CANVAS_SOURCE_EXTENSION_PATTERN = /\.csc$/i;

export function isCanvasSourcePath(path: string): boolean {
  return CANVAS_SOURCE_EXTENSION_PATTERN.test(path);
}

function deriveCanvasTabTitle(sourcePath: string): string {
  const fileName = sourcePath.split("/").pop() ?? sourcePath;
  return fileName.replace(/\.csc$/i, "");
}

export function createWorkspaceCanvasEditorTab(input: {
  sourcePath: string;
  title?: string;
  artifactType?: "architecture_canvas" | "report_canvas";
  canvasId?: string;
}): WorkspaceCanvasEditorTab {
  const sourcePath = input.sourcePath.trim();
  return {
    kind: "canvas",
    id: `canvas:${sourcePath}`,
    title: input.title?.trim() || deriveCanvasTabTitle(sourcePath),
    sourcePath,
    ...(input.artifactType ? { artifactType: input.artifactType } : {}),
    ...(input.canvasId ? { canvasId: input.canvasId } : {}),
  };
}
```

Also switch canvas normalization and dedupe to `sourcePath`, and change the refresh token key:

```ts
export interface CanvasRefreshTokenKey {
  workspaceId: string;
  sourcePath: string;
}

export const canvasRefreshTokenAtomFamily = atomFamily(
  (_key: CanvasRefreshTokenKey) => atom<number>(0),
  (left, right) => left.workspaceId === right.workspaceId && left.sourcePath === right.sourcePath
);
```

In `packages/web/src/features/canvas/api.ts`, fetch by query:

```ts
export async function fetchCanvasData(
  workspaceId: string,
  sourcePath: string
): Promise<CanvasDataResponse> {
  const query = new URLSearchParams({ sourcePath });
  const response = await fetch(`/api/canvas/${encodeURIComponent(workspaceId)}/data?${query}`, {
    credentials: "include",
  });

  return readJson(response);
}
```

In `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`, read `sourcePath` from `useSearchParams()` and update the missing-param error string:

```ts
  const { workspaceId } = useParams<{ workspaceId: string }>();
  const [searchParams] = useSearchParams();
  const sourcePath = searchParams.get("sourcePath");

  if (!workspaceId || !sourcePath) {
    setData(null);
    setError("Canvas route is missing workspace or source path.");
    setLoading(false);
    return;
  }
```

In `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`, key everything by `sourcePath`:

```ts
  const refreshToken = useAtomValue(
    canvasRefreshTokenAtomFamily({ workspaceId, sourcePath: tab.sourcePath })
  );
  const setRefreshToken = useSetAtom(
    canvasRefreshTokenAtomFamily({ workspaceId, sourcePath: tab.sourcePath })
  );

  if (!tab.sourcePath.trim()) {
    return (
      <EmptyState
        className="git-diff-empty"
        title={<p className="git-diff-empty-title">{t("code_editor.preview_unavailable")}</p>}
      />
    );
  }

  const handleRefresh = () => {
    void dispatch<{ renderStatus: string; lastError: unknown | null }>("canvas.render", {
      workspaceId,
      sourcePath: tab.sourcePath,
    }).then((result) => {
      if (!result.ok) {
        return;
      }
      setRefreshToken((current) => current + 1);
    });
  };

  const src = `/embedded/canvas/${encodeURIComponent(workspaceId)}?sourcePath=${encodeURIComponent(tab.sourcePath)}&refresh=${encodeURIComponent(String(refreshToken))}`;
```

In `packages/web/src/app.tsx`, change the route:

```tsx
        <Route path="/embedded/canvas/:workspaceId" element={<EmbeddedCanvasRoute />} />
```

- [ ] **Step 4: Run the web tests to verify they pass**

Run: `pnpm --dir packages/web exec vitest run src/features/workspace/atoms/files.test.ts src/features/workspace/actions/open-editor-state.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/canvas/routes/embedded-canvas-route.test.tsx src/app.test.tsx`

Expected: PASS with source-path-based embedded canvas routes.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/workspace/atoms/files.ts packages/web/src/features/workspace/actions/open-editor-state.ts packages/web/src/features/code-editor/views/shared/canvas-surface.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx packages/web/src/features/canvas/api.ts packages/web/src/features/canvas/routes/embedded-canvas-route.tsx packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx packages/web/src/app.tsx packages/web/src/app.test.tsx packages/web/src/features/workspace/atoms/files.test.ts packages/web/src/features/workspace/actions/open-editor-state.test.ts
git commit -m "feat: key canvas tabs and embedded routes by source path"
```

### Task 5: Open `.csc` Files Into Render Tabs by Default

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`
- Modify: `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Modify: `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
- Modify: `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`
- Test: `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx`
- Test: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Test: `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`
- Test: `packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`

- [ ] **Step 1: Write the failing `.csc` open tests**

Add a new test in `packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx`:

```ts
  it("opens csc files as canvas tabs instead of text file tabs", async () => {
    const sendCommand = vi.fn().mockResolvedValue({
      id: "ws-test",
      path: "/workspace",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: {
        leftPanelWidth: 280,
        bottomPanelHeight: 200,
        focusMode: false,
      },
    });

    const store = createStore();
    seedWorkspace(store);
    store.set(wsClientAtom, { sendCommand } as never);

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile({
        workspaceId: "ws-test",
        path: ".coder-studio/canvases/runtime-flow.csc",
        source: "manual",
      });
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBeNull();
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([]);
    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/runtime-flow.csc",
        title: "runtime-flow",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
    ]);
  });
```

Add a source-view override test in the same file:

```ts
  it("opens csc files as text when source view is explicitly requested", async () => {
    const store = createStore();
    seedWorkspace(store);

    const { result } = renderHook(() => useOpenWorkspaceFile("ws-test"), {
      wrapper: wrapperFor(store),
    });

    await act(async () => {
      await result.current.openWorkspaceFile(
        {
          workspaceId: "ws-test",
          path: ".coder-studio/canvases/runtime-flow.csc",
          source: "manual",
        },
        { preferCanvasRender: false }
      );
    });

    expect(store.get(activeFilePathAtomFamily("ws-test"))).toBe(
      ".coder-studio/canvases/runtime-flow.csc"
    );
    expect(store.get(openEditorPathsAtomFamily("ws-test"))).toEqual([
      ".coder-studio/canvases/runtime-flow.csc",
    ]);
  });
```

Update `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx` so `canvas.open` expectations key by `sourcePath`:

```ts
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
        canvasId: "canvas-1",
      },
```

Update `packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx` so the shared `canvasTab` fixture uses `id: "canvas:.coder-studio/canvases/runtime-flow.csc"` and no assertion depends on `canvasId`.

Update `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx` so `Open Source` explicitly requests source view:

```ts
    expect(openWorkspaceFileMock).toHaveBeenCalledWith(
      {
        workspaceId: "ws-1",
        path: ".coder-studio/canvases/runtime-flow.csc",
        source: "manual",
      },
      { preferCanvasRender: false }
    );
```

- [ ] **Step 2: Run the web tests to verify they fail**

Run: `pnpm --dir packages/web exec vitest run src/features/workspace/actions/use-open-workspace-file.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/ui-actions/use-ui-action-subscription.test.tsx src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`

Expected: FAIL because `.csc` still opens as a normal file and canvas tabs are still replaced by `canvasId`.

- [ ] **Step 3: Intercept `.csc` opens by default, but preserve explicit source opens**

In `packages/web/src/features/workspace/actions/use-open-workspace-file.ts`, intercept before the regular `openLocation()` flow:

```ts
interface OpenWorkspaceFileOptions {
  targetDraftPaneId?: string;
  preferCanvasRender?: boolean;
}

import {
  activeEditorTabAtomFamily,
  activeFilePathAtomFamily,
  createWorkspaceCanvasEditorTab,
  editorViewVisibleAtomFamily,
  isCanvasSourcePath,
  openEditorTabsAtomFamily,
} from "../atoms";

// inside the standalone editor branch, before setEditorMode/openLocation
      if (options.preferCanvasRender !== false && isCanvasSourcePath(input.path)) {
        setFocusedEditorPaneId(null);
        if (activeEditorPaneId && !paneLayoutHasEditorPaneId(paneLayout, activeEditorPaneId)) {
          setActiveEditorPaneId(null);
        }

        const nextCanvasTab = createWorkspaceCanvasEditorTab({ sourcePath: input.path });
        const currentTabs = store.get(openEditorTabsAtomFamily(workspaceId));
        const nextTabs = [
          ...currentTabs.filter(
            (tab) => tab.kind !== "canvas" || tab.sourcePath !== nextCanvasTab.sourcePath
          ),
          nextCanvasTab,
        ];

        store.set(activeFilePathAtomFamily(workspaceId), null);
        store.set(editorViewVisibleAtomFamily(workspaceId), true);
        store.set(openEditorTabsAtomFamily(workspaceId), nextTabs);
        store.set(activeEditorTabAtomFamily(workspaceId), nextCanvasTab);
        await persistUiState({
          editorViewVisible: true,
          openEditorTabs: nextTabs,
          activeEditorTab: nextCanvasTab,
          activeEditorPath: null,
        });
        return;
      }
```

In `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`, keep `Open Source` on the same `.csc` file but bypass the default renderer:

```ts
  const handleOpenSource = () => {
    void openWorkspaceFile(
      {
        workspaceId,
        path: tab.sourcePath,
        source: "manual",
      },
      { preferCanvasRender: false }
    );
  };
```

In `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`, replace the inline tab object with the shared helper and dedupe by `sourcePath`:

```ts
      const nextCanvasTab = createWorkspaceCanvasEditorTab({
        sourcePath: event.intent.sourcePath,
        title: event.intent.title,
        artifactType: event.intent.artifactType,
        canvasId: event.intent.canvasId,
      });

      const existingIndex = currentTabs.findIndex(
        (tab) => tab.kind === "canvas" && tab.sourcePath === nextCanvasTab.sourcePath
      );
```

- [ ] **Step 4: Run the web tests to verify they pass**

Run: `pnpm --dir packages/web exec vitest run src/features/workspace/actions/use-open-workspace-file.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx src/features/ui-actions/use-ui-action-subscription.test.tsx src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx`

Expected: PASS with `.csc` opening directly into render tabs.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/workspace/actions/use-open-workspace-file.ts packages/web/src/features/workspace/actions/use-open-workspace-file.test.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx packages/web/src/features/ui-actions/use-ui-action-subscription.ts packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx packages/web/src/features/code-editor/actions/use-code-editor-actions.browser-tabs.test.tsx
git commit -m "feat: open csc files as canvas render tabs"
```

### Task 6: Align Rename/Delete Semantics and Compatibility Metadata With Normal Files

**Files:**
- Modify: `packages/server/src/storage/repositories/canvas-repo.ts`
- Modify: `packages/server/src/storage/repositories/canvas-repo.test.ts`
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/commands/file.ts`
- Modify: `packages/server/src/__tests__/file-commands.test.ts`
- Modify: `packages/web/src/features/workspace/actions/use-file-actions.ts`
- Modify: `packages/web/src/features/workspace/actions/use-file-actions.test.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx`
- Test: `packages/server/src/storage/repositories/canvas-repo.test.ts`
- Test: `packages/server/src/__tests__/file-commands.test.ts`
- Test: `packages/web/src/features/workspace/actions/use-file-actions.test.tsx`
- Test: `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx`

- [ ] **Step 1: Write the failing rename/delete tests**

Add a repo rewrite test in `packages/server/src/storage/repositories/canvas-repo.test.ts`:

```ts
  it("rewrites and removes records by source path", () => {
    repo.upsert({
      id: "canvas-1",
      workspaceId: "ws-1",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      artifactType: "architecture_canvas",
      title: "Runtime Flow",
      updatedAt: 100,
      renderStatus: "ready",
      lastError: null,
    });

    repo.rewriteSourcePaths("ws-1", ".coder-studio/canvases/runtime-flow.csc", ".coder-studio/canvases/runtime-overview.csc");
    expect(repo.get("ws-1", "canvas-1")?.sourcePath).toBe(
      ".coder-studio/canvases/runtime-overview.csc"
    );

    repo.deleteBySourcePath("ws-1", ".coder-studio/canvases/runtime-overview.csc");
    expect(repo.get("ws-1", "canvas-1")).toBeUndefined();
  });
```

In `packages/server/src/__tests__/file-commands.test.ts`, add the canvas imports:

```ts
import { CanvasService } from "../canvas/service.js";
import { CanvasRepo } from "../storage/repositories/canvas-repo.js";
```

Then extend `beforeEach()` after `workspaceId = workspace.id;`:

```ts
    const canvasRepo = new CanvasRepo({ rootDir: join(testDir, ".state", "canvases") });
    const canvasService = new CanvasService({ canvasRepo, now: () => 1000 });
    ctx = {
      ...ctx,
      canvasService,
    } as CommandContext;
```

Then add a file-command repo-sync test after the existing rename assertions:

```ts

  it("rewrites canvas compatibility records when csc files are renamed", async () => {
    const created = await ctx.canvasService!.create({
      workspaceId,
      workspaceRootPath: testDir,
      title: "Runtime Flow",
      kind: "architecture_canvas",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "mermaid",
          source: "flowchart LR\nWebUI[Web UI] --> Server[Runtime Server]",
        },
        annotations: [],
      },
    });

    await dispatch(
      {
        kind: "command",
        id: "file-rename-canvas-1",
        op: "file.rename",
        args: {
          workspaceId,
          fromPath: created.record.sourcePath,
          toPath: ".coder-studio/canvases/runtime-overview.csc",
        },
      },
      ctx
    );

    expect(ctx.canvasService?.getRecord(workspaceId, created.record.id)?.sourcePath).toBe(
      ".coder-studio/canvases/runtime-overview.csc"
    );
  });
```

Add a rename test in `packages/web/src/features/workspace/actions/use-file-actions.test.tsx`:

```ts
  it("rewrites open canvas tabs when a csc file is renamed", async () => {
    const store = createStore();
    const sendCommand = vi.fn(
      async (op: string, args?: { workspaceId?: string; uiState?: Record<string, unknown> }) => {
        if (op === "file.rename") {
          return undefined;
        }

        if (op === "workspace.uiState.set") {
          const workspaceId = args?.workspaceId ?? "ws-test";
          const workspace = store.get(workspacesAtom)[workspaceId];
          return {
            id: workspaceId,
            path: workspace?.path ?? "/workspace",
            targetRuntime: workspace?.targetRuntime ?? "native",
            openedAt: workspace?.openedAt ?? 1,
            lastActiveAt: workspace?.lastActiveAt ?? 1,
            uiState: args?.uiState,
          };
        }

        if (op === "file.readTree") {
          return { path: "/workspace", children: [] };
        }

        throw new Error(`Unexpected command: ${op}`);
      }
    );

    seedWorkspace(store);
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(openEditorTabsAtomFamily("ws-test"), [
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
    ]);
    store.set(activeEditorTabAtomFamily("ws-test"), {
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/runtime-flow.csc",
      title: "Runtime Flow",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.openRenameDialog({
        path: ".coder-studio/canvases/runtime-flow.csc",
        name: "runtime-flow.csc",
        kind: "file",
      });
      result.current.updateRenameDraft("runtime-overview.csc");
    });

    await act(async () => {
      await result.current.submitRenameDialog();
    });

    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/runtime-overview.csc",
        title: "Runtime Flow",
        sourcePath: ".coder-studio/canvases/runtime-overview.csc",
      },
    ]);
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toEqual({
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/runtime-overview.csc",
      title: "Runtime Flow",
      sourcePath: ".coder-studio/canvases/runtime-overview.csc",
    });
  });
```

Add a delete test in the same file that closes the render tab when the `.csc` file is deleted:

```ts
  it("closes open canvas tabs when a csc file is deleted", async () => {
    const store = createStore();
    const sendCommand = vi.fn(
      async (op: string, args?: { workspaceId?: string; uiState?: Record<string, unknown> }) => {
        if (op === "file.delete") {
          return undefined;
        }

        if (op === "workspace.uiState.set") {
          const workspaceId = args?.workspaceId ?? "ws-test";
          const workspace = store.get(workspacesAtom)[workspaceId];
          return {
            id: workspaceId,
            path: workspace?.path ?? "/workspace",
            targetRuntime: workspace?.targetRuntime ?? "native",
            openedAt: workspace?.openedAt ?? 1,
            lastActiveAt: workspace?.lastActiveAt ?? 1,
            uiState: args?.uiState,
          };
        }

        if (op === "file.readTree") {
          return { path: "/workspace", children: [] };
        }

        throw new Error(`Unexpected command: ${op}`);
      }
    );

    seedWorkspace(store);
    store.set(wsClientAtom, { sendCommand } as never);
    store.set(fileTreeAtomFamily("ws-test"), new Map([[".", []]]));
    store.set(openEditorTabsAtomFamily("ws-test"), [
      {
        kind: "canvas",
        id: "canvas:.coder-studio/canvases/runtime-flow.csc",
        title: "Runtime Flow",
        sourcePath: ".coder-studio/canvases/runtime-flow.csc",
      },
    ]);
    store.set(activeEditorTabAtomFamily("ws-test"), {
      kind: "canvas",
      id: "canvas:.coder-studio/canvases/runtime-flow.csc",
      title: "Runtime Flow",
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
    });

    const { result } = renderHook(() => useFileActions({ workspaceId: "ws-test" }), {
      wrapper: wrapperFor(store),
    });

    act(() => {
      result.current.requestDelete({
        path: ".coder-studio/canvases/runtime-flow.csc",
        name: "runtime-flow.csc",
        error: null,
      });
    });

    await act(async () => {
      await result.current.confirmDelete();
    });

    expect(store.get(openEditorTabsAtomFamily("ws-test"))).toEqual([]);
    expect(store.get(activeEditorTabAtomFamily("ws-test"))).toBeNull();
  });
```

Update `packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx` so its canvas helper and expectations use source-path identity:

```ts
function canvasTab(sourcePath: string, title: string) {
  return {
    kind: "canvas" as const,
    id: `canvas:${sourcePath}`,
    title,
    sourcePath,
  };
}

// then use:
canvasTab(".coder-studio/canvases/runtime-flow.csc", "Runtime Flow")
```

- [ ] **Step 2: Run the rename/delete tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/storage/repositories/canvas-repo.test.ts src/__tests__/file-commands.test.ts`
Run: `pnpm --dir packages/web exec vitest run src/features/workspace/actions/use-file-actions.test.tsx src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx`

Expected: FAIL because neither the server repo nor the web tab state currently rewrites canvas paths.

- [ ] **Step 3: Add repo sync hooks and path-based tab rewrite/remove helpers**

In `packages/server/src/storage/repositories/canvas-repo.ts`, add path rewrite/delete helpers:

```ts
  rewriteSourcePaths(workspaceId: string, fromPath: string, toPath: string): void {
    const file = this.readWorkspaceFile(workspaceId);
    let changed = false;

    for (const [id, record] of Object.entries(file.canvases)) {
      if (record.sourcePath === fromPath) {
        file.canvases[id] = { ...record, sourcePath: toPath };
        changed = true;
        continue;
      }

      if (record.sourcePath.startsWith(`${fromPath}/`)) {
        file.canvases[id] = {
          ...record,
          sourcePath: `${toPath}${record.sourcePath.slice(fromPath.length)}`,
        };
        changed = true;
      }
    }

    if (changed) {
      this.writeWorkspaceFile(file);
    }
  }

  deleteBySourcePath(workspaceId: string, deletedPath: string): void {
    const file = this.readWorkspaceFile(workspaceId);
    const nextEntries = Object.entries(file.canvases).filter(([, record]) => {
      return (
        record.sourcePath !== deletedPath &&
        !record.sourcePath.startsWith(`${deletedPath}/`)
      );
    });

    file.canvases = Object.fromEntries(nextEntries);
    this.writeWorkspaceFile(file);
  }
```

Expose minimal rename/delete sync hooks from `packages/server/src/canvas/service.ts`:

```ts
  handleWorkspaceRename(workspaceId: string, fromPath: string, toPath: string): void {
    this.options.canvasRepo.rewriteSourcePaths(workspaceId, fromPath, toPath);
  }

  handleWorkspaceDelete(workspaceId: string, deletedPath: string): void {
    this.options.canvasRepo.deleteBySourcePath(workspaceId, deletedPath);
  }
```

Call those hooks in `packages/server/src/commands/file.ts`:

```ts
      await deleteEntry(workspace.path, args.path);
      ctx.canvasService?.handleWorkspaceDelete(args.workspaceId, args.path);
```

```ts
      await renameEntry(workspace.path, args.fromPath, args.toPath);
      ctx.canvasService?.handleWorkspaceRename(args.workspaceId, args.fromPath, args.toPath);
```

In `packages/web/src/features/workspace/actions/use-file-actions.ts`, rewrite or remove canvas tabs alongside file paths:

```ts
function rewriteCanvasTabs(
  tabs: WorkspaceEditorTab[],
  fromPath: string,
  toPath: string
): WorkspaceEditorTab[] {
  return tabs.map((tab) =>
    tab.kind === "canvas" && isSameOrDescendantPath(tab.sourcePath, fromPath)
      ? {
          ...tab,
          sourcePath: rewriteDescendantPath(tab.sourcePath, fromPath, toPath),
          id: `canvas:${rewriteDescendantPath(tab.sourcePath, fromPath, toPath)}`,
        }
      : tab
  );
}

function removeDeletedCanvasTabs(
  tabs: WorkspaceEditorTab[],
  deletedPath: string
): WorkspaceEditorTab[] {
  return tabs.filter(
    (tab) => tab.kind !== "canvas" || !isSameOrDescendantPath(tab.sourcePath, deletedPath)
  );
}
```

Apply those helpers in both rename and delete paths and persist `openEditorTabs` plus `activeEditorTab` with the rewritten state.

- [ ] **Step 4: Run the rename/delete tests to verify they pass**

Run: `pnpm --dir packages/server exec vitest run src/storage/repositories/canvas-repo.test.ts src/__tests__/file-commands.test.ts`
Run: `pnpm --dir packages/web exec vitest run src/features/workspace/actions/use-file-actions.test.tsx src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx`

Expected: PASS with both compatibility metadata and open canvas tabs tracking file renames/deletes.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/canvas-repo.ts packages/server/src/storage/repositories/canvas-repo.test.ts packages/server/src/canvas/service.ts packages/server/src/commands/file.ts packages/server/src/__tests__/file-commands.test.ts packages/web/src/features/workspace/actions/use-file-actions.ts packages/web/src/features/workspace/actions/use-file-actions.test.tsx packages/web/src/features/workspace/actions/use-workspace-ui-state-persistence.test.tsx
git commit -m "feat: align canvas rename and delete semantics with files"
```

### Task 7: Update Builtin Canvas Skill Guidance and `.csc` Examples

**Files:**
- Modify: `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
- Modify: `packages/server/src/__tests__/skills/builtin-registry.test.ts`
- Modify: `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`
- Modify: `packages/cli/src/bin.test.ts`
- Test: `packages/server/src/__tests__/skills/builtin-registry.test.ts`
- Test: `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`
- Test: `packages/cli/src/bin.test.ts`

- [ ] **Step 1: Write the failing skill and example tests**

Update `packages/server/src/__tests__/skills/builtin-registry.test.ts`:

```ts
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      'Always use a meaningful title such as "Runtime Request Flow" or "Workspace Audit Summary".'
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      "coder-studio ui open-file --path .coder-studio/canvases/runtime-flow.csc --json"
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(".coder-studio/canvases/<slug>.csc");
```

Update `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts` with the same expectations against the materialized `SKILL.md`.

Update the example strings in `packages/cli/src/bin.test.ts` so the `--source-path` examples use `.csc`:

```ts
      sourcePath: ".coder-studio/canvases/runtime-flow.csc",
```

- [ ] **Step 2: Run the skill and CLI tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts`
Run: `pnpm --dir packages/cli exec vitest run src/bin.test.ts`

Expected: FAIL because the builtin skill still documents `.canvas.json`, `ui open-canvas`, and has no meaningful-title guidance.

- [ ] **Step 3: Rewrite the builtin skill content for file-first usage**

In `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`, update the content strings so create guidance explicitly requires meaningful titles:

```ts
  "Always use a meaningful title that tells the user what the canvas is for. Good examples: `Runtime Request Flow`, `Agent Tooling Overview`, `Workspace Audit Summary`.",
  "Do not use generic names such as `Canvas`, `Diagram`, `Architecture`, or `Untitled`.",
```

Replace the “Open An Existing Canvas” guidance with a file-first flow:

```ts
  "List canvases first when you need the saved file path:",
  "",
  "```bash",
  "coder-studio canvas list --workspace <workspace-id> --json",
  "```",
  "",
  "Then open the `.csc` file through the normal file-open path:",
  "",
  "```bash",
  "coder-studio ui open-file --workspace <workspace-id> --path .coder-studio/canvases/runtime-flow.csc --json",
  "```",
```

Update the notes block to mention `.csc`:

```ts
  "- canvas source is stored as `.coder-studio/canvases/<slug>.csc` in the workspace",
```

Do not remove `ui open-canvas` support from the product in this task; only stop teaching it as the primary path.

- [ ] **Step 4: Run the skill and CLI tests to verify they pass**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts`
Run: `pnpm --dir packages/cli exec vitest run src/bin.test.ts`

Expected: PASS with file-first `.csc` skill guidance and updated example strings.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts packages/server/src/__tests__/skills/builtin-registry.test.ts packages/server/src/__tests__/server-builtin-skills-wiring.test.ts packages/cli/src/bin.test.ts
git commit -m "docs: teach the canvas skill to use meaningful csc titles"
```

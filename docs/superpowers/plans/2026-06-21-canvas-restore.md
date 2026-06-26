# Canvas Restore Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore the removed canvas feature on current `develop` so Coder Studio can create, render, open, and refresh `architecture_canvas` and `report_canvas` artifacts as first-class editor tabs backed by real workspace files.

**Architecture:** Reintroduce the old canvas flow in the smallest compatible shape: restore the core contracts, the server-side repository/service/command/route chain, the frontend canvas tab plus embedded route/renderers, and the CLI wrappers. Keep source-of-truth in `.coder-studio/canvases/*.canvas.json`, keep validation/compilation on the server, and keep the canvas tab as a viewer plus source-file shortcut instead of an in-place editor.

**Tech Stack:** TypeScript, Zod, Fastify, React, React Router, Jotai, Vitest, existing workspace editor and UI action infrastructure

---

## Reference Spec

Read first:

- `docs/superpowers/specs/2026-06-21-canvas-restore-design.md`

Key requirements this plan implements:

- restore `architecture_canvas` and `report_canvas`
- restore source files under `.coder-studio/canvases/*.canvas.json`
- restore `canvas.list/create/update/render`
- restore `canvas.open`
- restore `/embedded/canvas/:workspaceId/:canvasId`
- restore `/api/canvas/:workspaceId/:canvasId/data`
- restore the canvas editor tab with `Open source` and `Refresh`

## File Structure

### Core contracts

- Create: `packages/core/src/domain/canvas.ts`
- Create: `packages/core/src/domain/canvas.test.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/core/src/domain/ui-actions.ts`
- Modify: `packages/core/src/index.ts`

### Server runtime

- Create: `packages/server/src/canvas/compiler.ts`
- Create: `packages/server/src/canvas/compiler.test.ts`
- Create: `packages/server/src/canvas/graph-v1.ts`
- Create: `packages/server/src/canvas/graph-v1.test.ts`
- Create: `packages/server/src/canvas/mermaid-flowchart.ts`
- Create: `packages/server/src/canvas/mermaid-flowchart.test.ts`
- Create: `packages/server/src/canvas/service.ts`
- Create: `packages/server/src/canvas/service.test.ts`
- Create: `packages/server/src/canvas/validation.ts`
- Create: `packages/server/src/canvas/validation.test.ts`
- Create: `packages/server/src/commands/canvas.ts`
- Create: `packages/server/src/routes/canvas.ts`
- Create: `packages/server/src/routes/canvas.test.ts`
- Create: `packages/server/src/storage/repositories/canvas-repo.ts`
- Create: `packages/server/src/storage/repositories/canvas-repo.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/app-routing.test.ts`

### Web

- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/app.test.tsx`
- Create: `packages/web/src/features/canvas/api.ts`
- Create: `packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx`
- Create: `packages/web/src/features/canvas/components/architecture-canvas-renderer.test.tsx`
- Create: `packages/web/src/features/canvas/components/canvas-route-frame.tsx`
- Create: `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`
- Create: `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`
- Create: `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx`
- Modify: `packages/web/src/features/workspace/atoms/files.ts`
- Modify: `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
- Modify: `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`
- Create: `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- Create: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`

### CLI

- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/bin.test.ts`

---

### Task 1: Restore Core Canvas Contracts

**Files:**
- Create: `packages/core/src/domain/canvas.ts`
- Create: `packages/core/src/domain/canvas.test.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/core/src/domain/ui-actions.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add the failing core canvas tests**

Create `packages/core/src/domain/canvas.test.ts` with the contract checks restored from the old implementation:

```ts
import { describe, expect, it } from "vitest";
import { CanvasDataResponseSchema, parseCanvasDocumentEnvelope } from "./canvas.js";

describe("canvas domain", () => {
  it("parses an architecture canvas envelope", () => {
    const parsed = parseCanvasDocumentEnvelope({
      version: 1,
      kind: "architecture_canvas",
      title: "Runtime Flow",
      document: {
        summary: "How requests move.",
        diagram: {
          dsl: "graph_v1",
          source: "node WebUI\nnode Server\nedge WebUI -> Server",
        },
        annotations: [{ title: "Boundary", body: "Server owns execution." }],
      },
    });

    expect(parsed.kind).toBe("architecture_canvas");
    expect(parsed.document.diagram.dsl).toBe("graph_v1");
  });

  it("rejects ready responses without a compiled document", () => {
    const result = CanvasDataResponseSchema.safeParse({
      canvasId: "canvas-1",
      workspaceId: "ws-1",
      title: "Runtime Flow",
      kind: "architecture_canvas",
      renderStatus: "ready",
      lastError: null,
    });

    expect(result.success).toBe(false);
  });
});
```

- [ ] **Step 2: Run the core canvas test and verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/canvas.test.ts
```

Expected: FAIL because `src/domain/canvas.ts` does not exist and the exports are missing.

- [ ] **Step 3: Restore the core canvas domain types and exports**

Recreate `packages/core/src/domain/canvas.ts` from commit `277fe754` and wire it into the current package:

- export `CanvasArtifactKind`
- export `CANVAS_DOCUMENT_VERSION`
- export `CanvasRenderStatus`
- export `CanvasErrorCategory`
- export `CanvasRenderErrorSchema`
- export `CanvasDocumentEnvelopeSchema`
- export `CompiledCanvasSchema`
- export `CanvasDataResponseSchema`
- export `parseCanvasDocumentEnvelope()`
- export the corresponding TypeScript types

Also:

- update `packages/core/src/domain/types.ts` to restore:

```ts
export interface WorkspaceCanvasEditorTab {
  kind: "canvas";
  id: string;
  canvasId: string;
  title: string;
  artifactType: "architecture_canvas" | "report_canvas";
  sourcePath: string;
}

export type WorkspaceEditorTab =
  | WorkspaceFileEditorTab
  | WorkspaceBrowserEditorTab
  | WorkspaceCanvasEditorTab;
```

- update `packages/core/src/domain/ui-actions.ts` to restore:

```ts
| {
    type: "canvas.open";
    workspaceId?: string;
    canvasId: string;
    title: string;
    artifactType: CanvasArtifactKind;
    sourcePath: string;
  }
```

- update `packages/core/src/index.ts` to export `./domain/canvas`

- [ ] **Step 4: Re-run the core canvas test and verify it passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/canvas.test.ts
```

Expected: PASS with the new domain file, `canvas.open`, and canvas tab types in place.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add packages/core/src/domain/canvas.ts packages/core/src/domain/canvas.test.ts packages/core/src/domain/types.ts packages/core/src/domain/ui-actions.ts packages/core/src/index.ts
git commit -m "feat(core): restore canvas domain contracts"
```

### Task 2: Restore Canvas Storage, Validation, And Compilation

**Files:**
- Create: `packages/server/src/storage/repositories/canvas-repo.ts`
- Create: `packages/server/src/storage/repositories/canvas-repo.test.ts`
- Create: `packages/server/src/canvas/validation.ts`
- Create: `packages/server/src/canvas/validation.test.ts`
- Create: `packages/server/src/canvas/compiler.ts`
- Create: `packages/server/src/canvas/compiler.test.ts`
- Create: `packages/server/src/canvas/graph-v1.ts`
- Create: `packages/server/src/canvas/graph-v1.test.ts`
- Create: `packages/server/src/canvas/mermaid-flowchart.ts`
- Create: `packages/server/src/canvas/mermaid-flowchart.test.ts`

- [ ] **Step 1: Add the failing repository and compiler tests**

Restore the old repository and compiler tests from commit `277fe754`:

- `packages/server/src/storage/repositories/canvas-repo.test.ts`
- `packages/server/src/canvas/validation.test.ts`
- `packages/server/src/canvas/compiler.test.ts`
- `packages/server/src/canvas/graph-v1.test.ts`
- `packages/server/src/canvas/mermaid-flowchart.test.ts`

Keep the tests focused on these behaviors:

- repo `list/get/upsert/delete/removeWorkspace`
- validation accepts good envelopes and reports field paths for invalid ones
- `graph_v1` compilation produces nodes and edges
- Mermaid flowchart compilation produces labeled nodes and edges
- compiler produces `architecture_canvas` and `report_canvas` render models

- [ ] **Step 2: Run the focused server tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/storage/repositories/canvas-repo.test.ts src/canvas/validation.test.ts src/canvas/compiler.test.ts src/canvas/graph-v1.test.ts src/canvas/mermaid-flowchart.test.ts
```

Expected: FAIL because the files and exports are missing.

- [ ] **Step 3: Restore the repo, validation, and compilation modules**

Recreate the old implementation from commit `277fe754` for:

- `packages/server/src/storage/repositories/canvas-repo.ts`
- `packages/server/src/canvas/validation.ts`
- `packages/server/src/canvas/compiler.ts`
- `packages/server/src/canvas/graph-v1.ts`
- `packages/server/src/canvas/mermaid-flowchart.ts`

Keep the old behavior:

- repo stores metadata JSON by workspace id under server state
- validation parses the source envelope using the core schema
- `graph_v1` converts the line DSL into nodes and edges
- Mermaid flowchart parsing supports simple flowchart edges with optional labels
- compiler returns `CompiledCanvas` objects only, never raw HTML

- [ ] **Step 4: Re-run the focused server tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/storage/repositories/canvas-repo.test.ts src/canvas/validation.test.ts src/canvas/compiler.test.ts src/canvas/graph-v1.test.ts src/canvas/mermaid-flowchart.test.ts
```

Expected: PASS with the restored repo and compilation pipeline.

- [ ] **Step 5: Commit Task 2**

Run:

```bash
git add packages/server/src/storage/repositories/canvas-repo.ts packages/server/src/storage/repositories/canvas-repo.test.ts packages/server/src/canvas/validation.ts packages/server/src/canvas/validation.test.ts packages/server/src/canvas/compiler.ts packages/server/src/canvas/compiler.test.ts packages/server/src/canvas/graph-v1.ts packages/server/src/canvas/graph-v1.test.ts packages/server/src/canvas/mermaid-flowchart.ts packages/server/src/canvas/mermaid-flowchart.test.ts
git commit -m "feat(server): restore canvas storage and compilation"
```

### Task 3: Restore Canvas Service, Commands, And API Route

**Files:**
- Create: `packages/server/src/canvas/service.ts`
- Create: `packages/server/src/canvas/service.test.ts`
- Create: `packages/server/src/commands/canvas.ts`
- Create: `packages/server/src/routes/canvas.ts`
- Create: `packages/server/src/routes/canvas.test.ts`
- Modify: `packages/server/src/commands/index.ts`
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/app-routing.test.ts`

- [ ] **Step 1: Add the failing service and route tests**

Restore the old service and route tests:

- `packages/server/src/canvas/service.test.ts`
- `packages/server/src/routes/canvas.test.ts`

Add or restore app wiring assertions in `packages/server/src/app-routing.test.ts` that prove:

- `GET /api/canvas/ws-1/canvas-1/data` does not fall through to `index.html`
- the route is present when the app is assembled

Use the existing route test cases from `277fe754`, especially:

- create writes a source file and metadata record
- valid canvas data returns `renderStatus: "ready"`
- invalid source returns `renderStatus: "error"`
- compile failure returns `renderStatus: "error"`
- route returns 404 for missing workspace
- route returns 404 for missing canvas

- [ ] **Step 2: Run the focused server tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/canvas/service.test.ts src/routes/canvas.test.ts src/app-routing.test.ts
```

Expected: FAIL because `CanvasService`, `registerCanvasRoutes`, and the server wiring are missing.

- [ ] **Step 3: Restore the server canvas runtime and wire it into the app**

Recreate the old server runtime from commit `277fe754` with minimal adaptation to current `develop`:

- restore `packages/server/src/canvas/service.ts`
- restore `packages/server/src/commands/canvas.ts`
- restore `packages/server/src/routes/canvas.ts`

Then integrate it:

- update `packages/server/src/commands/index.ts` to import `./canvas.js`
- update `packages/server/src/ws/dispatch.ts` to add:

```ts
canvasService?: CanvasService;
```

- update `packages/server/src/server.ts` to instantiate:

```ts
const canvasRepo = new CanvasRepo({
  rootDir: join(stateRoot, "state", "canvases"),
});
const canvasService = new CanvasService({ canvasRepo });
```

and inject `canvasService` into the command context

- update `packages/server/src/app.ts` to import and register `registerCanvasRoutes()`

Keep the old command semantics:

- `canvas.list`
- `canvas.create`
- `canvas.update`
- `canvas.render`

Keep `canvas.create` broadcasting `canvas.open` when `openInEditor` is true.

- [ ] **Step 4: Re-run the focused server tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/canvas/service.test.ts src/routes/canvas.test.ts src/app-routing.test.ts
```

Expected: PASS with the service, command, and route chain restored.

- [ ] **Step 5: Commit Task 3**

Run:

```bash
git add packages/server/src/canvas/service.ts packages/server/src/canvas/service.test.ts packages/server/src/commands/canvas.ts packages/server/src/routes/canvas.ts packages/server/src/routes/canvas.test.ts packages/server/src/commands/index.ts packages/server/src/ws/dispatch.ts packages/server/src/server.ts packages/server/src/app.ts packages/server/src/app-routing.test.ts
git commit -m "feat(server): restore canvas command and route chain"
```

### Task 4: Restore Frontend Embedded Route And Renderers

**Files:**
- Modify: `packages/web/src/app.tsx`
- Modify: `packages/web/src/app.test.tsx`
- Create: `packages/web/src/features/canvas/api.ts`
- Create: `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`
- Create: `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx`
- Create: `packages/web/src/features/canvas/components/canvas-route-frame.tsx`
- Create: `packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx`
- Create: `packages/web/src/features/canvas/components/architecture-canvas-renderer.test.tsx`
- Create: `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`

- [ ] **Step 1: Add the failing app and embedded route tests**

Restore the old embedded route test from `277fe754` into:

- `packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx`

Add one routing test to `packages/web/src/app.test.tsx` that proves
`/embedded/canvas/ws-1/canvas-1` renders the embedded route instead of the normal shell:

```ts
vi.mock("./features/canvas/routes/embedded-canvas-route", () => ({
  EmbeddedCanvasRoute: () => <div data-testid="embedded-canvas-route">Canvas</div>,
}));

it("renders the embedded canvas route when the canvas URL is requested", () => {
  window.history.replaceState({}, "", "/embedded/canvas/ws-1/canvas-1");
  render(
    <Provider store={store}>
      <App />
    </Provider>
  );

  expect(screen.getByTestId("embedded-canvas-route")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused web tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/app.test.tsx src/features/canvas/routes/embedded-canvas-route.test.tsx
```

Expected: FAIL because the route and components do not exist.

- [ ] **Step 3: Restore the embedded route, fetcher, and renderer components**

Recreate the old frontend canvas feature from commit `277fe754`:

- `packages/web/src/features/canvas/api.ts`
- `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`
- `packages/web/src/features/canvas/components/canvas-route-frame.tsx`
- `packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx`
- `packages/web/src/features/canvas/components/report-canvas-renderer.tsx`

Then update `packages/web/src/app.tsx` to restore:

```tsx
<Routes>
  <Route path="/embedded/canvas/:workspaceId/:canvasId" element={<EmbeddedCanvasRoute />} />
  <Route path="*" element={<ShellSwitch />} />
</Routes>
```

Keep the embedded route states:

- loading
- request error
- render error
- ready

- [ ] **Step 4: Re-run the focused web tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/app.test.tsx src/features/canvas/routes/embedded-canvas-route.test.tsx
```

Expected: PASS with the embedded route and renderers restored.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add packages/web/src/app.tsx packages/web/src/app.test.tsx packages/web/src/features/canvas/api.ts packages/web/src/features/canvas/routes/embedded-canvas-route.tsx packages/web/src/features/canvas/routes/embedded-canvas-route.test.tsx packages/web/src/features/canvas/components/canvas-route-frame.tsx packages/web/src/features/canvas/components/architecture-canvas-renderer.tsx packages/web/src/features/canvas/components/architecture-canvas-renderer.test.tsx packages/web/src/features/canvas/components/report-canvas-renderer.tsx
git commit -m "feat(web): restore embedded canvas route and renderers"
```

### Task 5: Restore Canvas Tabs, UI Actions, And Editor Surface Integration

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/files.ts`
- Modify: `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
- Modify: `packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`
- Create: `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- Create: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`

- [ ] **Step 1: Add the failing UI action and editor surface tests**

Restore the `canvas.open` test from commit `277fe754` into
`packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx`:

```ts
it("opens and activates a canvas tab from canvas.open events", async () => {
  await emit(
    createEvent({
      type: "canvas.open",
      workspaceId: "ws-1",
      canvasId: "canvas-1",
      title: "Runtime Flow",
      artifactType: "architecture_canvas",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
    })
  );

  expect(store.get(openEditorTabsAtomFamily("ws-1"))).toEqual([
    {
      kind: "canvas",
      id: "canvas:canvas-1",
      canvasId: "canvas-1",
      title: "Runtime Flow",
      artifactType: "architecture_canvas",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
    },
  ]);
});
```

Create `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx` with:

- an `Open source` click test that calls `openWorkspaceFile`
- a `Refresh` click test that dispatches `canvas.render` and changes the iframe URL token

Add one focused test to `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`:

```ts
it("renders CanvasSurface when the active editor tab is a canvas tab", () => {
  const state = createState({
    activeFilePath: null,
    activeEditorTab: {
      kind: "canvas",
      id: "canvas:canvas-1",
      canvasId: "canvas-1",
      title: "Runtime Flow",
      artifactType: "architecture_canvas",
      sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
    },
    openEditorTabs: [
      {
        kind: "canvas",
        id: "canvas:canvas-1",
        canvasId: "canvas-1",
        title: "Runtime Flow",
        artifactType: "architecture_canvas",
        sourcePath: ".coder-studio/canvases/canvas-1.canvas.json",
      },
    ],
  });

  render(<EditorSurface state={state} />);

  expect(screen.getByTitle("Runtime Flow canvas")).toBeInTheDocument();
});
```

- [ ] **Step 2: Run the focused web tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/use-ui-action-subscription.test.tsx src/features/code-editor/views/shared/editor-surface.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: FAIL because `canvas.open`, canvas tabs, and `CanvasSurface` are not implemented.

- [ ] **Step 3: Restore the canvas tab model and editor surface integration**

Recreate or adapt the old implementation from commit `277fe754`:

- update `packages/web/src/features/workspace/atoms/files.ts`
  - restore `WorkspaceCanvasEditorTab`
  - restore `canvasRefreshTokenAtomFamily`
  - extend `normalizeWorkspaceEditorTabs()` for canvas tabs
- update `packages/web/src/features/ui-actions/use-ui-action-subscription.ts`
  - register `canvas.open`
- create `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- update `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
  - render `CanvasSurface`
  - include canvas tabs in `visibleEditorTabs`
  - allow activate/close on canvas tabs
- update `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`
  - display and activate canvas tabs

Keep the old `CanvasSurface` behavior:

- iframe `src` is `/embedded/canvas/<workspaceId>/<canvasId>?refresh=<token>`
- toolbar buttons:
  - `Open source`
  - `Refresh`

- [ ] **Step 4: Re-run the focused web tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/ui-actions/use-ui-action-subscription.test.tsx src/features/code-editor/views/shared/editor-surface.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: PASS with canvas tabs, `canvas.open`, and `CanvasSurface` restored.

- [ ] **Step 5: Commit Task 5**

Run:

```bash
git add packages/web/src/features/workspace/atoms/files.ts packages/web/src/features/ui-actions/use-ui-action-subscription.ts packages/web/src/features/ui-actions/use-ui-action-subscription.test.tsx packages/web/src/features/code-editor/views/shared/editor-surface.tsx packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx
git commit -m "feat(web): restore canvas editor tabs"
```

### Task 6: Restore The CLI Canvas Command Family

**Files:**
- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/cli.ts`
- Modify: `packages/cli/src/bin.test.ts`

- [ ] **Step 1: Add the failing CLI tests**

Extend `packages/cli/src/bin.test.ts` with parser and command wiring tests for:

- `coder-studio canvas list --workspace ws_123 --json`
- `coder-studio canvas create --workspace ws_123 --kind architecture_canvas --title "Runtime Flow" --document-json '{...}' --open --json`
- `coder-studio canvas update --workspace ws_123 --canvas canvas_123 --document-json '{...}' --json`
- `coder-studio canvas render --workspace ws_123 --canvas canvas_123 --json`

Use expectations like:

```ts
expect(parseArgs(["canvas", "list", "--workspace", "ws_123", "--json"])).toMatchObject({
  command: "canvas",
  canvasCommand: "list",
  workspaceId: "ws_123",
  json: true,
});

await main([
  "canvas",
  "render",
  "--workspace",
  "ws_123",
  "--canvas",
  "canvas_123",
  "--json",
]);

expect(callCoderStudioCommand).toHaveBeenCalledWith(
  expect.objectContaining({
    op: "canvas.render",
    args: {
      workspaceId: "ws_123",
      canvasId: "canvas_123",
    },
  }),
  expect.anything()
);
```

- [ ] **Step 2: Run the CLI test and verify it fails**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
```

Expected: FAIL because the parser and CLI do not know the `canvas` command family.

- [ ] **Step 3: Restore the parser and CLI wiring for canvas commands**

Reapply the old CLI support from commit `277fe754`:

- update `packages/cli/src/parse-args.ts`
  - add command `canvas`
  - add subcommands `list | create | update | render`
  - add args for `--workspace`, `--canvas`, `--kind`, `--title`, `--document-json`, `--open`
- update `packages/cli/src/cli.ts`
  - show `canvas` in help output
  - dispatch `canvas.list/create/update/render` through `callCoderStudioCommand()`

Keep the CLI as a thin transport layer only.

- [ ] **Step 4: Re-run the CLI test and verify it passes**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
```

Expected: PASS with the restored parser and automation calls.

- [ ] **Step 5: Commit Task 6**

Run:

```bash
git add packages/cli/src/parse-args.ts packages/cli/src/cli.ts packages/cli/src/bin.test.ts
git commit -m "feat(cli): restore canvas commands"
```

### Task 7: Run Cross-Package Verification And Audit The Acceptance Criteria

**Files:**
- Modify: nothing expected unless verification reveals a defect

- [ ] **Step 1: Run focused package tests for the restored feature**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/canvas.test.ts
pnpm --filter @coder-studio/server exec vitest run src/storage/repositories/canvas-repo.test.ts src/canvas/validation.test.ts src/canvas/compiler.test.ts src/canvas/graph-v1.test.ts src/canvas/mermaid-flowchart.test.ts src/canvas/service.test.ts src/routes/canvas.test.ts src/app-routing.test.ts
pnpm --filter @coder-studio/web exec vitest run src/app.test.tsx src/features/canvas/routes/embedded-canvas-route.test.tsx src/features/ui-actions/use-ui-action-subscription.test.tsx src/features/code-editor/views/shared/editor-surface.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
```

Expected: PASS across all focused tests.

- [ ] **Step 2: Run repository-level verification required by the workspace instructions**

Run:

```bash
pnpm ci:test
pnpm ci:verify
```

Expected: PASS. If `pnpm ci:verify` is too slow or fails outside the restore scope, record the exact failure and whether it is pre-existing or introduced by the canvas work.

- [ ] **Step 3: Audit the spec acceptance criteria against the finished code**

Manually verify these points against the diff and test evidence:

- `.coder-studio/canvases/*.canvas.json` is written by `canvas.create`
- `canvas.open` opens a canvas tab
- `/embedded/canvas/:workspaceId/:canvasId` renders
- `/api/canvas/:workspaceId/:canvasId/data` serves JSON
- both `architecture_canvas` and `report_canvas` render
- `Open source` works
- `Refresh` works

Expected: every item maps to code plus a passing test.

- [ ] **Step 4: Commit any verification-only fixes**

If verification revealed defects and you fixed them, commit them with the narrowest accurate message, for example:

```bash
git add <fixed-files>
git commit -m "fix(canvas): correct refresh token reload behavior"
```

If no fixes were needed, skip this step.

- [ ] **Step 5: Prepare handoff summary**

Report:

- changed files grouped by core/server/web/cli
- verification commands run
- pass/fail results
- any remaining risk, skipped coverage, or assumptions

## Self-Review

Plan coverage against the spec:

- core contracts are restored in Task 1
- server repository, validation, compiler, service, commands, route, and app wiring are restored in Tasks 2 and 3
- frontend embedded route, renderers, canvas tab, and UI action integration are restored in Tasks 4 and 5
- CLI support is restored in Task 6
- repository verification and acceptance audit are covered in Task 7

Placeholder scan:

- every task names the exact files
- every test step names the exact command
- every verification step states the expected failure or pass condition

Type consistency:

- `WorkspaceCanvasEditorTab`, `canvas.open`, `CanvasService`, `registerCanvasRoutes`, and `canvasRefreshTokenAtomFamily` use the same names across tasks
- `architecture_canvas` and `report_canvas` remain the only artifact kinds throughout the plan

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-21-canvas-restore.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**

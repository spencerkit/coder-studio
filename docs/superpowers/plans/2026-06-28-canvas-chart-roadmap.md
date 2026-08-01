# Canvas Reusability 60-90 Day Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add preset-driven canvas creation, immutable snapshot delivery, and editable clone flows on top of the already chart-enabled `report_canvas` surface.

**Architecture:** Keep the current file-first `.csc` source model and existing `architecture_canvas` / `report_canvas` split. Add a narrow preset registry inside the server canvas subsystem, persist immutable snapshot payloads in a dedicated state repository, and expose clone operations that always materialize a new editable `.csc` source file. The web layer stays thin: it fetches snapshot payloads, renders them through the existing canvas content components, and does not introduce an in-browser canvas editor in this phase.

**Tech Stack:** TypeScript, Zod, Fastify, React, Vitest, existing workspace file storage

---

## File Map

- `packages/server/src/canvas/presets.ts`
  Holds the built-in preset catalog and builders for starter `report_canvas` documents.
- `packages/server/src/storage/repositories/canvas-snapshot-repo.ts`
  Persists immutable snapshot records under server state storage.
- `packages/server/src/canvas/service.ts`
  Gains preset list/create, snapshot create/read, and clone operations while keeping `.csc` file creation centralized.
- `packages/server/src/commands/canvas.ts`
  Registers new canvas commands for presets, snapshots, and clone behavior.
- `packages/server/src/routes/canvas-snapshots.ts`
  Serves snapshot payloads over HTTP without requiring a workspace source path.
- `packages/server/src/app.ts`
  Registers the new snapshot route when canvas support is enabled.
- `packages/server/src/server.ts`
  Instantiates and wires the snapshot repo into `CanvasService`.
- `packages/server/src/storage/index.ts`
  Exports the snapshot repo for reuse in tests and server assembly.
- `packages/core/src/domain/canvas.ts`
  Adds shared types and schemas for preset metadata and snapshot responses.
- `packages/core/src/domain/canvas.test.ts`
  Locks the new shared contracts.
- `packages/server/src/canvas/service.test.ts`
  Covers preset creation, snapshot immutability, and clone paths.
- `packages/server/src/commands/canvas.test.ts`
  Covers the command surface for presets, snapshots, and clone.
- `packages/server/src/routes/canvas.test.ts`
  Keeps the existing source-path route stable while avoiding regressions.
- `packages/server/src/routes/canvas-snapshots.test.ts`
  Covers snapshot HTTP delivery.
- `packages/web/src/features/canvas/api.ts`
  Adds snapshot fetch support alongside existing source-path fetch behavior.
- `packages/web/src/features/canvas/api.test.ts`
  Covers snapshot payload validation and fetch URLs.
- `packages/web/src/features/canvas/components/canvas-content.tsx`
  Accepts either workspace-backed source paths or snapshot-backed render payloads.
- `packages/web/src/features/canvas/routes/embedded-canvas-route.tsx`
  Remains the editable/source-backed path and should not gain snapshot logic.
- `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.tsx`
  Adds a read-only snapshot route.
- `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx`
  Covers snapshot rendering.
- `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
  Documents the new commands and snapshot route for agents.
- `packages/server/src/__tests__/skills/builtin-registry.test.ts`
  Locks the updated skill copy.
- `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`
  Locks mounted built-in skill content.

## Final Verification

Run these after all tasks are complete:

```bash
pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts
pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas.test.ts src/routes/canvas-snapshots.test.ts src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts
pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/canvas/routes/embedded-canvas-route.test.tsx src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx
pnpm build
```

Expected: all targeted tests pass and `pnpm build` exits `0`.

### Task 1: Add Shared Preset And Snapshot Contracts

**Files:**
- Modify: `packages/core/src/domain/canvas.ts`
- Modify: `packages/core/src/domain/canvas.test.ts`
- Test: `packages/core/src/domain/canvas.test.ts`

- [ ] **Step 1: Write the failing shared-contract tests**

Add tests that lock the preset list shape and snapshot response shape:

```ts
it("parses canvas preset metadata", () => {
  expect(
    CanvasPresetSummarySchema.parse({
      id: "token-consumption-trend",
      title: "Token Consumption Trend",
      description: "Time-series prompt and completion token usage.",
      kind: "report_canvas",
    })
  ).toMatchObject({
    id: "token-consumption-trend",
    kind: "report_canvas",
  });
});

it("parses immutable snapshot responses", () => {
  expect(
    CanvasSnapshotDataResponseSchema.parse({
      snapshotId: "snapshot_123",
      workspaceId: "ws-1",
      title: "Weekly Metrics",
      kind: "report_canvas",
      createdAt: 123456,
      sourceHash: "abc123",
      compiledDocument: {
        kind: "report_canvas",
        title: "Weekly Metrics",
        sections: [],
      },
    })
  ).toMatchObject({
    snapshotId: "snapshot_123",
  });
});
```

- [ ] **Step 2: Run the core test to verify it fails**

Run: `pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts`

Expected: FAIL because the preset and snapshot schemas do not exist yet.

- [ ] **Step 3: Add minimal shared schemas**

Extend `packages/core/src/domain/canvas.ts` with narrow shared contracts:

```ts
export const CanvasPresetIdSchema = z.enum([
  "token-consumption-trend",
  "workspace-activity-summary",
  "provider-usage-comparison",
]);
export type CanvasPresetId = z.infer<typeof CanvasPresetIdSchema>;

export const CanvasPresetSummarySchema = z.object({
  id: CanvasPresetIdSchema,
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  kind: z.literal("report_canvas"),
});
export type CanvasPresetSummary = z.infer<typeof CanvasPresetSummarySchema>;

export const CanvasSnapshotDataResponseSchema = z.object({
  snapshotId: z.string().trim().min(1),
  workspaceId: z.string().trim().min(1),
  title: z.string().trim().min(1),
  kind: CanvasArtifactKind,
  createdAt: z.number().int().nonnegative(),
  sourceHash: z.string().trim().min(1),
  compiledDocument: CompiledCanvasSchema,
});
export type CanvasSnapshotDataResponse = z.infer<typeof CanvasSnapshotDataResponseSchema>;
```

Do not add edit-state fields or mutable metadata in this task. Snapshot contracts stay read-only.

- [ ] **Step 4: Re-run the core test to verify it passes**

Run: `pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/canvas.ts packages/core/src/domain/canvas.test.ts
git commit -m "feat: add canvas preset and snapshot contracts"
```

### Task 2: Add The Preset Registry And Server Create-From-Preset Flow

**Files:**
- Create: `packages/server/src/canvas/presets.ts`
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/canvas/service.test.ts`
- Modify: `packages/server/src/commands/canvas.ts`
- Modify: `packages/server/src/commands/canvas.test.ts`
- Test: `packages/server/src/canvas/service.test.ts`
- Test: `packages/server/src/commands/canvas.test.ts`

- [ ] **Step 1: Write failing preset tests**

Add service-level and command-level tests:

```ts
it("lists built-in report canvas presets", async () => {
  await expect(service.listPresets()).resolves.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: "token-consumption-trend", kind: "report_canvas" }),
    ])
  );
});

it("creates a report canvas from a preset", async () => {
  const result = await service.createFromPreset({
    workspaceId: "ws-1",
    workspaceRootPath: workspaceRoot,
    presetId: "token-consumption-trend",
    title: "Token Consumption",
  });

  expect(result.record.sourcePath).toBe(".coder-studio/canvases/token-consumption.csc");
  expect(result.source.kind).toBe("report_canvas");
});
```

Command test:

```ts
const presetList = await dispatch(command("canvas.preset.list", { workspaceId: "ws-1" }), ctx);
expect(presetList.ok).toBe(true);

const createFromPreset = await dispatch(
  command("canvas.create-from-preset", {
    workspaceId: "ws-1",
    presetId: "token-consumption-trend",
    title: "Token Consumption",
  }),
  ctx
);
expect(createFromPreset.ok).toBe(true);
```

- [ ] **Step 2: Run focused server tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts`

Expected: FAIL because preset APIs and commands do not exist yet.

- [ ] **Step 3: Implement the preset registry and service wiring**

Create `packages/server/src/canvas/presets.ts`:

```ts
import type { CanvasDocumentEnvelope, CanvasPresetId, CanvasPresetSummary } from "@coder-studio/core";

interface CanvasPresetDefinition extends CanvasPresetSummary {
  buildDocument(input: { title: string }): CanvasDocumentEnvelope;
}

export const CANVAS_PRESETS: CanvasPresetDefinition[] = [
  {
    id: "token-consumption-trend",
    title: "Token Consumption Trend",
    description: "Time-series prompt and completion token usage.",
    kind: "report_canvas",
    buildDocument: ({ title }) => ({
      version: 1,
      kind: "report_canvas",
      title,
      document: {
        summary: "Token usage trend report.",
        stats: [],
        sections: [
          {
            title: "Usage",
            blocks: [
              {
                type: "chart",
                kind: "line",
                title,
                categories: ["09:00", "10:00", "11:00"],
                series: [{ name: "Prompt", values: [0, 0, 0] }],
              },
            ],
          },
        ],
      },
    }),
  },
];

export function listCanvasPresets(): CanvasPresetSummary[] {
  return CANVAS_PRESETS.map(({ buildDocument: _buildDocument, ...preset }) => preset);
}

export function getCanvasPresetOrThrow(presetId: CanvasPresetId): CanvasPresetDefinition {
  const preset = CANVAS_PRESETS.find((entry) => entry.id === presetId);
  if (!preset) {
    throw { code: "canvas_preset_not_found", message: `Canvas preset not found: ${presetId}` };
  }
  return preset;
}
```

Extend `CanvasService` with:

```ts
async listPresets(): Promise<CanvasPresetSummary[]> {
  return listCanvasPresets();
}

async createFromPreset(input: {
  workspaceId: string;
  workspaceRootPath: string;
  sessionId?: string;
  presetId: CanvasPresetId;
  title: string;
}) {
  const preset = getCanvasPresetOrThrow(input.presetId);
  const envelope = preset.buildDocument({ title: input.title });
  return this.create({
    workspaceId: input.workspaceId,
    workspaceRootPath: input.workspaceRootPath,
    sessionId: input.sessionId,
    title: envelope.title,
    kind: envelope.kind,
    document: envelope.document,
  });
}
```

Register commands:

```ts
registerCommand("canvas.preset.list", z.object({ workspaceId: z.string() }), async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  return getCanvasServiceOrThrow(ctx).listPresets();
});

registerCommand(
  "canvas.create-from-preset",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string().optional(),
    presetId: CanvasPresetIdSchema,
    title: z.string(),
    openInEditor: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await getCanvasServiceOrThrow(ctx).createFromPreset({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sessionId: args.sessionId,
      presetId: args.presetId,
      title: args.title,
    });
    if (args.openInEditor) {
      broadcastCanvasOpen(ctx, {
        workspaceId: args.workspaceId,
        canvasId: result.record.id,
        title: result.record.title,
        artifactType: result.record.artifactType,
        sourcePath: result.record.sourcePath,
      });
    }
    return result;
  }
);
```

- [ ] **Step 4: Re-run focused server tests**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/canvas/presets.ts packages/server/src/canvas/service.ts packages/server/src/canvas/service.test.ts packages/server/src/commands/canvas.ts packages/server/src/commands/canvas.test.ts
git commit -m "feat: add canvas preset creation flow"
```

### Task 3: Add Immutable Snapshot Storage And Delivery

**Files:**
- Create: `packages/server/src/storage/repositories/canvas-snapshot-repo.ts`
- Create: `packages/server/src/routes/canvas-snapshots.ts`
- Create: `packages/server/src/routes/canvas-snapshots.test.ts`
- Modify: `packages/server/src/storage/index.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/canvas/service.test.ts`
- Modify: `packages/server/src/commands/canvas.ts`
- Modify: `packages/server/src/commands/canvas.test.ts`
- Test: `packages/server/src/canvas/service.test.ts`
- Test: `packages/server/src/routes/canvas-snapshots.test.ts`
- Test: `packages/server/src/commands/canvas.test.ts`

- [ ] **Step 1: Write failing snapshot tests**

Add service and route tests:

```ts
it("creates an immutable snapshot from a canvas source path", async () => {
  const snapshot = await service.createSnapshot({
    workspaceId: "ws-1",
    workspaceRootPath: workspaceRoot,
    sourcePath: created.record.sourcePath,
  });

  expect(snapshot.snapshotId).toMatch(/^snapshot_/);
  expect(snapshot.compiledDocument.kind).toBe("report_canvas");
});

it("serves snapshot payloads by snapshot id", async () => {
  const response = await app.inject({
    method: "GET",
    url: "/api/canvas-snapshots/snapshot_123",
  });

  expect(response.statusCode).toBe(200);
  expect(response.json()).toMatchObject({ snapshotId: "snapshot_123" });
});
```

Command test:

```ts
const snapshotResult = await dispatch(
  command("canvas.snapshot.create", {
    workspaceId: "ws-1",
    sourcePath: created.record.sourcePath,
  }),
  ctx
);
expect(snapshotResult.ok).toBe(true);
```

- [ ] **Step 2: Run focused snapshot tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas-snapshots.test.ts`

Expected: FAIL because snapshot storage, route registration, and commands do not exist yet.

- [ ] **Step 3: Implement snapshot repo and service methods**

Create `packages/server/src/storage/repositories/canvas-snapshot-repo.ts`:

```ts
import { join } from "node:path";
import type { CanvasDocumentEnvelope, CanvasSnapshotDataResponse } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface CanvasSnapshotRecord extends CanvasSnapshotDataResponse {
  source: CanvasDocumentEnvelope;
}

interface CanvasSnapshotRepoOptions {
  filePath: string;
}

export class CanvasSnapshotRepo {
  constructor(private readonly options: CanvasSnapshotRepoOptions) {}

  get(snapshotId: string): CanvasSnapshotRecord | undefined {
    const snapshots = readJsonFile<Record<string, CanvasSnapshotRecord>>(this.options.filePath) ?? {};
    return snapshots[snapshotId];
  }

  upsert(record: CanvasSnapshotRecord): CanvasSnapshotRecord {
    const snapshots = readJsonFile<Record<string, CanvasSnapshotRecord>>(this.options.filePath) ?? {};
    snapshots[record.snapshotId] = record;
    writeJsonFileAtomic(this.options.filePath, snapshots);
    return record;
  }
}
```

Extend `CanvasService` constructor deps with `canvasSnapshotRepo`, then add:

```ts
async createSnapshot(input: {
  workspaceId: string;
  workspaceRootPath: string;
  sourcePath: string;
}): Promise<CanvasSnapshotDataResponse> {
  const canvas = await this.getCanvasData(input);
  if (canvas.renderStatus !== "ready" || !canvas.compiledDocument) {
    throw { code: "canvas_snapshot_unavailable", message: "Only ready canvases can be snapshotted" };
  }

  const sourceRead = await readFile(input.workspaceId, input.workspaceRootPath, input.sourcePath);
  if (sourceRead.kind !== "text") {
    throw { code: "canvas_source_invalid", message: "Canvas source must be text" };
  }

  const snapshotId = `snapshot_${this.now()}_${randomBytes(4).toString("hex")}`;
  const source = parseCanvasDocumentEnvelope(JSON.parse(sourceRead.content));
  const snapshot = this.options.canvasSnapshotRepo.upsert({
    snapshotId,
    workspaceId: input.workspaceId,
    title: canvas.title,
    kind: canvas.kind,
    createdAt: this.now(),
    sourceHash: sourceRead.baseHash,
    compiledDocument: canvas.compiledDocument,
    source,
  });

  return {
    snapshotId: snapshot.snapshotId,
    workspaceId: snapshot.workspaceId,
    title: snapshot.title,
    kind: snapshot.kind,
    createdAt: snapshot.createdAt,
    sourceHash: snapshot.sourceHash,
    compiledDocument: snapshot.compiledDocument,
  };
}

getSnapshot(snapshotId: string): CanvasSnapshotDataResponse {
  const snapshot = this.options.canvasSnapshotRepo.get(snapshotId);
  if (!snapshot) {
    throw { code: "canvas_snapshot_not_found", message: `Canvas snapshot not found: ${snapshotId}` };
  }
  return {
    snapshotId: snapshot.snapshotId,
    workspaceId: snapshot.workspaceId,
    title: snapshot.title,
    kind: snapshot.kind,
    createdAt: snapshot.createdAt,
    sourceHash: snapshot.sourceHash,
    compiledDocument: snapshot.compiledDocument,
  };
}
```

Wire the repo in `packages/server/src/server.ts`:

```ts
const canvasSnapshotRepo = new CanvasSnapshotRepo({
  filePath: join(stateRoot, "state", "canvases", "snapshots.json"),
});
const canvasService = new CanvasService({
  canvasRepo,
  canvasSnapshotRepo,
  now: () => Date.now(),
});
```

Register the route in `packages/server/src/app.ts` and add a new route file:

```ts
app.get("/api/canvas-snapshots/:snapshotId", async (request, reply) => {
  const { snapshotId } = request.params as { snapshotId: string };
  try {
    return reply.send(deps.canvasService.getSnapshot(snapshotId));
  } catch (error) {
    if ((error as { code?: string }).code === "canvas_snapshot_not_found") {
      return reply.status(404).send({ error: "canvas_snapshot_not_found" });
    }
    throw error;
  }
});
```

Register the command:

```ts
registerCommand(
  "canvas.snapshot.create",
  z.object({
    workspaceId: z.string(),
    sourcePath: z.string(),
  }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    return getCanvasServiceOrThrow(ctx).createSnapshot({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sourcePath: args.sourcePath,
    });
  }
);
```

- [ ] **Step 4: Re-run focused snapshot tests**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas-snapshots.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/canvas-snapshot-repo.ts packages/server/src/routes/canvas-snapshots.ts packages/server/src/routes/canvas-snapshots.test.ts packages/server/src/storage/index.ts packages/server/src/server.ts packages/server/src/app.ts packages/server/src/canvas/service.ts packages/server/src/canvas/service.test.ts packages/server/src/commands/canvas.ts packages/server/src/commands/canvas.test.ts
git commit -m "feat: add immutable canvas snapshots"
```

### Task 4: Add Clone Flow For Editable Working Copies

**Files:**
- Modify: `packages/server/src/canvas/service.ts`
- Modify: `packages/server/src/canvas/service.test.ts`
- Modify: `packages/server/src/commands/canvas.ts`
- Modify: `packages/server/src/commands/canvas.test.ts`
- Test: `packages/server/src/canvas/service.test.ts`
- Test: `packages/server/src/commands/canvas.test.ts`

- [ ] **Step 1: Write failing clone tests**

Add service tests for source-backed and snapshot-backed clone flows:

```ts
it("duplicates an existing canvas into a new editable source file", async () => {
  const clone = await service.cloneCanvas({
    workspaceId: "ws-1",
    workspaceRootPath: workspaceRoot,
    sourcePath: created.record.sourcePath,
    title: "Runtime Flow Copy",
  });

  expect(clone.record.sourcePath).toBe(".coder-studio/canvases/runtime-flow-copy.csc");
  expect(clone.source.title).toBe("Runtime Flow Copy");
});

it("duplicates a snapshot into a new editable source file", async () => {
  const snapshot = await service.createSnapshot({
    workspaceId: "ws-1",
    workspaceRootPath: workspaceRoot,
    sourcePath: created.record.sourcePath,
  });

  const clone = await service.cloneCanvas({
    workspaceId: "ws-1",
    workspaceRootPath: workspaceRoot,
    snapshotId: snapshot.snapshotId,
    title: "Recovered Copy",
  });

  expect(clone.source.title).toBe("Recovered Copy");
});
```

Command test:

```ts
const cloneResult = await dispatch(
  command("canvas.clone", {
    workspaceId: "ws-1",
    sourcePath: created.record.sourcePath,
    title: "Runtime Flow Copy",
  }),
  ctx
);
expect(cloneResult.ok).toBe(true);
```

- [ ] **Step 2: Run focused clone tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts`

Expected: FAIL because clone logic does not exist yet.

- [ ] **Step 3: Implement minimal clone behavior**

Extend `CanvasService`:

```ts
async cloneCanvas(input: {
  workspaceId: string;
  workspaceRootPath: string;
  sourcePath?: string;
  snapshotId?: string;
  title: string;
  sessionId?: string;
}) {
  const sourceEnvelope =
    input.snapshotId !== undefined
      ? this.options.canvasSnapshotRepo.get(input.snapshotId)?.source
      : await this.readCanvasSourceEnvelope({
          workspaceId: input.workspaceId,
          workspaceRootPath: input.workspaceRootPath,
          sourcePath: input.sourcePath ?? "",
        });

  if (!sourceEnvelope) {
    throw {
      code: input.snapshotId ? "canvas_snapshot_not_found" : "canvas_not_found",
      message: "Canvas source not found",
    };
  }

  return this.create({
    workspaceId: input.workspaceId,
    workspaceRootPath: input.workspaceRootPath,
    sessionId: input.sessionId,
    title: input.title,
    kind: sourceEnvelope.kind,
    document: sourceEnvelope.document,
  });
}
```

If `readCanvasSourceEnvelope` does not exist, extract it from the existing `getCanvasData` source-read path rather than duplicating file parsing logic.

Register the clone command:

```ts
registerCommand(
  "canvas.clone",
  z
    .object({
      workspaceId: z.string(),
      sessionId: z.string().optional(),
      sourcePath: z.string().optional(),
      snapshotId: z.string().optional(),
      title: z.string(),
      openInEditor: z.boolean().optional(),
    })
    .refine((value) => Boolean(value.sourcePath || value.snapshotId), {
      message: "sourcePath or snapshotId is required",
    }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await getCanvasServiceOrThrow(ctx).cloneCanvas({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sessionId: args.sessionId,
      sourcePath: args.sourcePath,
      snapshotId: args.snapshotId,
      title: args.title,
    });
    if (args.openInEditor) {
      broadcastCanvasOpen(ctx, {
        workspaceId: args.workspaceId,
        canvasId: result.record.id,
        title: result.record.title,
        artifactType: result.record.artifactType,
        sourcePath: result.record.sourcePath,
      });
    }
    return result;
  }
);
```

- [ ] **Step 4: Re-run focused clone tests**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/canvas/service.ts packages/server/src/canvas/service.test.ts packages/server/src/commands/canvas.ts packages/server/src/commands/canvas.test.ts
git commit -m "feat: add canvas clone flow"
```

### Task 5: Add Snapshot Fetch And Read-Only Web Rendering

**Files:**
- Modify: `packages/web/src/features/canvas/api.ts`
- Modify: `packages/web/src/features/canvas/api.test.ts`
- Modify: `packages/web/src/features/canvas/components/canvas-content.tsx`
- Create: `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.tsx`
- Create: `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx`
- Test: `packages/web/src/features/canvas/api.test.ts`
- Test: `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx`

- [ ] **Step 1: Write failing web tests**

Add an API test and route test:

```ts
it("fetches a canvas snapshot payload", async () => {
  const result = await fetchCanvasSnapshotData("snapshot_123");
  expect(result.snapshotId).toBe("snapshot_123");
});
```

```tsx
it("renders a report snapshot without requiring workspaceId and sourcePath", async () => {
  render(
    <MemoryRouter initialEntries={["/embedded/canvas-snapshot/snapshot_123"]}>
      <Routes>
        <Route
          path="/embedded/canvas-snapshot/:snapshotId"
          element={<EmbeddedCanvasSnapshotRoute />}
        />
      </Routes>
    </MemoryRouter>
  );

  expect(await screen.findByRole("heading", { level: 1, name: "Weekly Metrics" })).toBeInTheDocument();
});
```

- [ ] **Step 2: Run focused web tests to verify they fail**

Run: `pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx`

Expected: FAIL because snapshot fetch and route files do not exist yet.

- [ ] **Step 3: Implement snapshot fetch and read-only route**

Extend `packages/web/src/features/canvas/api.ts`:

```ts
import {
  type CanvasDataResponse,
  CanvasDataResponseSchema,
  type CanvasSnapshotDataResponse,
  CanvasSnapshotDataResponseSchema,
} from "@coder-studio/core";

async function readSnapshotJson(response: Response): Promise<CanvasSnapshotDataResponse> {
  if (!response.ok) {
    throw new Error(`canvas_request_failed:${response.status}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("canvas_response_invalid");
  }

  return CanvasSnapshotDataResponseSchema.parse(payload);
}

export async function fetchCanvasSnapshotData(
  snapshotId: string
): Promise<CanvasSnapshotDataResponse> {
  const response = await fetch(`/api/canvas-snapshots/${encodeURIComponent(snapshotId)}`, {
    credentials: "include",
  });

  return readSnapshotJson(response);
}
```

Create `packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import type { CanvasSnapshotDataResponse } from "@coder-studio/core";
import { fetchCanvasSnapshotData } from "../api";
import { CanvasRouteFrame } from "../components/canvas-route-frame";
import { ArchitectureCanvasRenderer } from "../components/architecture-canvas-renderer";
import { ReportCanvasRenderer } from "../components/report-canvas-renderer";

export function EmbeddedCanvasSnapshotRoute() {
  const { snapshotId } = useParams<{ snapshotId: string }>();
  const [data, setData] = useState<CanvasSnapshotDataResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!snapshotId) {
      setError("Canvas snapshot route is missing snapshot id.");
      return;
    }

    let cancelled = false;
    void fetchCanvasSnapshotData(snapshotId)
      .then((response) => {
        if (!cancelled) {
          setData(response);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setError(nextError instanceof Error ? nextError.message : "Failed to load snapshot.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [snapshotId]);

  if (error) {
    return <CanvasRouteFrame layout="page" error={<p style={{ margin: 0 }}>{error}</p>} />;
  }

  if (!data) {
    return <CanvasRouteFrame layout="page" loading />;
  }

  if (data.compiledDocument.kind === "architecture_canvas") {
    return (
      <CanvasRouteFrame
        layout="page"
        title={data.compiledDocument.title}
        summary={data.compiledDocument.summary}
        variant="architecture"
      >
        <ArchitectureCanvasRenderer canvas={data.compiledDocument} />
      </CanvasRouteFrame>
    );
  }

  return (
    <CanvasRouteFrame layout="page" title={data.compiledDocument.title}>
      <ReportCanvasRenderer canvas={data.compiledDocument} />
    </CanvasRouteFrame>
  );
}
```

Do not merge snapshot fetch logic into `EmbeddedCanvasRoute`; keep editable and immutable entry points separate.

- [ ] **Step 4: Re-run focused web tests**

Run: `pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/canvas/api.ts packages/web/src/features/canvas/api.test.ts packages/web/src/features/canvas/components/canvas-content.tsx packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.tsx packages/web/src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx
git commit -m "feat: add canvas snapshot rendering route"
```

### Task 6: Update Built-In Canvas Skill Guidance

**Files:**
- Modify: `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts`
- Modify: `packages/server/src/__tests__/skills/builtin-registry.test.ts`
- Modify: `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`
- Test: `packages/server/src/__tests__/skills/builtin-registry.test.ts`
- Test: `packages/server/src/__tests__/server-builtin-skills-wiring.test.ts`

- [ ] **Step 1: Write failing skill assertions**

Add assertions like:

```ts
expect(canvasContent).toContain("canvas.preset.list");
expect(canvasContent).toContain("canvas.create-from-preset");
expect(canvasContent).toContain("canvas.snapshot.create");
expect(canvasContent).toContain("canvas.clone");
expect(canvasContent).toContain("/embedded/canvas-snapshot/:snapshotId");
```

- [ ] **Step 2: Run the skill tests to verify they fail**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts`

Expected: FAIL before the built-in skill text is updated.

- [ ] **Step 3: Update the skill guidance**

Extend `packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts` with concise new guidance:

```md
## Presets

```bash
node "<automation>" canvas.preset.list --json
node "<automation>" canvas.create-from-preset --preset-id token-consumption-trend --title "<title>" --open --json
```

## Snapshots

```bash
node "<automation>" canvas.snapshot.create --source-path .coder-studio/canvases/<title-slug>.csc --json
```

Open the read-only route:

```text
/embedded/canvas-snapshot/<snapshot-id>
```

## Clone

```bash
node "<automation>" canvas.clone --source-path .coder-studio/canvases/<title-slug>.csc --title "<new-title>" --open --json
```
```

Keep the existing chart authoring guidance intact.

- [ ] **Step 4: Re-run the skill tests**

Run: `pnpm --dir packages/server exec vitest run src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/skills/builtin/definitions/coder-studio-canvas.ts packages/server/src/__tests__/skills/builtin-registry.test.ts packages/server/src/__tests__/server-builtin-skills-wiring.test.ts
git commit -m "docs: extend canvas skill guidance for presets and snapshots"
```

### Task 7: Full Verification

**Files:**
- All files modified in Tasks 1-6

- [ ] **Step 1: Run core verification**

Run: `pnpm --dir packages/core exec vitest run src/domain/canvas.test.ts`

Expected: PASS.

- [ ] **Step 2: Run server verification**

Run: `pnpm --dir packages/server exec vitest run src/canvas/service.test.ts src/commands/canvas.test.ts src/routes/canvas.test.ts src/routes/canvas-snapshots.test.ts src/__tests__/skills/builtin-registry.test.ts src/__tests__/server-builtin-skills-wiring.test.ts`

Expected: PASS.

- [ ] **Step 3: Run web verification**

Run: `pnpm --dir packages/web exec vitest run src/features/canvas/api.test.ts src/features/canvas/routes/embedded-canvas-route.test.tsx src/features/canvas/routes/embedded-canvas-snapshot-route.test.tsx`

Expected: PASS.

- [ ] **Step 4: Run repository build verification**

Run: `pnpm build`

Expected: PASS with no new errors.

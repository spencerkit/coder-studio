# Canvas PNG Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a client-side PNG download action for the inline editor canvas that exports the full canvas content, saved overlay annotations, and saved comments without exporting editor chrome.

**Architecture:** Keep the current mixed renderer stack intact and export one dedicated canvas content root from `CanvasContent`. Add a lightweight on-canvas saved comment layer, an explicit export render mode that suppresses editor-only affordances, and a focused DOM-to-image helper that `CanvasSurface` can call after validating comment-draft state.

**Tech Stack:** TypeScript, React, Vitest, jsdom, existing canvas web UI, lightweight DOM-to-image dependency

---

## File Map

- `packages/web/package.json`
  Add the PNG export dependency used by the web-only export helper.
- `pnpm-lock.yaml`
  Capture the workspace lockfile update from adding the web export dependency.
- `packages/web/src/features/canvas/components/canvas-comment-layer.tsx`
  New focused component for rendering saved comments as visible anchored bubbles inside the exportable canvas content tree.
- `packages/web/src/features/canvas/components/canvas-comment-layer.test.tsx`
  Cover comment marker placement, resolved/open styling, and export-friendly rendering.
- `packages/web/src/features/canvas/utils/export-canvas-png.ts`
  New client-side helper that converts one DOM subtree into a PNG download.
- `packages/web/src/features/canvas/utils/export-canvas-png.test.ts`
  Cover helper success and failure behavior with mocked DOM/image export primitives.
- `packages/web/src/features/canvas/components/canvas-content.tsx`
  Expose one export root, surface export readiness and draft-block state, render saved comments inside the scene, and support export mode that hides editor-only affordances.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
  Add the `Export PNG` control, manage export state, block on unsaved drafts, and trigger download through the export helper.
- `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`
  Cover button rendering, blocked export, successful export invocation, and failure-state messaging.
- `packages/web/src/locales/en.json`
  Add English strings for export action, blocked export, export failure, and export progress.
- `packages/web/src/locales/zh.json`
  Add Chinese strings for the same UI.
- `packages/web/src/styles/components.css`
  Add saved-comment bubble styling, export button alignment, and export-mode state classes.

## Final Verification

Run these after all tasks are complete:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/canvas-comment-layer.test.tsx src/features/canvas/utils/export-canvas-png.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx
pnpm --dir packages/web build
pnpm build
```

Expected: all targeted tests pass, the web package builds, and the full repo build exits `0`.

## Task 1: Add A Focused PNG Export Helper

**Files:**
- Modify: `packages/web/package.json`
- Modify: `pnpm-lock.yaml`
- Create: `packages/web/src/features/canvas/utils/export-canvas-png.ts`
- Create: `packages/web/src/features/canvas/utils/export-canvas-png.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Create `packages/web/src/features/canvas/utils/export-canvas-png.test.ts` with success and failure coverage around one narrow API:

```ts
// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

const toPngMock = vi.fn();

vi.mock("html-to-image", () => ({
  toPng: toPngMock,
}));

import { exportCanvasPng } from "./export-canvas-png";

describe("exportCanvasPng", () => {
  const createObjectURL = vi.fn(() => "blob:canvas");
  const revokeObjectURL = vi.fn();

  beforeEach(() => {
    vi.restoreAllMocks();
    toPngMock.mockReset();
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    vi.stubGlobal(
      "URL",
      Object.assign(globalThis.URL ?? {}, {
        createObjectURL,
        revokeObjectURL,
      })
    );
  });

  it("downloads a png for the provided element", async () => {
    document.body.innerHTML = `<div data-testid="root">canvas export</div>`;
    const root = document.querySelector("[data-testid='root']") as HTMLElement;
    toPngMock.mockResolvedValue("data:image/png;base64,abc123");

    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await exportCanvasPng({
      element: root,
      filename: "runtime-flow.png",
    });

    expect(toPngMock).toHaveBeenCalledWith(root, expect.objectContaining({ pixelRatio: 1 }));
    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("throws when no element is provided", async () => {
    await expect(
      exportCanvasPng({
        element: null,
        filename: "runtime-flow.png",
      })
    ).rejects.toThrow("canvas_export_root_missing");
  });
});
```

- [ ] **Step 2: Run the helper test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/utils/export-canvas-png.test.ts
```

Expected: FAIL because the helper file does not exist and `html-to-image` is not installed.

- [ ] **Step 3: Add the export dependency**

Update `packages/web/package.json` dependencies to include a lightweight DOM-to-image library:

```json
{
  "dependencies": {
    "@coder-studio/core": "workspace:*",
    "@coder-studio/utils": "workspace:*",
    "@tanstack/react-router": "^1.169.1",
    "@xterm/addon-fit": "^0.11.0",
    "@xterm/addon-webgl": "^0.19.0",
    "@xterm/xterm": "^6.0.0",
    "@xyflow/react": "^12.11.0",
    "clsx": "^2.1.1",
    "echarts": "^6.1.0",
    "elkjs": "^0.11.1",
    "html-to-image": "^1.11.13",
    "jotai": "^2.19.1",
    "jotai-family": "^1.0.1",
    "lucide-react": "^1.14.0",
    "markdown-it": "^14.1.0",
    "monaco-editor": "^0.55.1",
    "react": "^19.2.5",
    "react-dom": "^19.2.5",
    "react-router-dom": "^7.14.2"
  }
}
```

- [ ] **Step 4: Install dependencies and refresh the lockfile**

Run:

```bash
pnpm install
```

Expected: PASS and `pnpm-lock.yaml` includes the new `html-to-image` entry.

- [ ] **Step 5: Implement the helper**

Create `packages/web/src/features/canvas/utils/export-canvas-png.ts` with one small API:

```ts
import { toPng } from "html-to-image";

interface ExportCanvasPngInput {
  element: HTMLElement | null;
  filename: string;
}

export async function exportCanvasPng({
  element,
  filename,
}: ExportCanvasPngInput): Promise<void> {
  if (!element) {
    throw new Error("canvas_export_root_missing");
  }

  const dataUrl = await toPng(element, {
    cacheBust: true,
    pixelRatio: 1,
  });

  const link = document.createElement("a");
  link.download = filename;
  link.href = dataUrl;
  link.click();
}
```

- [ ] **Step 6: Run the helper test to verify it passes**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/utils/export-canvas-png.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/web/package.json pnpm-lock.yaml packages/web/src/features/canvas/utils/export-canvas-png.ts packages/web/src/features/canvas/utils/export-canvas-png.test.ts
git commit -m "feat: add canvas png export helper"
```

## Task 2: Render Saved Comments Inside The Canvas Content Layer

**Files:**
- Create: `packages/web/src/features/canvas/components/canvas-comment-layer.tsx`
- Create: `packages/web/src/features/canvas/components/canvas-comment-layer.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing saved-comment layer tests**

Create `packages/web/src/features/canvas/components/canvas-comment-layer.test.tsx`:

```tsx
// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { CanvasAnchorCommentDocument } from "@coder-studio/core";
import { CanvasCommentLayer } from "./canvas-comment-layer";

const comments: CanvasAnchorCommentDocument = {
  version: 1,
  comments: [
    {
      id: "comment-open",
      elementIds: ["chart-point:prompt:10:00"],
      targets: [],
      selectionRect: { x: 112, y: 40, width: 28, height: 24 },
      body: "Explain this peak.",
      status: "open",
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    },
    {
      id: "comment-resolved",
      elementIds: ["chart-point:completion:11:00"],
      targets: [],
      selectionRect: { x: 220, y: 96, width: 24, height: 24 },
      body: "Resolved note.",
      status: "resolved",
      createdAt: "2026-06-29T10:00:00.000Z",
      updatedAt: "2026-06-29T10:00:00.000Z",
    },
  ],
};

describe("CanvasCommentLayer", () => {
  it("renders saved comments as anchored bubbles", () => {
    render(<CanvasCommentLayer document={comments} />);

    expect(screen.getByText("Explain this peak.")).toBeInTheDocument();
    expect(screen.getByText("Resolved note.")).toBeInTheDocument();
  });

  it("marks resolved comments with a weaker style hook", () => {
    render(<CanvasCommentLayer document={comments} />);

    expect(screen.getByTestId("canvas-comment-comment-resolved")).toHaveClass(
      "canvas-comment-layer__item--resolved"
    );
  });
});
```

- [ ] **Step 2: Run the comment-layer test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/canvas-comment-layer.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the comment layer**

Create `packages/web/src/features/canvas/components/canvas-comment-layer.tsx`:

```tsx
import type { CanvasAnchorCommentDocument } from "@coder-studio/core";

interface CanvasCommentLayerProps {
  document: CanvasAnchorCommentDocument;
}

function getCommentPosition(comment: CanvasAnchorCommentDocument["comments"][number]) {
  const { selectionRect } = comment;
  return {
    left: selectionRect.x + selectionRect.width + 8,
    top: Math.max(0, selectionRect.y - 4),
  };
}

export function CanvasCommentLayer({ document }: CanvasCommentLayerProps) {
  if (document.comments.length === 0) {
    return null;
  }

  return (
    <div className="canvas-comment-layer" data-testid="canvas-comment-layer">
      {document.comments.map((comment) => {
        const position = getCommentPosition(comment);
        return (
          <article
            className={`canvas-comment-layer__item${
              comment.status === "resolved" ? " canvas-comment-layer__item--resolved" : ""
            }`}
            data-testid={`canvas-comment-${comment.id}`}
            key={comment.id}
            style={{ left: `${position.left}px`, top: `${position.top}px` }}
          >
            <p className="canvas-comment-layer__body">{comment.body}</p>
          </article>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Add the saved-comment styles**

Append focused comment styles in `packages/web/src/styles/components.css` near the existing canvas rules:

```css
.canvas-comment-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.canvas-comment-layer__item {
  position: absolute;
  max-width: 240px;
  padding: 10px 12px;
  border-radius: 12px;
  border: 1px solid rgba(15, 118, 110, 0.18);
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.08);
  color: var(--text-primary);
}

.canvas-comment-layer__item--resolved {
  opacity: 0.65;
}

.canvas-comment-layer__body {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.45;
}
```

- [ ] **Step 5: Run the comment-layer test to verify it passes**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/canvas-comment-layer.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/features/canvas/components/canvas-comment-layer.tsx packages/web/src/features/canvas/components/canvas-comment-layer.test.tsx packages/web/src/styles/components.css
git commit -m "feat: add visible saved comment layer"
```

## Task 3: Extend CanvasContent With Export Mode And Export State

**Files:**
- Modify: `packages/web/src/features/canvas/components/canvas-content.tsx`
- Modify: `packages/web/src/features/canvas/components/canvas-overlay-layer.tsx`
- Modify: `packages/web/src/features/canvas/components/canvas-comment-layer.tsx`

- [ ] **Step 1: Write the failing content/export-state tests in the existing surface suite**

Extend `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx` with expectations that rely on `CanvasContent` surfacing export state:

```tsx
it("blocks export while an inspect comment draft is unsaved", async () => {
  vi.mocked(fetchCanvasInspectionData).mockResolvedValue(tokenConsumptionPayload);

  renderCanvasSurface({
    sourcePath: ".coder-studio/canvases/token-consumption.csc",
    title: "Token Consumption",
  });

  await screen.findByText("Token Consumption");
  fireEvent.click(screen.getByRole("button", { name: "Inspect canvas" }));
  fireEvent.pointerDown(document.querySelector(".canvas-overlay-layer__scene") as Element, {
    button: 0,
    clientX: 120,
    clientY: 48,
  });
  fireEvent.change(screen.getByPlaceholderText("Describe what should change"), {
    target: { value: "Add a warning note" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Export PNG" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Save the comment before exporting");
});
```

- [ ] **Step 2: Run the surface test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: FAIL because there is no export button, no export state, and no alert path.

- [ ] **Step 3: Add export-state props to CanvasContent**

Refactor `CanvasContent` so `CanvasSurface` can drive export without reaching into internal state directly:

```ts
export interface CanvasContentExportState {
  exportRoot: HTMLElement | null;
  hasUnsavedCommentDraft: boolean;
  ready: boolean;
}

interface CanvasContentProps {
  workspaceId: string;
  sourcePath: string;
  refreshToken?: number;
  layout?: CanvasContentLayout;
  editable?: boolean;
  inspectionEnabled?: boolean;
  annotationTool?: CanvasAnnotationTool;
  annotationCommand?: CanvasAnnotationCommand | null;
  exportMode?: boolean;
  onExportStateChange?: (state: CanvasContentExportState) => void;
}
```

Inside `CanvasContent`, publish export state whenever loading, draft, or root-node status changes:

```ts
useEffect(() => {
  onExportStateChange?.({
    exportRoot: sceneRootRef.current,
    hasUnsavedCommentDraft: commentDraft.trim().length > 0,
    ready: !loading && !!data?.compiledDocument,
  });
}, [commentDraft, data, loading, onExportStateChange]);
```

- [ ] **Step 4: Render comments inside the scene and add export-mode classes**

In both architecture and report render branches inside `CanvasContent`, keep one shared content root:

```tsx
<div
  className={`canvas-content__scene${exportMode ? " canvas-content__scene--export" : ""}`}
  data-scene-element-count={effectiveSceneManifest.elements.length}
  ref={sceneRootRef}
>
  <ReportCanvasRenderer
    canvas={data.compiledDocument}
    sceneRegistry={sceneRegistry}
    sceneRootRef={sceneRootRef}
  />
  <CanvasCommentLayer document={anchorCommentDocument} />
  <CanvasOverlayLayer
    annotationCommand={annotationCommand}
    editable={editable}
    exportMode={exportMode}
    inspectSelectionElementId={selectedSceneElementId}
    onInspectSelectionChange={(element) => {
      setSelectedSceneElementId(element?.id ?? null);
      setCommentDraft("");
      setSaveCommentError(null);
    }}
    onChange={(overlayDocument) => {
      void persistOverlay(workspaceId, sourcePath, overlayDocument, setData);
    }}
    overlayDocument={data.overlayDocument}
    semanticElements={effectiveSceneManifest.elements}
    tool={annotationTool}
  />
</div>
```

Hide the inspect composer while `exportMode` is true:

```tsx
if (exportMode) {
  return null;
}
```

- [ ] **Step 5: Suppress editor-only overlay affordances during export**

Extend `CanvasOverlayLayer` with one prop and use it to suppress selection handles, inspect highlight, and the textarea:

```ts
interface CanvasOverlayLayerProps {
  annotationCommand?: CanvasAnnotationCommand | null;
  editable?: boolean;
  exportMode?: boolean;
  inspectSelectionElementId?: string | null;
  onInspectSelectionChange?: (element: CanvasSceneElement | null) => void;
  onChange?: (overlayDocument: CanvasOverlayDocument) => void;
  overlayDocument: CanvasOverlayDocument;
  semanticElements?: CanvasSceneElement[];
  tool?: CanvasAnnotationTool;
}
```

Then gate the interactive pieces:

```tsx
{!exportMode && inspectSelection ? (
  <rect
    className="canvas-overlay-layer__inspect-selection"
    fill="none"
    height={inspectSelection.rect.height}
    width={inspectSelection.rect.width}
    x={inspectSelection.rect.x}
    y={inspectSelection.rect.y}
  />
) : null}

{!exportMode && selectedObject ? renderSelectionOutline(selectedObject) : null}

{!exportMode && editable && tool === "select" && selectedObject
  ? renderSelectionHandles(selectedObject, handleSelectionHandlePointerDown)
  : null}

{!exportMode && textDraft ? (
  <textarea
    autoFocus
    className="canvas-overlay-layer__textarea"
    onBlur={handleTextBlur}
    onChange={(event) =>
      setTextDraft((current) =>
        current
          ? {
              ...current,
              value: event.target.value,
            }
          : current
      )
    }
    style={{
      left: `${textDraft.x}px`,
      top: `${textDraft.y}px`,
    }}
    value={textDraft.value}
  />
) : null}
```

- [ ] **Step 6: Re-run the surface test to verify the export-state plumbing is now reachable**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: still FAIL, but now on the missing `CanvasSurface` export control or messages instead of missing `CanvasContent` plumbing.

- [ ] **Step 7: Commit**

```bash
git add packages/web/src/features/canvas/components/canvas-content.tsx packages/web/src/features/canvas/components/canvas-overlay-layer.tsx packages/web/src/features/canvas/components/canvas-comment-layer.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx
git commit -m "refactor: expose canvas export state"
```

## Task 4: Add Export UI, Blocking Rules, And Failure Messaging In CanvasSurface

**Files:**
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx`

- [ ] **Step 1: Add failing UI assertions for successful and failed export**

Extend `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx` with export success/failure tests:

```tsx
const exportCanvasPngMock = vi.fn();

vi.mock("../../../canvas/utils/export-canvas-png", () => ({
  exportCanvasPng: exportCanvasPngMock,
}));

it("exports the canvas content root as png", async () => {
  vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);
  let resolveExport: (() => void) | null = null;
  exportCanvasPngMock.mockImplementation(
    ({ element }: { element: HTMLElement }) =>
      new Promise<void>((resolve) => {
        expect(element.querySelector(".canvas-overlay-layer__textarea")).toBeNull();
        expect(document.querySelector(".canvas-content__scene--export")).toBeTruthy();
        resolveExport = resolve;
      })
  );

  renderCanvasSurface();
  await screen.findByText("Runtime Flow");

  fireEvent.click(screen.getByRole("button", { name: "Export PNG" }));

  await waitFor(() => {
    expect(document.querySelector(".canvas-content__scene--export")).toBeTruthy();
  });

  resolveExport?.();

  await waitFor(() => {
    expect(exportCanvasPngMock).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "Runtime Flow.png" })
    );
  });
});

it("shows an inline export error when png export fails", async () => {
  vi.mocked(fetchCanvasInspectionData).mockResolvedValue(runtimeFlowPayload);
  exportCanvasPngMock.mockRejectedValue(new Error("boom"));

  renderCanvasSurface();
  await screen.findByText("Runtime Flow");

  fireEvent.click(screen.getByRole("button", { name: "Export PNG" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Failed to export canvas");
});
```

- [ ] **Step 2: Run the surface test to verify it fails**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: FAIL because `CanvasSurface` does not yet render the export control or call the helper.

- [ ] **Step 3: Implement the export button and status flow**

Update `CanvasSurface`:

```tsx
import { Button, EmptyState, IconButton, Notice, Tooltip } from "../../../../components/ui";
import { exportCanvasPng } from "../../../canvas/utils/export-canvas-png";
```

Add local state:

```ts
const [exportMode, setExportMode] = useState(false);
const [exporting, setExporting] = useState(false);
const [exportError, setExportError] = useState<string | null>(null);
const [contentExportState, setContentExportState] = useState<CanvasContentExportState>({
  exportRoot: null,
  hasUnsavedCommentDraft: false,
  ready: false,
});
```

Add one export handler:

```ts
function buildCanvasExportFilename(input: { sourcePath: string; title: string }) {
  const trimmedTitle = input.title.trim();
  if (trimmedTitle.length > 0) {
    return `${trimmedTitle}.png`;
  }

  const sourceFile = input.sourcePath.split("/").pop() ?? "canvas";
  const basename = sourceFile.replace(/\.[^.]+$/, "");
  return `${basename}.canvas.png`;
}

async function handleExportPng() {
  if (contentExportState.hasUnsavedCommentDraft) {
    setExportError(t("code_editor.canvas_export_unsaved_comment"));
    return;
  }

  if (!contentExportState.ready || !contentExportState.exportRoot) {
    setExportError(t("code_editor.canvas_export_unavailable"));
    return;
  }

  try {
    setExportError(null);
    setExporting(true);
    setExportMode(true);
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    await exportCanvasPng({
      element: contentExportState.exportRoot,
      filename: buildCanvasExportFilename({
        sourcePath,
        title: tab.title,
      }),
    });
  } catch {
    setExportError(t("code_editor.canvas_export_failed"));
  } finally {
    setExportMode(false);
    setExporting(false);
  }
}
```

Render the button inside `canvas-surface__controls`:

```tsx
<div className="canvas-surface__export-bar">
  <Button
    disabled={!contentExportState.ready || exporting}
    onClick={() => {
      void handleExportPng();
    }}
    size="sm"
    variant="secondary"
  >
    {exporting ? t("code_editor.canvas_export_in_progress") : t("code_editor.canvas_export_png")}
  </Button>
</div>
```

Pass the new props into `CanvasContent`:

```tsx
<CanvasContent
  annotationCommand={annotationCommand}
  annotationTool={annotationTool}
  editable
  exportMode={exportMode}
  inspectionEnabled
  layout="inline"
  onExportStateChange={setContentExportState}
  refreshToken={refreshToken}
  sourcePath={sourcePath}
  workspaceId={workspaceId}
/>
```

Show inline failure messaging above the canvas controls:

```tsx
{exportError ? (
  <Notice role="alert" message={exportError} tone="error" />
) : null}
```

- [ ] **Step 4: Re-run the surface test to verify it passes**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/code-editor/views/shared/canvas-surface.tsx packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx
git commit -m "feat: add canvas png export action"
```

## Task 5: Add Strings And Final Canvas Styling

**Files:**
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write the failing localization/style-driven assertions**

Add or update the translation mock in `packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx` to include these keys:

```ts
"code_editor.canvas_export_png": "Export PNG",
"code_editor.canvas_export_in_progress": "Exporting PNG",
"code_editor.canvas_export_failed": "Failed to export canvas",
"code_editor.canvas_export_unavailable": "Canvas export is unavailable",
"code_editor.canvas_export_unsaved_comment": "Save the comment before exporting",
```

Add one DOM assertion for export-mode styling hooks:

```tsx
expect(document.querySelector(".canvas-content__scene--export")).toBeTruthy();
```

- [ ] **Step 2: Run the surface and comment-layer tests to verify they fail on missing strings or classes**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/canvas-comment-layer.test.tsx src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: FAIL because the strings and styling hooks are not complete yet.

- [ ] **Step 3: Add the localization strings**

Append to `packages/web/src/locales/en.json`:

```json
"code_editor": {
  "canvas_export_png": "Export PNG",
  "canvas_export_in_progress": "Exporting PNG",
  "canvas_export_failed": "Failed to export canvas",
  "canvas_export_unavailable": "Canvas export is unavailable",
  "canvas_export_unsaved_comment": "Save the comment before exporting"
}
```

Append to `packages/web/src/locales/zh.json`:

```json
"code_editor": {
  "canvas_export_png": "导出 PNG",
  "canvas_export_in_progress": "正在导出 PNG",
  "canvas_export_failed": "导出画布失败",
  "canvas_export_unavailable": "当前无法导出画布",
  "canvas_export_unsaved_comment": "请先保存评论再导出"
}
```

- [ ] **Step 4: Finish the export-related CSS**

Extend the canvas section in `packages/web/src/styles/components.css`:

```css
.canvas-surface__controls {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: var(--sp-2);
  justify-content: space-between;
}

.canvas-surface__export-bar {
  display: flex;
  align-items: center;
  gap: var(--sp-2);
}

.canvas-content__scene {
  position: relative;
}

.canvas-content__scene--export .canvas-overlay-layer__scene {
  cursor: default;
}
```

- [ ] **Step 5: Re-run the targeted tests to verify they pass**

Run:

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/canvas-comment-layer.test.tsx src/features/canvas/utils/export-canvas-png.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/src/locales/en.json packages/web/src/locales/zh.json packages/web/src/styles/components.css packages/web/src/features/code-editor/views/shared/canvas-surface.test.tsx
git commit -m "feat: finalize canvas export copy and styles"
```

## Task 6: Final Verification

**Files:**
- No code changes

- [ ] **Step 1: Run the targeted web tests**

```bash
pnpm --dir packages/web exec vitest run src/features/canvas/components/canvas-comment-layer.test.tsx src/features/canvas/utils/export-canvas-png.test.ts src/features/code-editor/views/shared/canvas-surface.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run the web package build**

```bash
pnpm --dir packages/web build
```

Expected: PASS.

- [ ] **Step 3: Run the full repo build**

```bash
pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit any verification-only follow-up fixes**

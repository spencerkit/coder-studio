# Unified Editor Surface Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the split code editor and git diff pages with one unified editor surface that supports `预览`, `编辑`, and `Diff` for the active file, including stacked image diff for non-text assets.

**Architecture:** Introduce workspace-scoped editor mode state, route both desktop and mobile file detail views through a single `EditorSurface`, and split renderer selection by resource kind plus mode instead of by top-level page. Keep textual diff in Monaco, add revision-backed image asset loading on the server for non-text image diff, and downgrade the old git diff preview atom from navigation state to diff payload/cache state.

**Tech Stack:** React 19, TypeScript, Jotai, Monaco Editor, Fastify, existing websocket command dispatch, existing image asset route, Vitest.

**Spec reference:** `docs/superpowers/specs/2026-05-20-unified-editor-surface-design.md`

---

## File Structure

**New files:**
- `packages/web/src/features/code-editor/components/monaco-diff-host.tsx`
- `packages/web/src/features/code-editor/components/monaco-diff-host.test.tsx`
- `packages/web/src/features/code-editor/components/image-diff-preview.tsx`
- `packages/web/src/features/code-editor/components/image-diff-preview.test.tsx`
- `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`
- `packages/server/src/git/image-revision.ts`
- `packages/server/src/__tests__/git/image-revision.test.ts`

**Modified files:**
- `packages/web/src/features/workspace/atoms/files.ts`
- `packages/web/src/features/workspace/atoms/git.ts`
- `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- `packages/web/src/features/workspace/actions/use-file-actions.ts`
- `packages/web/src/features/workspace/actions/use-git-actions.ts`
- `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- `packages/web/src/features/code-editor/components/monaco-host.tsx`
- `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- `packages/web/src/features/code-editor/index.test.tsx`
- `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- `packages/web/src/features/workspace/index.test.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- `packages/web/src/styles/components.css`
- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`
- `packages/server/src/git/diff.ts`
- `packages/server/src/commands/git.ts`
- `packages/server/src/routes/file-asset.ts`
- `packages/server/src/routes/file-asset.test.ts`
- `packages/server/src/__tests__/git-commands.test.ts`

**Likely no changes in this plan:**
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.tsx`
- `packages/web/src/features/workspace/views/shared/git-diff-viewer.test.tsx`

Note:
- The old `GitDiffViewer` can remain temporarily for commit-history diff or as a migration fallback, but new active-file diff flows should stop depending on it.

## Task 1: Add Workspace-Scoped Editor Mode State And Capability Derivation

**Files:**
- Modify: `packages/web/src/features/workspace/atoms/files.ts`
- Modify: `packages/web/src/features/workspace/atoms/git.ts`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Test: `packages/web/src/features/code-editor/index.test.tsx`
- Test: `packages/web/src/features/workspace/index.test.tsx`

- [ ] **Step 1: Write failing tests for editor mode defaults and active-file-owned diff enablement**

Add tests to `packages/web/src/features/code-editor/index.test.tsx` that assert:

```tsx
it("defaults text files to edit mode and images to preview mode", () => {
  expect(true).toBe(false);
});

it("exposes diff only for the active file when git status contains a matching changed path", () => {
  expect(true).toBe(false);
});

it("shows an unsaved warning when diff mode is opened for a dirty text file", () => {
  expect(true).toBe(false);
});
```

Add a workspace-level test in `packages/web/src/features/workspace/index.test.tsx` that asserts the desktop main area does not switch to a dedicated git diff page when a file is active.

- [ ] **Step 2: Run the focused web tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- new assertions fail because there is no editor mode atom yet
- the desktop workspace still routes to `GitDiffViewer`

- [ ] **Step 3: Add the editor mode atom and move main-area routing off diff page state**

In `packages/web/src/features/workspace/atoms/files.ts`, add:

```ts
export type WorkspaceEditorMode = "preview" | "edit" | "diff";

export const editorModeAtomFamily = atomFamily((workspaceId: string) =>
  atom<WorkspaceEditorMode>("preview")
);
```

In `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`, derive:

```ts
const defaultMode: WorkspaceEditorMode =
  currentFile?.kind === "image" && !currentFile.viewingTextBackedImageAsText ? "preview" : "edit";
```

Return the following from the hook:

```ts
mode,
setMode,
canPreview,
canEdit,
canDiff,
hasUnsavedChangesOutsideDiff,
activeDiffChange,
```

In `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`, change:

```ts
export type WorkspaceMainAreaMode = "agent" | "editor";
```

and compute:

```ts
const mainAreaMode: WorkspaceMainAreaMode = activeFilePath ? "editor" : "agent";
```

- [ ] **Step 4: Keep file-open and git-open flows responsible for setting the mode**

Update `use-file-actions.ts` so file selection sets the mode:

```ts
setEditorMode(nextFileIsImage ? "preview" : "edit");
```

Update `use-git-actions.ts` so opening a changed file no longer owns top-level page routing and instead sets:

```ts
setActiveFilePath(change.path);
setEditorMode("diff");
```

while keeping `gitDiffPreviewAtomFamily` available as diff payload/cache state.

- [ ] **Step 5: Re-run the focused web tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS
- workspace no longer depends on `mainAreaMode === "diff"`

- [ ] **Step 6: Commit the state-foundation slice**

```bash
git add \
  packages/web/src/features/workspace/atoms/files.ts \
  packages/web/src/features/workspace/atoms/git.ts \
  packages/web/src/features/workspace/actions/use-workspace-screen-model.ts \
  packages/web/src/features/workspace/actions/use-file-actions.ts \
  packages/web/src/features/workspace/actions/use-git-actions.ts \
  packages/web/src/features/code-editor/actions/use-code-editor-actions.ts \
  packages/web/src/features/code-editor/index.test.tsx \
  packages/web/src/features/workspace/index.test.tsx
git commit -m "feat: add unified editor mode state"
```

## Task 2: Build The Unified Editor Surface And Text Preview/Edit/Diff Flows

**Files:**
- Create: `packages/web/src/features/code-editor/components/monaco-diff-host.tsx`
- Create: `packages/web/src/features/code-editor/components/monaco-diff-host.test.tsx`
- Create: `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- Create: `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- Modify: `packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx`
- Modify: `packages/web/src/styles/components.css`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Test: `packages/web/src/features/code-editor/index.test.tsx`
- Test: `packages/web/src/features/code-editor/views/shared/code-editor-host.test.tsx`
- Test: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- Test: `packages/web/src/features/workspace/index.test.tsx`

- [ ] **Step 1: Add failing tests for the unified header and text diff rendering**

Create `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx` with tests that assert:

```tsx
it("renders 预览, 编辑, and Diff in one persistent header for text files", () => {
  expect(true).toBe(false);
});

it("disables Diff when the active file has no git changes", () => {
  expect(true).toBe(false);
});

it("renders Monaco in read-only mode for preview and editable mode for edit", () => {
  expect(true).toBe(false);
});

it("renders Monaco diff when diff kind is text", () => {
  expect(true).toBe(false);
});
```

Extend `packages/web/src/features/code-editor/components/monaco-host.test.tsx` with an explicit read-only assertion.

- [ ] **Step 2: Run the unified editor tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/views/shared/editor-surface.test.tsx \
  src/features/code-editor/components/monaco-host.test.tsx \
  src/features/code-editor/views/shared/code-editor-host.test.tsx \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- failures because `EditorSurface` and `MonacoDiffHost` do not exist
- failures because `MonacoHost` does not accept explicit read-only mode

- [ ] **Step 3: Implement the shell and textual diff renderer**

Create `packages/web/src/features/code-editor/components/monaco-diff-host.tsx` using Monaco diff editor APIs:

```ts
interface MonacoDiffHostProps {
  originalContent: string;
  modifiedContent: string;
  filePath: string;
  readOnly?: boolean;
}
```

Create `packages/web/src/features/code-editor/views/shared/editor-surface.tsx` with a header contract:

```tsx
interface EditorSurfaceProps {
  state: CodeEditorState;
  chrome?: "full" | "content-only";
}
```

It should render:
- file path and dirty indicator
- mode buttons `预览`, `编辑`, `Diff`
- save and close actions
- unsaved diff warning banner

Update `MonacoHost` to accept:

```ts
readOnly?: boolean;
```

and pass:

```ts
readOnly: mode === "preview"
```

Update `CodeEditorHost` so it becomes a thin wrapper around `EditorSurface` instead of owning a second independent header implementation.

- [ ] **Step 4: Replace desktop usage with the unified surface**

In `workspace-desktop-view.tsx`, replace:

```tsx
{mainAreaMode === "diff" ? <GitDiffViewer ... /> : mainAreaMode === "editor" ? <CodeEditorHost /> : ...}
```

with:

```tsx
{mainAreaMode === "editor" ? <CodeEditorHost /> : <div className="agent-panes"><AgentPanes hydrateSessions={false} /></div>}
```

and remove dedicated close-diff routing behavior from the desktop view.

- [ ] **Step 5: Re-run the text-surface tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/views/shared/editor-surface.test.tsx \
  src/features/code-editor/components/monaco-host.test.tsx \
  src/features/code-editor/views/shared/code-editor-host.test.tsx \
  src/features/code-editor/index.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS
- no desktop test depends on `git-diff-viewer` for active-file diff

- [ ] **Step 6: Commit the unified text-surface slice**

```bash
git add \
  packages/web/src/features/code-editor/components/monaco-diff-host.tsx \
  packages/web/src/features/code-editor/components/monaco-diff-host.test.tsx \
  packages/web/src/features/code-editor/views/shared/editor-surface.tsx \
  packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx \
  packages/web/src/features/code-editor/components/monaco-host.tsx \
  packages/web/src/features/code-editor/views/shared/code-editor-host.tsx \
  packages/web/src/features/workspace/views/desktop/workspace-desktop-view.tsx \
  packages/web/src/features/code-editor/index.test.tsx \
  packages/web/src/features/code-editor/views/shared/code-editor-host.test.tsx \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx \
  packages/web/src/features/workspace/index.test.tsx \
  packages/web/src/styles/components.css \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: unify text editor preview edit and diff"
```

## Task 3: Add Revision-Backed Image Diff Support On The Server

**Files:**
- Create: `packages/server/src/git/image-revision.ts`
- Create: `packages/server/src/__tests__/git/image-revision.test.ts`
- Modify: `packages/server/src/git/diff.ts`
- Modify: `packages/server/src/commands/git.ts`
- Modify: `packages/server/src/routes/file-asset.ts`
- Modify: `packages/server/src/routes/file-asset.test.ts`
- Modify: `packages/server/src/__tests__/git-commands.test.ts`

- [ ] **Step 1: Add failing server tests for revision-backed image asset loading**

Add tests in `packages/server/src/routes/file-asset.test.ts` for:

```ts
it("streams an image from HEAD when revision is provided", async () => {
  expect(true).toBe(false);
});

it("rejects invalid revision selectors for the image asset route", async () => {
  expect(true).toBe(false);
});
```

Add tests in `packages/server/src/__tests__/git-commands.test.ts` for an enriched `git.diff` response:

```ts
it("returns image diff metadata when a png file has binary changes", async () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the focused server tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/routes/file-asset.test.ts \
  src/__tests__/git-commands.test.ts \
  src/__tests__/git/image-revision.test.ts
```

Expected:
- failures because revision-backed asset fetch does not exist
- failures because `git.diff` only returns a plain string today

- [ ] **Step 3: Implement safe image revision reads and enrich git diff metadata**

Create `packages/server/src/git/image-revision.ts` with helpers like:

```ts
export interface GitImageRevisionAsset {
  exists: boolean;
  mime: string;
  bytes?: Buffer;
}

export async function readImageAtRevision(
  cwd: string,
  revision: string,
  filePath: string
): Promise<GitImageRevisionAsset> {
  // use `git show <revision>:<path>` with validation and image-type allowlist
}
```

Update `git.diff.ts` so file diff returns richer metadata:

```ts
export interface FileDiffResult {
  diff: string;
  renderAs: "text" | "image";
  status: "modified" | "added" | "deleted";
}
```

The rule should be:
- if git returns readable text diff, `renderAs: "text"`
- otherwise, if `getImageTypeInfo(path)` resolves and diff is binary/empty, `renderAs: "image"`

Update `commands/git.ts` to return the richer payload unchanged.

Update `routes/file-asset.ts` to support a validated optional `revision` query for image requests, falling back to workspace files when no revision is supplied.

- [ ] **Step 4: Re-run the focused server tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/routes/file-asset.test.ts \
  src/__tests__/git-commands.test.ts \
  src/__tests__/git/image-revision.test.ts
```

Expected:
- PASS
- `git.diff` now distinguishes text and image rendering use cases
- `/api/file` can stream baseline image bytes for a safe revision selector

- [ ] **Step 5: Commit the server image-diff slice**

```bash
git add \
  packages/server/src/git/image-revision.ts \
  packages/server/src/__tests__/git/image-revision.test.ts \
  packages/server/src/git/diff.ts \
  packages/server/src/commands/git.ts \
  packages/server/src/routes/file-asset.ts \
  packages/server/src/routes/file-asset.test.ts \
  packages/server/src/__tests__/git-commands.test.ts
git commit -m "feat: add revision-backed image diff support"
```

## Task 4: Implement Stacked Image Diff And Hook It Into Unified Diff Mode

**Files:**
- Create: `packages/web/src/features/code-editor/components/image-diff-preview.tsx`
- Create: `packages/web/src/features/code-editor/components/image-diff-preview.test.tsx`
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Add failing tests for stacked image diff states**

Create `packages/web/src/features/code-editor/components/image-diff-preview.test.tsx` with:

```tsx
it("renders baseline image on top and workspace image on bottom for modified files", () => {
  expect(true).toBe(false);
});

it("renders an empty top state for added images", () => {
  expect(true).toBe(false);
});

it("renders an empty bottom state for deleted images", () => {
  expect(true).toBe(false);
});
```

Extend `packages/web/src/features/code-editor/index.test.tsx` with:

```tsx
it("renders image diff instead of text diff when git.diff returns renderAs image", () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the image diff tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/components/image-diff-preview.test.tsx \
  src/features/code-editor/index.test.tsx
```

Expected:
- failures because `ImageDiffPreview` does not exist
- failures because code editor state cannot interpret image diff metadata

- [ ] **Step 3: Implement image diff state resolution and the stacked preview**

Create `packages/web/src/features/code-editor/components/image-diff-preview.tsx` with:

```tsx
interface ImageDiffPreviewProps {
  path: string;
  mime: string;
  status: "modified" | "added" | "deleted";
  beforeUrl?: string;
  afterUrl?: string;
}
```

Render:
- top card labeled `Base`
- bottom card labeled `Current`
- empty-state placeholders when one side is missing

Update `use-code-editor-actions.ts` so diff loading resolves:

```ts
type ActiveDiffPayload =
  | { kind: "text"; diff: string; originalContent: string; modifiedContent: string }
  | { kind: "image"; status: "modified" | "added" | "deleted"; beforeUrl?: string; afterUrl?: string; mime: string };
```

Hook `EditorSurface` so:

```tsx
if (mode === "diff" && activeDiffPayload?.kind === "image") {
  return <ImageDiffPreview ... />;
}
```

- [ ] **Step 4: Re-run the image diff tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/components/image-diff-preview.test.tsx \
  src/features/code-editor/index.test.tsx
```

Expected:
- PASS
- image files use stacked vertical comparison in unified diff mode

- [ ] **Step 5: Commit the web image-diff slice**

```bash
git add \
  packages/web/src/features/code-editor/components/image-diff-preview.tsx \
  packages/web/src/features/code-editor/components/image-diff-preview.test.tsx \
  packages/web/src/features/code-editor/actions/use-code-editor-actions.ts \
  packages/web/src/features/code-editor/views/shared/editor-surface.tsx \
  packages/web/src/features/code-editor/index.test.tsx \
  packages/web/src/styles/components.css
git commit -m "feat: add stacked image diff preview"
```

## Task 5: Align Mobile Files Sheet With The Unified Mode Model

**Files:**
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx`
- Modify: `packages/web/src/features/workspace/actions/use-workspace-screen-model.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`

- [ ] **Step 1: Add failing mobile tests for unified file detail mode**

Extend `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx` with:

```tsx
it("uses one file detail surface for preview edit and diff instead of separate editor and diff pages", () => {
  expect(true).toBe(false);
});

it("shows the unified mode actions in the sheet header for an active file", () => {
  expect(true).toBe(false);
});
```

- [ ] **Step 2: Run the mobile files tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- failures because mobile still routes `root | editor | diff`
- failures because header actions are still split by route kind

- [ ] **Step 3: Collapse mobile file detail routing into one active-file detail route**

Change:

```ts
export type MobileFilesRoute =
  | { kind: "root" }
  | { kind: "file"; path: string };
```

Update `mobile-files-sheet.tsx` so:
- `root` renders tabs and lists
- `file` renders `CodeEditorHost chrome="content-only"`

Update `workspace-mobile-view.tsx` so the sheet header action area reads from unified editor mode state and no longer special-cases `route.kind === "diff"`.

- [ ] **Step 4: Re-run the mobile tests and make them pass**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  src/features/workspace/index.test.tsx
```

Expected:
- PASS
- mobile file detail state is unified behind the same preview/edit/diff model

- [ ] **Step 5: Commit the mobile-alignment slice**

```bash
git add \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx \
  packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx \
  packages/web/src/features/workspace/views/mobile/workspace-mobile-view.tsx \
  packages/web/src/features/workspace/actions/use-workspace-screen-model.ts \
  packages/web/src/features/code-editor/views/shared/code-editor-host.tsx
git commit -m "feat: align mobile file detail with unified editor modes"
```

## Task 6: Run Final Verification And Clean Up Legacy Assumptions

**Files:**
- Test: `packages/web/src/features/code-editor/index.test.tsx`
- Test: `packages/web/src/features/code-editor/views/shared/code-editor-host.test.tsx`
- Test: `packages/web/src/features/code-editor/views/shared/editor-surface.test.tsx`
- Test: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- Test: `packages/web/src/features/code-editor/components/monaco-diff-host.test.tsx`
- Test: `packages/web/src/features/code-editor/components/image-diff-preview.test.tsx`
- Test: `packages/web/src/features/workspace/index.test.tsx`
- Test: `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.test.tsx`
- Test: `packages/server/src/routes/file-asset.test.ts`
- Test: `packages/server/src/__tests__/git-commands.test.ts`
- Test: `packages/server/src/__tests__/git/image-revision.test.ts`

- [ ] **Step 1: Run the focused web suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/index.test.tsx \
  src/features/code-editor/views/shared/code-editor-host.test.tsx \
  src/features/code-editor/views/shared/editor-surface.test.tsx \
  src/features/code-editor/components/monaco-host.test.tsx \
  src/features/code-editor/components/monaco-diff-host.test.tsx \
  src/features/code-editor/components/image-diff-preview.test.tsx \
  src/features/workspace/index.test.tsx \
  src/features/workspace/views/mobile/mobile-files-sheet.test.tsx
```

Expected:
- PASS

- [ ] **Step 2: Run the focused server suite**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run \
  src/routes/file-asset.test.ts \
  src/__tests__/git-commands.test.ts \
  src/__tests__/git/image-revision.test.ts
```

Expected:
- PASS

- [ ] **Step 3: Run package-level regression checks**

Run:

```bash
pnpm --filter @coder-studio/web run test
pnpm --filter @coder-studio/server run test
```

Expected:
- both packages pass their full Vitest suites

- [ ] **Step 4: Run typecheck for touched packages**

Run:

```bash
pnpm --filter @coder-studio/web exec tsc -p tsconfig.json --noEmit
pnpm --filter @coder-studio/server exec tsc -p tsconfig.json --noEmit
```

Expected:
- both typechecks pass

- [ ] **Step 5: Commit the verification pass**

```bash
git add -A
git commit -m "test: verify unified editor surface"
```

## Self-Review Notes

Spec coverage:
- unified `预览 / 编辑 / Diff` shell -> Tasks 1 and 2
- active-file-owned diff behavior -> Tasks 1 and 2
- unsaved warning -> Tasks 1 and 2
- text diff vs image diff routing -> Tasks 3 and 4
- stacked image diff -> Task 4
- mobile alignment -> Task 5
- future-safe state separation -> Tasks 1 and 2

No placeholder scan:
- every task has exact files, concrete commands, and expected outcomes
- no `TODO`, `TBD`, or “similar to previous task” shortcuts remain

Type consistency:
- editor mode uses `preview | edit | diff`
- image diff status uses `modified | added | deleted`
- diff payload uses `text` and `image` kinds consistently across tasks

# Dev Browser Editor Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the dev browser entry from workspace-level navigation into the editor header, opening a browser editor tab with its own URL toolbar.

**Architecture:** Keep the existing server proxy and service worker implementation. Add a typed editor-tab layer in web state so file tabs remain file paths while the browser tab is a non-file target; render file and browser tabs through the existing editor header shell.

**Tech Stack:** React 19, Jotai, Vitest, Testing Library, TypeScript, existing `DevBrowserSurface`.

---

## File Structure

- Modify `packages/web/src/features/workspace/atoms/files.ts`: add typed editor tab and active editor target atoms.
- Modify `packages/web/src/features/workspace/actions/open-editor-state.ts`: add helpers for file/browser tab normalization and cleanup.
- Modify `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`: expose editor-tab actions while preserving file-only state.
- Modify `packages/web/src/features/code-editor/views/shared/code-editor-tabs-header.tsx`: render file tabs plus browser tab and add a tabbar Browser action.
- Modify `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`: render `DevBrowserSurface` when the browser tab is active.
- Modify `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`: suppress file mode controls when the browser tab is active.
- Modify desktop/mobile workspace views: remove Activity Bar/Dock browser entry points and keep browser inside the editor surface.
- Modify tests under `packages/web/src/features/code-editor` and `packages/web/src/features/workspace/views`: cover Browser header action, browser tab rendering, and removed workspace-level entries.
- Modify docs/help as needed to describe the editor-header entry.

## Tasks

### Task 1: Typed Editor Tab State

- [ ] Add failing tests proving browser tabs are normalized separately from file paths.
- [ ] Add `WorkspaceEditorTab`, `activeEditorTargetAtomFamily`, and `openEditorTabsAtomFamily`.
- [ ] Keep existing file-path atoms as the file buffer compatibility layer.
- [ ] Run focused atom/helper tests.
- [ ] Commit.

### Task 2: Editor Header Entry And Browser Tab Rendering

- [ ] Add failing component tests for opening/focusing a Browser tab from the editor header.
- [ ] Extend `useCodeEditorActions` with `openBrowserTab`, `activateEditorTab`, and `closeEditorTab`.
- [ ] Extend `CodeEditorTabsHeader` to render file and browser tabs plus the Browser action.
- [ ] Render `DevBrowserSurface` from `EditorSurface` when the browser tab is active.
- [ ] Run focused code-editor tests.
- [ ] Commit.

### Task 3: Remove Workspace-Level Browser Entry Points

- [ ] Add/update failing desktop and mobile workspace tests proving Browser is not in Activity Bar/Dock.
- [ ] Remove `browser` from workspace sidebar/main-area mode and mobile sheet routing.
- [ ] Remove desktop `Ctrl/Cmd+6` Browser shortcut behavior if present.
- [ ] Update docs to say the entry is in the editor header.
- [ ] Run focused workspace tests.
- [ ] Commit.

### Task 4: Verification

- [ ] Run web focused tests for code editor, dev browser, desktop workspace, and mobile workspace.
- [ ] Run `pnpm --filter @coder-studio/web build`.
- [ ] Run `git diff --check`.
- [ ] Report full `pnpm ci:verify` status only if run; otherwise call out focused verification.

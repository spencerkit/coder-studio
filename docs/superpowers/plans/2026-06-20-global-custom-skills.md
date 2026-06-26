# Global Custom Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add first-class global custom skill creation and management to the Skills panel, including product-created `local` skills, a skill file tree, existing-editor reuse for skill files, and drag-to-agent path handoff.

**Architecture:** Keep custom skills as ordinary `source="local"` entries under `~/.agents/skills` instead of inventing a new domain model. Server-side, add a small custom-skill creation command, a skill-file CRUD/readTree command set, and a dedicated `/api/skill-file` image route rooted at `SkillLibraryEntry.libraryPath`; deletion continues to use the existing `skills.uninstall` flow. Client-side, add a `Custom Skills` section and local-skill detail file tree to the existing Skills panel, and reuse the existing editor with a `skill:<slug>/<relative-path>` editor path that reads and writes through `skills.files.*`; for v1, treat skill files as non-workspace-backed Monaco models so we avoid polluting workspace file/LSP state.

**Tech Stack:** TypeScript, React, Jotai, Fastify, Vitest, existing skills domain and workspace editor infrastructure

---

## File Structure

### Server

- Create: `packages/server/src/skills/custom-skill.ts`
- Create: `packages/server/src/commands/skills/custom.ts`
- Create: `packages/server/src/commands/skills/files.ts`
- Create: `packages/server/src/routes/skill-file-asset.ts`
- Create: `packages/server/src/__tests__/skills/custom-skill.test.ts`
- Create: `packages/server/src/__tests__/skills/file-io.test.ts`
- Create: `packages/server/src/routes/skill-file-asset.test.ts`
- Modify: `packages/server/src/commands/skills/index.ts`
- Modify: `packages/server/src/storage/repositories/skill-library-repo.ts`
- Modify: `packages/server/src/commands/skills/shared.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/__tests__/skills/commands.test.ts`

### Web

- Create: `packages/web/src/features/code-editor/skill-editor-path.ts`
- Create: `packages/web/src/features/code-editor/skill-editor-path.test.ts`
- Create: `packages/web/src/features/workspace/actions/use-skill-file-actions.ts`
- Create: `packages/web/src/features/workspace/actions/use-skill-file-actions.test.tsx`
- Create: `packages/web/src/lib/skill-path-drag.ts`
- Create: `packages/web/src/lib/skill-path-drag.test.ts`
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
- Modify: `packages/web/src/features/workspace/atoms/skills.ts`
- Modify: `packages/web/src/features/workspace/actions/use-skills-panel.ts`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/editor-pane-card.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/editor-pane-card.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

### Intentional Omissions In V1

- Do not add a second embedded editor inside the Skills panel.
- Do not extend workspace file-tree atoms to pretend skill files belong to a workspace.
- Do not wire skill files into workspace-backed Monaco/LSP paths in v1.
- Do not add a new delete command if the existing `skills.uninstall` flow already covers local skills safely.

---

### Task 1: Add server-side custom skill creation support

**Files:**
- Create: `packages/server/src/skills/custom-skill.ts`
- Create: `packages/server/src/commands/skills/custom.ts`
- Create: `packages/server/src/__tests__/skills/custom-skill.test.ts`
- Modify: `packages/server/src/commands/skills/index.ts`
- Modify: `packages/server/src/storage/repositories/skill-library-repo.ts`
- Modify: `packages/server/src/__tests__/skills/commands.test.ts`

- [ ] **Step 1: Write the failing helper tests**
- [ ] **Step 2: Run the helper tests to verify they fail**
- [ ] **Step 3: Write the failing command test for `skills.custom.create`**
- [ ] **Step 4: Run the command test to verify it fails**
- [ ] **Step 5: Implement the helper and command**
- [ ] **Step 6: Register the new command**
- [ ] **Step 7: Run the focused tests to verify they pass**
- [ ] **Step 8: Commit**

### Task 2: Add server-side skill file tree, file IO, and asset routing

**Files:**
- Create: `packages/server/src/commands/skills/files.ts`
- Create: `packages/server/src/routes/skill-file-asset.ts`
- Create: `packages/server/src/__tests__/skills/file-io.test.ts`
- Create: `packages/server/src/routes/skill-file-asset.test.ts`
- Modify: `packages/server/src/commands/skills/index.ts`
- Modify: `packages/server/src/commands/skills/shared.ts`
- Modify: `packages/server/src/app.ts`
- Modify: `packages/server/src/__tests__/skills/commands.test.ts`

- [ ] **Step 1: Write the failing server tests for skill file access**
- [ ] **Step 2: Run the new file IO tests to verify they fail**
- [ ] **Step 3: Write failing command tests**
- [ ] **Step 4: Write the failing asset-route test**
- [ ] **Step 5: Implement `skills.files.*` commands by reusing existing FS helpers**
- [ ] **Step 6: Implement `/api/skill-file`**
- [ ] **Step 7: Wire the new route and commands**
- [ ] **Step 8: Run the focused server tests to verify they pass**
- [ ] **Step 9: Commit**

### Task 3: Reuse the existing editor with a `skill:` path source

**Files:**
- Create: `packages/web/src/features/code-editor/skill-editor-path.ts`
- Create: `packages/web/src/features/code-editor/skill-editor-path.test.ts`
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/editor-surface.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`

- [ ] **Step 1: Write the failing path helper tests**
- [ ] **Step 2: Run the helper tests to verify they fail**
- [ ] **Step 3: Add failing editor integration tests**
- [ ] **Step 4: Run the editor tests to verify they fail**
- [ ] **Step 5: Implement `skill-editor-path.ts`**
- [ ] **Step 6: Route skill editor paths through `skills.files.read/write`**
- [ ] **Step 7: Keep skill files out of workspace-backed Monaco/LSP state in v1**
- [ ] **Step 8: Run the focused web tests to verify they pass**
- [ ] **Step 9: Commit**

### Task 4: Extend Skills panel actions and add a skill-file tree hook

**Files:**
- Create: `packages/web/src/features/workspace/actions/use-skill-file-actions.ts`
- Create: `packages/web/src/features/workspace/actions/use-skill-file-actions.test.tsx`
- Modify: `packages/web/src/features/workspace/atoms/skills.ts`
- Modify: `packages/web/src/features/workspace/actions/use-skills-panel.ts`

- [ ] **Step 1: Keep panel state changes minimal**
- [ ] **Step 2: Add failing tests for the new hook**
- [ ] **Step 3: Run the hook tests to verify they fail**
- [ ] **Step 4: Implement `useSkillFileActions`**
- [ ] **Step 5: Extend `useSkillsPanel` with custom-skill actions**
- [ ] **Step 6: Run the focused web tests to verify they pass**
- [ ] **Step 7: Commit**

### Task 5: Build the `Custom Skills` section and skill detail file tree

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/skills-panel.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Add failing UI tests**
- [ ] **Step 2: Run the panel tests to verify they fail**
- [ ] **Step 3: Implement the `Custom Skills` section**
- [ ] **Step 4: Implement the local-skill detail file tree**
- [ ] **Step 5: Add create/manage interactions**
- [ ] **Step 6: Run the focused panel tests to verify they pass**
- [ ] **Step 7: Commit**

### Task 6: Add drag/drop integration for skill files and directories

**Files:**
- Create: `packages/web/src/lib/skill-path-drag.ts`
- Create: `packages/web/src/lib/skill-path-drag.test.ts`
- Modify: `packages/web/src/features/agent-panes/views/shared/editor-pane-card.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/editor-pane-card.test.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.tsx`
- Modify: `packages/web/src/features/agent-panes/views/shared/draft-launcher.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.ts`
- Modify: `packages/web/src/features/terminal-panel/uploads/use-paste-drop-upload.test.tsx`

- [ ] **Step 1: Add failing drag helper tests**
- [ ] **Step 2: Run the helper tests to verify they fail**
- [ ] **Step 3: Add failing integration tests**
- [ ] **Step 4: Run the drag/drop tests to verify they fail**
- [ ] **Step 5: Implement skill-path drag data**
- [ ] **Step 6: Open skill files in the editor when dropped on editor targets**
- [ ] **Step 7: Insert absolute skill paths in terminal/agent targets**
- [ ] **Step 8: Run the focused drag/drop tests to verify they pass**
- [ ] **Step 9: Commit**

### Final Verification

- [ ] Run targeted server and web Vitest suites touched above.
- [ ] Run `pnpm ci:verify`.
- [ ] Review the final diff in code-review mindset.

# System Agent Instructions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Agent panel manage both the workspace-local `agent.md` and a controlled allowlist of provider-level system `agent.md` files.

**Architecture:** Keep `.coder-studio/agent.md` as the project source of truth, but relabel it in the UI as `项目 Agent.md`. Add a separate system-file flow for a small backend allowlist of global agent instruction paths, with virtual editor paths like `agent-system:codex` so the editor can open, save, and conflict-check them without treating them as workspace files. The panel renders both groups, the server owns path resolution and creation, and the editor routes system paths through dedicated `agentInstructions.system.*` commands.

**Tech Stack:** TypeScript, Node `fs/promises`, Vitest, React Testing Library, Jotai, existing workspace/editor command architecture

---

## File Map

- Modify: `packages/server/src/commands/agent-instructions.ts`
  Adds the system allowlist commands, path resolution, scaffold creation, and conflict-aware write logic.
- Modify: `packages/server/src/__tests__/agent-instructions-command.test.ts`
  Covers system-file read/write/status behavior, unsupported providers, scaffold creation, and conflict handling.
- Modify: `packages/server/src/fs/file-io.ts`
  May need a small helper or test coverage update if the new system-file writer reuses low-level conflict checks.
- Modify: `packages/core/src/domain/types.ts`
  Extends the agent-instructions document/status types to represent system provider entries and display paths.
- Modify: `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
  Adds project-vs-system orchestration, system status loading, and edit/open actions for provider files.
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`
  Renders `项目 Agent.md` plus a new `系统 Agent.md` group with provider rows and edit buttons.
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`
  Updates the panel tests for the new grouping, labels, and system-provider actions.
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
  Routes `agent-system:*` reads/writes through the new system commands and keeps save/reconcile working.
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
  Shows the real display path for system files instead of the virtual path in the title chrome.
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
  Adds coverage for system file open/save, display labels, and late refresh behavior.
- Modify: `packages/web/src/features/code-editor/monaco/model-registry.ts`
  May need a minimal path-key or language-routing adjustment if the virtual path is used as the Monaco key.
- Modify: `packages/web/src/features/code-editor/monaco/uri.ts`
  May need a small helper for mapping `agent-system:*` to a stable Monaco URI scheme or to keep virtual paths isolated from workspace-file URIs.
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx`
  Confirms the new Agent panel wording is visible on mobile surfaces too.
- Modify: `packages/web/src/locales/en.json`
  Adds the new project/system labels, provider-row copy, and error strings.
- Modify: `packages/web/src/locales/zh.json`
  Adds the same new strings for the Chinese locale.

## Guardrails

- Keep the existing workspace-local `agent.md` behavior; this feature is additive in behavior and mostly a UI rename for that group.
- Do not expose a generic external file browser or arbitrary `$HOME` editor.
- Keep the system allowlist finite and server-owned. Frontend code should pass `providerId`, not an absolute path.
- Cursor stays unsupported for direct file editing unless a stable Markdown path is discovered later.
- Missing supported system files should be created with a scaffold before opening, not by silently opening a blank buffer.
- Save operations must keep `baseHash` conflict detection.
- System-file writes must not emit workspace `fs.dirty`.
- The editor title should show the real filesystem path (`~/.codex/AGENTS.md`), while the internal open-file key can remain virtual.

### Task 1: Add the system provider metadata and server commands

**Files:**
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/commands/agent-instructions.ts`
- Modify: `packages/server/src/__tests__/agent-instructions-command.test.ts`

- [x] **Step 1: Write the failing command tests**

Add tests for the new system flow before changing production code.

```ts
it("reads a missing system agent file as empty content with a display path", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "agent-instructions-system-read",
      op: "agentInstructions.system.read",
      args: {
        workspaceId: "ws-1",
        providerId: "codex",
      },
    },
    createContext(null)
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    providerId: "codex",
    path: ".codex/AGENTS.md",
    displayPath: "~/.codex/AGENTS.md",
    exists: false,
    content: "",
  });
});
```

Add a write test that creates the file with conflict detection:

```ts
it("creates a missing system agent file before opening it", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "agent-instructions-system-write",
      op: "agentInstructions.system.write",
      args: {
        workspaceId: "ws-1",
        providerId: "claude",
        content: "# Agent Instructions\n\n## Personal Defaults\n- Be concise.\n",
      },
    },
    createContext(null)
  );

  expect(result.ok).toBe(true);
  expect(result.data).toMatchObject({
    providerId: "claude",
    path: ".claude/CLAUDE.md",
    displayPath: "~/.claude/CLAUDE.md",
    exists: true,
  });
});
```

Add a conflict test and an unsupported-provider test:

```ts
it("rejects stale baseHash writes for system agent files", async () => {
  // seed an initial file, then call write with a stale baseHash
});

it("rejects unsupported system providers instead of inventing a path", async () => {
  // providerId: "cursor" => agent_system_instructions_unsupported
});
```

- [x] **Step 2: Run the server tests and verify they fail for the right reason**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/agent-instructions-command.test.ts
```

Expected: the new system-agent assertions fail because no `agentInstructions.system.*` commands exist yet.

- [x] **Step 3: Add the provider allowlist and system document types**

Extend `packages/core/src/domain/types.ts` with system-provider document metadata instead of overloading the workspace-local `.coder-studio/agent.md` shape. Keep the project document type intact, and add a separate system result shape that includes `providerId`, `path`, `displayPath`, `exists`, `content`, and `baseHash`.

- [x] **Step 4: Implement the new server commands**

Add a small allowlist resolver in `packages/server/src/commands/agent-instructions.ts` with these v1 mappings:

```ts
const SYSTEM_AGENT_INSTRUCTIONS = {
  codex: { relPath: ".codex/AGENTS.md", displayPath: "~/.codex/AGENTS.md" },
  claude: { relPath: ".claude/CLAUDE.md", displayPath: "~/.claude/CLAUDE.md" },
  gemini: { relPath: ".gemini/GEMINI.md", displayPath: "~/.gemini/GEMINI.md" },
  opencode: { relPath: ".config/opencode/AGENTS.md", displayPath: "~/.config/opencode/AGENTS.md" },
} as const;
```

Add three commands:

```ts
registerCommand("agentInstructions.system.status", ...)
registerCommand("agentInstructions.system.read", ...)
registerCommand("agentInstructions.system.write", ...)
```

Behavior:

- `status` returns one row per built-in provider, including unsupported Cursor.
- `read` returns empty content and `exists: false` when the file is absent.
- `write` creates parent directories, writes a scaffold or user content, and returns a fresh hash.
- `write` checks `baseHash` if the caller provides one and throws `conflict` when hashes differ.
- Unsupported providers throw `agent_system_instructions_unsupported` from read/write.
- Do not emit `fs.dirty` for these writes.

Use a shared helper so `read` and `write` agree on the returned path/displayPath shape.

- [x] **Step 5: Re-run the server tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/agent-instructions-command.test.ts
```

Expected: PASS

### Task 2: Wire the system files into the editor open/save flow

**Files:**
- Modify: `packages/web/src/features/code-editor/actions/use-code-editor-actions.ts`
- Modify: `packages/web/src/features/code-editor/views/shared/code-editor-host.tsx`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
- Modify: `packages/web/src/features/code-editor/monaco/model-registry.ts`
- Modify: `packages/web/src/features/code-editor/monaco/uri.ts`

- [ ] **Step 1: Write the failing editor tests**

Add coverage that opening `agent-system:codex` loads from `agentInstructions.system.read`, saving goes through `agentInstructions.system.write`, and the editor header shows `~/.codex/AGENTS.md` rather than the virtual path.

Representative assertions:

```ts
expect(sendCommand).toHaveBeenCalledWith(
  "agentInstructions.system.read",
  {
    workspaceId: "ws-1",
    providerId: "codex",
  },
  undefined
);
expect(screen.getByText("~/.codex/AGENTS.md")).toBeInTheDocument();
```

Also add a stale-refresh case that confirms the editor keeps system-file buffers keyed by the virtual path while the display label stays the real path.

- [ ] **Step 2: Run the editor tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/code-editor/index.test.tsx
```

Expected: FAIL because `useCodeEditorActions` still routes everything through `file.read` / `file.write`.

- [ ] **Step 3: Add the system-path router in the editor actions**

Teach `useCodeEditorActions` to detect `agent-system:` paths.

```ts
function parseSystemAgentPath(path: string): { providerId: string; virtualPath: string } | null {
  if (!path.startsWith("agent-system:")) return null;
  return { providerId: path.slice("agent-system:".length), virtualPath: path };
}
```

For these paths:

- `loadFile` dispatches `agentInstructions.system.read`
- `handleSave` dispatches `agentInstructions.system.write`
- reconcile-on-refresh uses the same read command
- the open-file record should retain the virtual path as its stable key

Keep the existing text-file behavior for workspace files unchanged.

- [ ] **Step 4: Show the real display path in the editor chrome**

Add a display-path field to the open-file model or derived editor state so `CodeEditorView` can render `~/.codex/AGENTS.md` while the active buffer path stays `agent-system:codex`.

A minimal shape is fine:

```ts
interface OpenTextFile {
  kind: "text";
  path: string;
  displayPath?: string;
  // existing fields...
}
```

Use that display path in the title/header code path for system files only.

- [ ] **Step 5: Re-run the editor tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/code-editor/index.test.tsx
```

Expected: PASS

### Task 3: Rework the Agent panel into project and system groups

**Files:**
- Modify: `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`
- Modify: `packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write the failing panel tests**

Update the section tests so they expect:

- the project group title to read `项目 Agent.md`
- the old generic `agent.md` label to disappear from the group heading
- a new `系统 Agent.md` group
- one row each for Codex, Claude Code, Gemini CLI, OpenCode, and an unsupported Cursor row
- edit buttons for supported system providers that call the new open flow

Example row expectations:

```ts
expect(screen.getByText("系统 Agent.md")).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Edit ~/.codex/AGENTS.md" })).toBeInTheDocument();
expect(screen.getByText("Cursor")).toBeInTheDocument();
expect(screen.getByText(/managed through Cursor Settings > Rules/i)).toBeInTheDocument();
```

Also update the mobile test to assert that the new group copy is still visible in the compact workspace shell.

- [ ] **Step 2: Run the panel tests and verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx src/features/workspace/views/mobile/workspace-mobile-view.test.tsx
```

Expected: FAIL because the UI still only renders the workspace-local `agent.md` block.

- [ ] **Step 3: Add system-status loading and provider rows to the action hook**

Extend `useAgentInstructionsActions` so it loads the new `agentInstructions.system.status` data alongside the existing workspace status. Keep the current project generation/edit behavior, but add new actions like `openSystemAgent(providerId)` and `editSystemAgent(providerId)` that:

- call `agentInstructions.system.read` first when the file is missing
- write a scaffold when needed
- open `agent-system:<providerId>` through `useOpenLocation`

Keep provider filtering honest: unsupported providers should surface as non-editable rows rather than hidden entries.

- [ ] **Step 4: Rebuild the section UI around two explicit groups**

Render the project block as `项目 Agent.md` with the same status/generate/regenerate/edit flow it has today.

Render a second `系统 Agent.md` block with rows for each allowlisted provider, including:

- provider name
- status chip (`Ready`, `Missing`, `Unsupported`, or `Error`)
- real display path for supported providers
- edit button for supported providers only

Keep the layout dense and utilitarian. Do not turn the rows into oversized cards.

- [ ] **Step 5: Update locale strings**

Add explicit strings for:

- `项目 Agent.md`
- `系统 Agent.md`
- provider display names
- unsupported Cursor copy
- system-file edit/open labels
- missing-file scaffold messaging
- system command error messages

Be consistent in `en.json` and `zh.json`.

- [ ] **Step 6: Re-run the panel tests and verify they pass**

Run:

```bash
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx src/features/workspace/views/mobile/workspace-mobile-view.test.tsx
```

Expected: PASS

### Task 4: Tighten URI/model handling and do a full regression pass

**Files:**
- Modify: `packages/web/src/features/code-editor/monaco/uri.ts`
- Modify: `packages/web/src/features/code-editor/monaco/model-registry.ts`
- Modify: `packages/web/src/features/code-editor/index.test.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`
- Modify: `packages/server/src/__tests__/agent-instructions-command.test.ts`

- [ ] **Step 1: Add a final red-green regression test for conflict and refresh behavior**

Add one test that opens a missing system file, writes a scaffold, then simulates an external edit and confirms the next save fails with `conflict` rather than silently overwriting.

- [ ] **Step 2: Run the focused regression tests and verify the exact failure mode**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/agent-instructions-command.test.ts
pnpm --filter @coder-studio/web test -- src/features/code-editor/index.test.tsx src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: any failure should be a concrete missing behavior, not a type error or a path-mapping mistake.

- [ ] **Step 3: Adjust URI/model helpers only as needed**

If `agent-system:*` needs a dedicated Monaco URI scheme or a display-path helper, keep the change minimal and local:

- do not pollute workspace-file URIs
- do not attach LSP to system files unless there is a clear, tested reason
- keep Monaco model keys stable across reopen/save cycles

- [ ] **Step 4: Run the full targeted test set**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/agent-instructions-command.test.ts
pnpm --filter @coder-studio/web test -- src/features/code-editor/index.test.tsx src/features/workspace/views/shared/agent-instructions-section.test.tsx src/features/workspace/views/mobile/workspace-mobile-view.test.tsx
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/agent-instructions.ts \
  packages/server/src/__tests__/agent-instructions-command.test.ts \
  packages/core/src/domain/types.ts \
  packages/web/src/features/code-editor/actions/use-code-editor-actions.ts \
  packages/web/src/features/code-editor/views/shared/code-editor-host.tsx \
  packages/web/src/features/code-editor/index.test.tsx \
  packages/web/src/features/code-editor/monaco/model-registry.ts \
  packages/web/src/features/code-editor/monaco/uri.ts \
  packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts \
  packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx \
  packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx \
  packages/web/src/features/workspace/views/mobile/workspace-mobile-view.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json

git commit -m "feat: manage system agent instructions"
```

## Self-Review

- Spec coverage: project agent UI rename, new system allowlist, server-owned path resolution, virtual editor paths, scaffold creation, conflict detection, unsupported Cursor handling, and mobile/shared UI coverage all have explicit tasks.
- Placeholder scan: no `TBD` / `TODO` / vague steps remain.
- Type consistency: project document types remain separate from system file payloads, and the editor path key is kept distinct from the display path.
- Scope check: this stays inside one feature slice rather than expanding into a general external file manager.

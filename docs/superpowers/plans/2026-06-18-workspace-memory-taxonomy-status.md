# Workspace Memory Taxonomy Status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace workspace memory types with `wiki | issue | todo | note`, add status for actionable memory, preserve legacy data through normalization, and fix the adjacent memory dropdown and split-divider UI issues.

**Architecture:** The canonical memory contract lives in `packages/core/src/domain/memory.ts`; server command schemas and JSON storage consume those helpers so legacy aliases normalize before persistence. Web UI renders ordered type/status controls from the core constants and keeps CSS-only split handle changes scoped to existing pane divider styles.

**Tech Stack:** TypeScript, React, Jotai, Vitest, Zod, pnpm workspace scripts, CSS guard tests.

---

## File Structure

- Modify `packages/core/src/domain/memory.ts`
  - Add `WorkspaceMemoryType` and `WorkspaceMemoryStatus` constant objects.
  - Replace canonical type order with `wiki`, `issue`, `todo`, `note`.
  - Add legacy alias normalization and status validation helpers.
- Modify `packages/core/src/domain/memory.test.ts`
  - Cover canonical type/status constants, legacy alias normalization, and status applicability.
- Modify `packages/core/src/domain/automation.ts`
  - Update memory capability schemas/examples to canonical types and optional status.
- Modify `packages/core/src/domain/automation.test.ts`
  - Assert canonical type strings and absence of old type strings in memory automation metadata.
- Modify `packages/server/src/storage/repositories/memory-repo.ts`
  - Normalize legacy stored types, read/write `status`, default status for actionable types, and clear status for non-actionable types.
- Modify `packages/server/src/storage/repositories/memory-repo.test.ts`
  - Cover canonical persistence, legacy migration, and status rules.
- Modify `packages/server/src/commands/memory.ts`
  - Accept canonical types plus legacy aliases, optional status, and normalize before repository calls.
- Modify `packages/server/src/commands/memory.test.ts`
  - Cover canonical command flow, alias input compatibility, status validation, and old-file read behavior.
- Modify `packages/cli/src/parse-args.ts`
  - Add optional `--status` parsing for `memory add` and `memory update`.
- Modify `packages/cli/src/bin.test.ts`
  - Cover CLI status forwarding and canonical type metadata expectations that already live in this file.
- Modify `packages/web/src/locales/en.json` and `packages/web/src/locales/zh.json`
  - Replace memory type labels and add status labels.
- Modify `packages/web/src/features/workspace/actions/use-memory-panel.ts`
  - Include optional memory `status` in create/update inputs.
- Modify `packages/web/src/features/workspace/views/shared/memory-panel.tsx`
  - Render four memory types in order; render status controls only for `issue` and `todo`; include status badge metadata only for actionable entries.
- Modify `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`
  - Cover four-type order, actionable-only status controls, create/update payload status, and dropdown close behavior.
- Modify `packages/web/src/components/ui/select/index.test.tsx`
  - Keep shared desktop listbox closing behavior covered; update only if current test fails during implementation.
- Modify `packages/web/src/styles/components.css`
  - Update memory badge variants to canonical types/status if needed.
  - Lower/neutralize pane divider visual overlay while preserving hit target.
- Modify `packages/web/src/styles/memory-panel.guard.test.ts`
  - Assert only canonical badge variants remain.
- Modify `packages/web/src/styles/pane-layout-divider.theme.test.ts`
  - Assert pane divider remains transparent and does not use elevated z-index.
- Optional modify `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`
  - Update built-in memory skill examples/type descriptions if they mention old types.
- Optional modify `packages/cli/src/cli.ts`
  - Update CLI help examples if they mention old memory types or need `--status` examples.

## Task 1: Core Memory Contract

**Files:**
- Modify: `packages/core/src/domain/memory.test.ts`
- Modify: `packages/core/src/domain/memory.ts`

- [ ] **Step 1: Write failing core tests**

Update `packages/core/src/domain/memory.test.ts` to expect:

```ts
expect(WORKSPACE_MEMORY_TYPES).toEqual(["wiki", "issue", "todo", "note"]);
expect(WORKSPACE_MEMORY_STATUSES).toEqual([
  "not_started",
  "in_progress",
  "pending_verification",
  "completed",
]);
expect(normalizeWorkspaceMemoryType("project")).toBe("wiki");
expect(normalizeWorkspaceMemoryType("bugfix")).toBe("issue");
expect(normalizeWorkspaceMemoryType("feature")).toBe("wiki");
expect(isActionableWorkspaceMemoryType("wiki")).toBe(false);
expect(isActionableWorkspaceMemoryType("issue")).toBe(true);
```

Add validation expectations:

```ts
expect(validateWorkspaceMemoryInput({ type: "issue", content: "Broken", status: "in_progress" }))
  .toEqual({ type: "issue", content: "Broken", status: "in_progress" });
expect(validateWorkspaceMemoryInput({ type: "todo", content: "Ship", status: undefined }))
  .toEqual({ type: "todo", content: "Ship", status: "not_started" });
expect(validateWorkspaceMemoryInput({ type: "wiki", content: "Use pnpm", status: "completed" }))
  .toEqual({ type: "wiki", content: "Use pnpm" });
expect(validateWorkspaceMemoryInput({ type: "bugfix", content: "Old", status: "completed" }))
  .toEqual({ type: "issue", content: "Old", status: "completed" });
expect(() =>
  validateWorkspaceMemoryInput({ type: "issue", content: "Broken", status: "unknown" })
).toThrow("Invalid memory status");
```

- [ ] **Step 2: Run core memory test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/memory.test.ts
```

Expected: FAIL because `WORKSPACE_MEMORY_STATUSES`, `normalizeWorkspaceMemoryType`, and `isActionableWorkspaceMemoryType` do not exist and old type constants are still present.

- [ ] **Step 3: Implement core contract**

In `packages/core/src/domain/memory.ts`:

- Replace the old type array with a `WorkspaceMemoryType` constant object and ordered `WORKSPACE_MEMORY_TYPES`.
- Add `WorkspaceMemoryStatus`, `WORKSPACE_MEMORY_STATUSES`, and `WorkspaceMemoryStatus` type alias.
- Add `WorkspaceMemoryEntry.status?: WorkspaceMemoryStatus`.
- Add `WorkspaceMemoryInput.status?: unknown`.
- Add `normalizeWorkspaceMemoryType(value: unknown): WorkspaceMemoryType | undefined`.
- Add `isActionableWorkspaceMemoryType(type: WorkspaceMemoryType): boolean`.
- Add `normalizeWorkspaceMemoryStatus(value: unknown): WorkspaceMemoryStatus | undefined`.
- Update `validateWorkspaceMemoryInput()` so it:
  - accepts canonical types and aliases `project`, `bugfix`, `feature`;
  - throws `"Invalid memory type"` for unknown values;
  - trims content as before;
  - throws `"Invalid memory status"` when `status` is present and invalid;
  - defaults missing status to `not_started` for `issue` and `todo`;
  - omits status for `wiki` and `note`.

- [ ] **Step 4: Run core memory test to verify it passes**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/memory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/memory.ts packages/core/src/domain/memory.test.ts
git commit -m "feat(core): normalize workspace memory taxonomy"
```

## Task 2: Automation Metadata

**Files:**
- Modify: `packages/core/src/domain/automation.test.ts`
- Modify: `packages/core/src/domain/automation.ts`

- [ ] **Step 1: Write failing automation tests**

Update the memory capability assertions in `packages/core/src/domain/automation.test.ts`:

```ts
expect(memoryAdd?.inputSchema).toEqual({
  workspaceId: "string",
  type: "wiki | issue | todo | note",
  content: "string",
  status: "not_started | in_progress | pending_verification | completed optional",
});
expect(memoryUpdate?.inputSchema).toEqual({
  workspaceId: "string",
  id: "string",
  type: "wiki | issue | todo | note optional",
  content: "string optional",
  status: "not_started | in_progress | pending_verification | completed optional",
});
expect(memoryAdd?.examples).toEqual([
  'coder-studio memory add --workspace ws_123 --type wiki --content "..." --json',
]);
expect(memoryExamples).toSatisfy((examples) =>
  examples.every((example) => !example.includes("--type project"))
);
expect(JSON.stringify(memoryCapabilities)).not.toContain("bugfix");
expect(JSON.stringify(memoryCapabilities)).not.toContain("feature | todo | bugfix | project | note");
```

- [ ] **Step 2: Run automation test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/automation.test.ts
```

Expected: FAIL because automation metadata still lists old types and no status.

- [ ] **Step 3: Update automation metadata**

In `packages/core/src/domain/automation.ts`:

- Change `memory.add.inputSchema.type` to `"wiki | issue | todo | note"`.
- Add `memory.add.inputSchema.status`.
- Change `memory.add.examples[0]` to use `--type wiki`.
- Change `memory.update.inputSchema.type` to `"wiki | issue | todo | note optional"`.
- Add `memory.update.inputSchema.status`.
- Keep memory search/list descriptions content/type based.

- [ ] **Step 4: Run core tests**

Run:

```bash
pnpm --filter @coder-studio/core exec vitest run src/domain/automation.test.ts src/domain/memory.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/domain/automation.ts packages/core/src/domain/automation.test.ts
git commit -m "docs(core): update memory automation metadata"
```

## Task 3: Server Repository Normalization And Status

**Files:**
- Modify: `packages/server/src/storage/repositories/memory-repo.test.ts`
- Modify: `packages/server/src/storage/repositories/memory-repo.ts`

- [ ] **Step 1: Write failing repository tests**

Update existing tests that create `type: "project"` to expect persisted `type: "wiki"` or change create inputs to `type: "wiki"` where alias compatibility is not under test.

Add a legacy normalization test:

```ts
it("normalizes supported legacy memory types while reading workspace files", () => {
  const workspaceId = "ws-legacy-types";
  const filePath = join(tempDir, "memory", "workspaces", `${workspaceId}.json`);
  mkdirSync(join(tempDir, "memory", "workspaces"), { recursive: true });
  writeFileSync(filePath, JSON.stringify({
    version: 1,
    workspaceId,
    entries: {
      project: { id: "project", workspaceId, type: "project", content: "Project conventions.", source: { kind: "user" }, createdAt: 1, updatedAt: 1 },
      bugfix: { id: "bugfix", workspaceId, type: "bugfix", content: "Broken select.", source: { kind: "user" }, createdAt: 2, updatedAt: 2 },
      feature: { id: "feature", workspaceId, type: "feature", content: "Existing capability.", source: { kind: "user" }, createdAt: 3, updatedAt: 3 }
    }
  }, null, 2) + "\n");

  expect(repo.list({ workspaceId }).map((entry) => [entry.id, entry.type])).toEqual([
    ["feature", "wiki"],
    ["bugfix", "issue"],
    ["project", "wiki"],
  ]);
});
```

Add status tests:

```ts
const issue = repo.create({ workspaceId: "ws-1", type: "issue", content: "Broken", status: "in_progress", source: { kind: "user" } });
expect(issue.status).toBe("in_progress");
const todo = repo.create({ workspaceId: "ws-1", type: "todo", content: "Ship", source: { kind: "user" } });
expect(todo.status).toBe("not_started");
const wiki = repo.create({ workspaceId: "ws-1", type: "wiki", content: "Use pnpm", status: "completed", source: { kind: "user" } });
expect(wiki).not.toHaveProperty("status");
expect(repo.update({ workspaceId: "ws-1", id: issue.id, type: "note" })).not.toHaveProperty("status");
```

- [ ] **Step 2: Run repository test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/storage/repositories/memory-repo.test.ts
```

Expected: FAIL because repository inputs do not accept status and old type expectations are still hard-coded.

- [ ] **Step 3: Implement repository behavior**

In `packages/server/src/storage/repositories/memory-repo.ts`:

- Add optional `status?: WorkspaceMemoryStatus` to `MemoryCreateInput` and `MemoryUpdateInput`.
- Pass `status` into `validateWorkspaceMemoryInput()`.
- Include `...(validated.status ? { status: validated.status } : {})` in created/updated entries.
- Ensure update removes stale `status` when validated result omits it. Do this by destructuring old status away:

```ts
const { status: _oldStatus, ...existingWithoutStatus } = existing;
const updated: WorkspaceMemoryEntry = {
  ...existingWithoutStatus,
  type: validated.type,
  content: validated.content,
  updatedAt: this.now(),
  ...(validated.status ? { status: validated.status } : {}),
  ...(input.archivedAt !== undefined ? { archivedAt: input.archivedAt } : {}),
};
```

- Keep soft delete behavior unchanged.

- [ ] **Step 4: Run repository test**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/storage/repositories/memory-repo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/storage/repositories/memory-repo.ts packages/server/src/storage/repositories/memory-repo.test.ts
git commit -m "feat(server): normalize memory repository types"
```

## Task 4: Server Commands

**Files:**
- Modify: `packages/server/src/commands/memory.test.ts`
- Modify: `packages/server/src/commands/memory.ts`

- [ ] **Step 1: Write failing command tests**

Update the main command flow to create `type: "wiki"` and expect `type: "wiki"`.

Add alias compatibility assertions:

```ts
const legacyProject = await dispatch(command("memory.create", {
  workspaceId: "ws-1",
  type: "project",
  content: "Legacy project alias.",
}), ctx);
expect(legacyProject.ok).toBe(true);
expect((legacyProject.data as WorkspaceMemoryEntry).type).toBe("wiki");

const legacyBugfix = await dispatch(command("memory.create", {
  workspaceId: "ws-1",
  type: "bugfix",
  content: "Legacy bugfix alias.",
  status: "pending_verification",
}), ctx);
expect(legacyBugfix.ok).toBe(true);
expect(legacyBugfix.data).toMatchObject({ type: "issue", status: "pending_verification" });
```

Add status command assertions:

```ts
const issueResult = await dispatch(command("memory.create", {
  workspaceId: "ws-1",
  type: "issue",
  content: "Broken dropdown.",
}), ctx);
expect(issueResult.data).toMatchObject({ type: "issue", status: "not_started" });

const invalidStatus = await dispatch(command("memory.create", {
  workspaceId: "ws-1",
  type: "issue",
  content: "Broken dropdown.",
  status: "blocked",
}), ctx);
expect(invalidStatus.ok).toBe(false);
expect(invalidStatus.error?.code).toBe("validation_error");
```

- [ ] **Step 2: Run command test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/memory.test.ts
```

Expected: FAIL because command schemas still use canonical old type enum and do not accept status.

- [ ] **Step 3: Implement command schemas**

In `packages/server/src/commands/memory.ts`:

- Import `WORKSPACE_MEMORY_STATUSES` and `normalizeWorkspaceMemoryType`.
- Create `memoryTypeArgSchema` with `z.string().refine((value) => normalizeWorkspaceMemoryType(value) !== undefined, "Invalid memory type").transform(...)`.
- Create `memoryStatusSchema = z.enum(WORKSPACE_MEMORY_STATUSES)`.
- Use `memoryTypeArgSchema` for create/update/list/search type fields.
- Add optional `status: memoryStatusSchema.optional()` to create/update schemas.
- Pass `status: args.status` to repository create/update.

- [ ] **Step 4: Run command and repository tests**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/memory.test.ts src/storage/repositories/memory-repo.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/server/src/commands/memory.ts packages/server/src/commands/memory.test.ts
git commit -m "feat(server): accept memory status commands"
```

## Task 5: CLI Status Forwarding And Help Text

**Files:**
- Modify: `packages/cli/src/bin.test.ts`
- Modify: `packages/cli/src/parse-args.ts`
- Modify: `packages/cli/src/cli.ts`
- Optional modify: `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`

- [ ] **Step 1: Write failing CLI tests**

In `packages/cli/src/bin.test.ts`, update memory tests to canonical examples:

```ts
await main(["memory", "list", "--workspace", "ws-1", "--type", "wiki", "--json"]);
expect(commandClientMock).toHaveBeenCalledWith(expect.objectContaining({
  op: "memory.list",
  args: { workspaceId: "ws-1", type: "wiki" },
}));
```

Add status forwarding:

```ts
await main([
  "memory",
  "add",
  "--workspace",
  "ws-1",
  "--type",
  "issue",
  "--status",
  "pending_verification",
  "--content",
  "Dropdown stays open.",
  "--json",
]);
expect(commandClientMock).toHaveBeenCalledWith(expect.objectContaining({
  op: "memory.create",
  args: {
    workspaceId: "ws-1",
    type: "issue",
    status: "pending_verification",
    content: "Dropdown stays open.",
  },
}));
```

Add equivalent `memory update mem-1 --status completed`.

- [ ] **Step 2: Run CLI test to verify it fails**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
```

Expected: FAIL because `--status` is not parsed/forwarded.

- [ ] **Step 3: Implement CLI status parsing**

In `packages/cli/src/parse-args.ts`:

- Add `memoryStatus?: string` to `CliArgs`.
- Clear it in reset/copy helpers where other memory fields are cleared.
- Accept `--status <value>` only for `memory`.
- Validate that `memory add` still requires `--type` and `--content`, and `--status` is optional.

In `packages/cli/src/cli.ts`:

- Add `...(args.memoryStatus !== undefined ? { status: args.memoryStatus } : {})` to `memory.create` and `memory.update` command args.
- Update help examples from `--type project` to `--type wiki`.
- Mention optional `--status` only if the help already lists memory options in command detail.

In `packages/server/src/skills/builtin/definitions/coder-studio-memory.ts`, replace old type examples with `wiki | issue | todo | note` if present.

- [ ] **Step 4: Run CLI and core automation tests**

Run:

```bash
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
pnpm --filter @coder-studio/core exec vitest run src/domain/automation.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/parse-args.ts packages/cli/src/cli.ts packages/cli/src/bin.test.ts packages/server/src/skills/builtin/definitions/coder-studio-memory.ts
git commit -m "feat(cli): forward memory status"
```

If the optional skill file has no old memory type text, leave it unstaged and commit only changed files.

## Task 6: Web Memory Panel Status UI

**Files:**
- Modify: `packages/web/src/features/workspace/views/shared/memory-panel.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/features/workspace/actions/use-memory-panel.ts`
- Modify: `packages/web/src/features/workspace/views/shared/memory-panel.tsx`

- [ ] **Step 1: Write failing web tests**

Update `baseMemoryEntry` to:

```ts
type: "wiki",
content: "Package scripts should run through pnpm.",
```

Add an issue entry with status:

```ts
{
  ...baseMemoryEntry,
  id: "mem-issue",
  type: "issue",
  content: "Dropdown stays open.",
  status: "pending_verification",
}
```

Assert type chips in order:

```ts
const chips = screen.getAllByRole("button").filter((button) =>
  ["All", "Wiki", "Issue", "Todo", "Note"].includes(button.textContent ?? "")
);
expect(chips.map((button) => button.textContent)).toEqual(["All", "Wiki", "Issue", "Todo", "Note"]);
```

Assert status display:

```ts
expect(screen.getByText("pending verification")).toBeInTheDocument();
expect(screen.queryByText("not started")).toBeNull(); // no status badge for wiki/note without status
```

Add create modal behavior:

```ts
fireEvent.click(screen.getByRole("button", { name: "New memory" }));
const createDialog = await screen.findByRole("dialog", { name: "Create memory" });
expect(within(createDialog).queryByLabelText("Status")).toBeNull();
await user.click(within(createDialog).getByRole("button", { name: "Type Wiki" }));
await user.click(within(createDialog).getByRole("option", { name: "Issue" }));
expect(within(createDialog).getByRole("button", { name: "Status Not started" })).toBeInTheDocument();
```

Assert create payload includes status for issue:

```ts
expect(sendCommand).toHaveBeenCalledWith("memory.create", {
  workspaceId: "ws-1",
  type: "issue",
  content: "Dropdown stays open.",
  status: "not_started",
}, undefined);
```

- [ ] **Step 2: Run memory panel test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/memory-panel.test.tsx
```

Expected: FAIL because old type labels are still rendered and no status UI exists.

- [ ] **Step 3: Implement web UI**

In `packages/web/src/locales/en.json`:

- Replace `workspace.memory.types` with keys `wiki`, `issue`, `todo`, `note`.
- Add `workspace.memory.status_label`.
- Add `workspace.memory.statuses.not_started`, `.in_progress`, `.pending_verification`, `.completed` with labels `Not started`, `In progress`, `Pending verification`, `Completed`.

In `packages/web/src/locales/zh.json`:

- Replace type labels with `wiki: "Wiki"`, `issue: "问题"`, `todo: "待办"`, `note: "备注"`.
- Add status labels `待开始`, `进行中`, `待验证`, `已完成`.

In `packages/web/src/features/workspace/actions/use-memory-panel.ts`:

- Import `WorkspaceMemoryStatus`.
- Add optional `status?: WorkspaceMemoryStatus` to create/update input interfaces.
- Forward status in dispatch payload through object spread already used for input.

In `packages/web/src/features/workspace/views/shared/memory-panel.tsx`:

- Import `WORKSPACE_MEMORY_STATUSES`, `WorkspaceMemoryStatus`, and `isActionableWorkspaceMemoryType`.
- Extend `MemoryDraft` with `status?: WorkspaceMemoryStatus`.
- Set `DEFAULT_MEMORY_TYPE` to `WorkspaceMemoryType.Wiki` after Task 1 exports it.
- Add `normalizeDraftForType(type, currentStatus)` helper:
  - returns `{ type, status: "not_started" }` for actionable type without current status;
  - returns `{ type }` for non-actionable type.
- Add status select in `renderMemoryForm()` only when actionable.
- Include status in `saveMemory()` payload only when present.
- Render a status badge in list meta only when `entry.status` is present.

- [ ] **Step 4: Run memory panel test**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/memory-panel.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/features/workspace/views/shared/memory-panel.tsx packages/web/src/features/workspace/views/shared/memory-panel.test.tsx packages/web/src/features/workspace/actions/use-memory-panel.ts packages/web/src/locales/en.json packages/web/src/locales/zh.json
git commit -m "feat(web): add memory status controls"
```

## Task 7: Web Styles And Split Divider

**Files:**
- Modify: `packages/web/src/styles/memory-panel.guard.test.ts`
- Modify: `packages/web/src/styles/pane-layout-divider.theme.test.ts`
- Modify: `packages/web/src/styles/components.css`

- [ ] **Step 1: Write failing style guard tests**

In `packages/web/src/styles/memory-panel.guard.test.ts`, update badge variant assertions:

```ts
expect(badgeVariants).toContain(".memory-panel__badge--wiki");
expect(badgeVariants).toContain(".memory-panel__badge--issue");
expect(badgeVariants).toContain(".memory-panel__badge--todo");
expect(badgeVariants).toContain(".memory-panel__badge--note");
expect(badgeVariants).not.toContain(".memory-panel__badge--feature");
expect(badgeVariants).not.toContain(".memory-panel__badge--bugfix");
expect(badgeVariants).not.toContain(".memory-panel__badge--project");
```

In `packages/web/src/styles/pane-layout-divider.theme.test.ts`, add assertions:

```ts
const dividerBlock = getRuleBlock(".pane-layout-divider");
expect(dividerBlock).toContain("background: transparent");
expect(dividerBlock).not.toContain("z-index: var(--z-modal");
expect(dividerBlock).not.toContain("z-index: var(--z-popover");
expect(dividerBlock).not.toContain("z-index: var(--z-tooltip");

const hoverAfterBlock = getRuleBlock(".pane-layout-divider:hover::after");
expect(hoverAfterBlock).toContain("background: transparent");
```

- [ ] **Step 2: Run style guard tests to verify failure**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/memory-panel.guard.test.ts src/styles/pane-layout-divider.theme.test.ts
```

Expected: FAIL until badge variants and divider assertions match the new CSS.

- [ ] **Step 3: Update CSS**

In `packages/web/src/styles/components.css`:

- Replace old `.memory-panel__badge--feature`, `--bugfix`, and `--project` selectors with canonical `.memory-panel__badge--wiki`, `--issue`, `--todo`, `--note`.
- Add `.memory-panel__status` or `.memory-panel__badge--status-*` styles if Task 6 rendered separate status badges.
- Keep `.pane-layout-divider`, `::after`, and hover blocks transparent.
- If a z-index is present on `.pane-layout-divider`, remove it or set it to a low local value that does not sit above editor overlays.
- Preserve existing divider dimensions/cursor styles outside the visible line styling.

- [ ] **Step 4: Run style guard tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run src/styles/memory-panel.guard.test.ts src/styles/pane-layout-divider.theme.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/web/src/styles/components.css packages/web/src/styles/memory-panel.guard.test.ts packages/web/src/styles/pane-layout-divider.theme.test.ts
git commit -m "style(web): update memory badges and pane divider"
```

## Task 8: Full Integration Verification

**Files:**
- No planned source edits unless verification exposes a defect.

- [ ] **Step 1: Run focused package tests**

Run:

```bash
pnpm --filter @coder-studio/core test
pnpm --filter @coder-studio/server test
pnpm --filter @spencer-kit/coder-studio exec vitest run src/bin.test.ts
pnpm --filter @coder-studio/web exec vitest run src/features/workspace/views/shared/memory-panel.test.tsx src/components/ui/select/index.test.tsx src/styles/memory-panel.guard.test.ts src/styles/pane-layout-divider.theme.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run typecheck**

Run:

```bash
pnpm ci:typecheck
```

Expected: PASS.

- [ ] **Step 3: Run repository verification**

Run:

```bash
pnpm ci:verify
```

Expected: PASS.

- [ ] **Step 4: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intended implementation files are modified relative to the last implementation commit, or clean if each task committed.

- [ ] **Step 5: Confirm final working tree state**

Run:

```bash
git status --short
```

Expected: no output after all task commits and verification fixes are complete. If verification
required extra fixes after the task commits, commit those concrete files with a message that names
the fixed verification failure before final handoff.

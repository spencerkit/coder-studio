# Agent Instructions Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop session-start instruction injection and instead publish the workspace's effective agent instructions into provider-native project files that Claude and Codex already read.

**Architecture:** Keep `.coder-studio/AGENTS.md`, `.coder-studio/AGENTS.generated.md`, and `.coder-studio/AGENTS.effective.md` as the source of truth. Add one server-side publisher that materializes the effective markdown into provider-specific files (`AGENTS.override.md` for Codex, `CLAUDE.local.md` for Claude), then wire that publisher into workspace open, dirty events, and `session.create`. Remove the terminal-input rewrite path so the default behavior is file-based, not submit-time injection.

**Tech Stack:** TypeScript, Node `fs/promises`, existing event bus, Chokidar watcher, Vitest, React.

---

## File Map

- Create: `packages/server/src/agent-instructions/publish-targets.ts`
  Owns the provider-to-target-file map and keeps the target names centralized.
- Create: `packages/server/src/agent-instructions/publisher.ts`
  Resolves the effective instructions, writes/deletes the managed target files, and serializes per-workspace syncs.
- Create: `packages/server/src/__tests__/agent-instructions-publisher.test.ts`
  Covers publish, delete, no-op, and overlap behavior.
- Modify: `packages/server/src/ws/dispatch.ts`
  Adds the optional publisher dependency to command handlers.
- Modify: `packages/server/src/server.ts`
  Instantiates the publisher, hydrates it on startup, and subscribes it to dirty events.
- Modify: `packages/server/src/commands/workspace.ts`
  Triggers an eager publish after `workspace.open`.
- Modify: `packages/server/src/commands/session.ts`
  Forces a publish before `session.create` starts the agent process.
- Modify: `packages/server/src/commands/terminal.ts`
  Removes the submit-time rewrite path and its auto-attach metadata side effects.
- Modify: `packages/server/src/commands/agent-instructions.ts`
  Removes the unused auto-attach payload helper.
- Modify: `packages/server/src/fs/gitignore.ts`
  Ignores the managed target files so publisher writes do not loop back into `fs.dirty`.
- Modify: `packages/server/src/__tests__/fs/watcher.test.ts`
  Verifies the watcher ignores the managed target files but still watches internal source files.
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`
  Verifies workspace open still succeeds and no longer persists auto-attach UI state.
- Modify: `packages/server/src/__tests__/session-commands.test.ts`
  Verifies `session.create` waits for publish before starting the session.
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts`
  Verifies submit payloads are no longer rewritten.
- Modify: `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
  Removes auto-attach state management and related dispatches.
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`
  Removes the auto-attach switch and leaves manual attach as the explicit fallback.
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`
  Updates the panel tests to match the reduced UI.
- Modify: `packages/web/src/locales/en.json`
  Removes stale auto-attach copy.
- Modify: `packages/web/src/locales/zh.json`
  Removes stale auto-attach copy.
- Modify: `packages/core/src/domain/types.ts`
  Removes `agentInstructionsAutoAttach` from `UiState`.

## Guardrails

- Keep `.coder-studio/AGENTS.*` as the internal source of truth; never make the published target files the source of truth.
- Use `AGENTS.override.md` for Codex and `CLAUDE.local.md` for Claude; do not target `.codex`.
- Keep the sync best-effort. A transient write failure should log and continue, not block workspace open or session creation.
- Ignore managed target writes in the workspace watcher so publisher output does not re-trigger the publisher.
- Keep `agentInstructions.attachToSession` as a manual fallback only.
- Do not add a new public publish-status API in this phase.

### Task 1: Add the publisher service and target registry

**Files:**
- Create: `packages/server/src/agent-instructions/publish-targets.ts`
- Create: `packages/server/src/agent-instructions/publisher.ts`
- Create: `packages/server/src/__tests__/agent-instructions-publisher.test.ts`

- [ ] **Step 1: Write the failing publisher tests**

Add tests that exercise the service against a temp workspace:

```ts
it("publishes the effective instructions into provider-native files", async () => {
  await mkdir(join(rootPath, ".coder-studio"), { recursive: true });
  await writeFile(
    join(rootPath, ".coder-studio", "AGENTS.generated.md"),
    "# Generated\n\n- Generated rule.\n"
  );
  await writeFile(
    join(rootPath, ".coder-studio", "AGENTS.md"),
    "# Custom\n\n- Custom rule.\n"
  );

  const result = await publisher.syncWorkspace("ws-1");

  expect(result.targets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ providerId: "codex", path: "AGENTS.override.md" }),
      expect.objectContaining({ providerId: "claude", path: "CLAUDE.local.md" }),
    ])
  );
  expect(await readFile(join(rootPath, "AGENTS.override.md"), "utf8")).toContain(
    "# Effective Agent Instructions"
  );
  expect(await readFile(join(rootPath, "CLAUDE.local.md"), "utf8")).toContain(
    "# Effective Agent Instructions"
  );
});
```

Add a second test for the empty-source case:

```ts
it("deletes managed targets when no effective instructions exist", async () => {
  await publisher.syncWorkspace("ws-1");

  await expect(stat(join(rootPath, "AGENTS.override.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
  await expect(stat(join(rootPath, "CLAUDE.local.md"))).rejects.toMatchObject({
    code: "ENOENT",
  });
});
```

Add a third test for a second sync staying unchanged:

```ts
it("leaves managed targets unchanged on a second sync", async () => {
  await publisher.syncWorkspace("ws-1");

  const second = await publisher.syncWorkspace("ws-1");

  expect(second.targets).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ providerId: "codex", action: "unchanged" }),
      expect.objectContaining({ providerId: "claude", action: "unchanged" }),
    ])
  );
});
```

- [ ] **Step 2: Run the new test file and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/agent-instructions-publisher.test.ts
```

Expected: the new assertions fail because the publisher does not exist yet.

- [ ] **Step 3: Implement the minimal publisher**

Create `publish-targets.ts` with a small registry:

```ts
export const AGENT_INSTRUCTION_PUBLISH_TARGETS = [
  { providerId: "codex", path: "AGENTS.override.md" },
  { providerId: "claude", path: "CLAUDE.local.md" },
] as const;
```

Implement `AgentInstructionsPublisher` so it:

- resolves the effective markdown from `.coder-studio/AGENTS.*`
- writes that markdown into each managed target when the content differs
- deletes the managed target when the effective markdown is absent
- keeps per-workspace syncs serialized
- returns a small result object with the action taken per target

- [ ] **Step 4: Rerun the publisher tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/agent-instructions-publisher.test.ts
```

Expected: pass.

### Task 2: Wire publishing into workspace open, dirty events, and session startup

**Files:**
- Modify: `packages/server/src/ws/dispatch.ts`
- Modify: `packages/server/src/server.ts`
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/server/src/commands/session.ts`
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`
- Modify: `packages/server/src/__tests__/session-commands.test.ts`
- Modify: `packages/server/src/__tests__/workspace-watcher-hydrate-restart.test.ts`

- [ ] **Step 1: Add failing wiring tests**

Add a workspace-open test that proves the publisher is called before the command returns:

```ts
it("publishes agent instructions during workspace.open", async () => {
  const calls: string[] = [];
  ctx.agentInstructionPublisher = {
    syncWorkspace: vi.fn(async () => {
      calls.push("publish");
    }),
    scheduleWorkspaceSync: vi.fn(),
    syncAllOpenWorkspaces: vi.fn(),
  } as never;

  const result = await dispatch(
    {
      kind: "command",
      id: "workspace-open-publish",
      op: "workspace.open",
      args: { path: dir },
    },
    ctx
  );

  expect(result.ok).toBe(true);
  expect(calls).toEqual(["publish"]);
});
```

Add a session-create ordering test:

```ts
it("publishes agent instructions before session.create starts the agent", async () => {
  const calls: string[] = [];
  const sessionStub = {
    id: "sess-1",
    workspaceId,
    providerId: "claude",
    terminalId: "term-1",
    capability: "full",
    state: "starting",
    startedAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  ctx.agentInstructionPublisher = {
    syncWorkspace: vi.fn(async () => {
      calls.push("publish");
    }),
    scheduleWorkspaceSync: vi.fn(),
    syncAllOpenWorkspaces: vi.fn(),
  } as never;
  sessionMgr.create = vi.fn(async () => {
    calls.push("create");
    return sessionStub;
  }) as never;

  await dispatch(
    {
      kind: "command",
      id: "session-create-publish",
      op: "session.create",
      args: { workspaceId, providerId: "claude" },
    },
    ctx
  );

  expect(calls).toEqual(["publish", "create"]);
});
```

Add a restart test that proves startup hydration republishes missing target files:

```ts
it("restores managed target files after restart", async () => {
  mkdirSync(join(workspaceDir, ".coder-studio"), { recursive: true });
  writeFileSync(
    join(workspaceDir, ".coder-studio", "AGENTS.generated.md"),
    "# Generated\n\n- Generated rule.\n"
  );
  writeFileSync(
    join(workspaceDir, ".coder-studio", "AGENTS.md"),
    "# Custom\n\n- Custom rule.\n"
  );

  const openResult = await dispatch(
    {
      kind: "command",
      id: "workspace-open",
      op: "workspace.open",
      args: { path: workspaceDir },
    },
    firstCtx
  );
  expect(openResult.ok).toBe(true);

  rmSync(join(workspaceDir, "AGENTS.override.md"), { force: true });
  rmSync(join(workspaceDir, "CLAUDE.local.md"), { force: true });

  server = await createServer({ stateDir, host: "127.0.0.1", port: 0 });
  await server.stop();
  server = await createServer({ stateDir, host: "127.0.0.1", port: 0 });

  expect(await readFile(join(workspaceDir, "AGENTS.override.md"), "utf8")).toContain(
    "# Effective Agent Instructions"
  );
});
```

- [ ] **Step 2: Run the wiring tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server test -- \
  src/__tests__/workspace-commands.test.ts \
  src/__tests__/session-commands.test.ts \
  src/__tests__/workspace-watcher-hydrate-restart.test.ts
```

Expected: the new publisher-related assertions fail until the wiring exists.

- [ ] **Step 3: Implement the server wiring**

Update `CommandContext` to carry an optional publisher.

In `server.ts`:

- create one `AgentInstructionsPublisher` after `workspaceMgr` is available
- call `await publisher.syncAllOpenWorkspaces()` after `workspaceMgr.hydrateWatchers()`
- subscribe `eventBus` to `fs.dirty` and call `publisher.scheduleWorkspaceSync(event.workspaceId)`
- add the publisher to `commandContext`

In `workspace.ts`:

- after `workspaceMgr.open()` returns, call `await ctx.agentInstructionPublisher?.syncWorkspace(workspace.id)`

In `session.ts`:

- before `ctx.sessionMgr.create(...)`, call `await ctx.agentInstructionPublisher?.syncWorkspace(args.workspaceId)`

- [ ] **Step 4: Rerun the wiring tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- \
  src/__tests__/workspace-commands.test.ts \
  src/__tests__/session-commands.test.ts \
  src/__tests__/workspace-watcher-hydrate-restart.test.ts
```

Expected: pass.

### Task 3: Remove submit-time auto-attach and the auto-attach UI state

**Files:**
- Modify: `packages/server/src/commands/terminal.ts`
- Modify: `packages/server/src/commands/agent-instructions.ts`
- Modify: `packages/core/src/domain/types.ts`
- Modify: `packages/server/src/commands/workspace.ts`
- Modify: `packages/web/src/features/workspace/actions/use-agent-instructions-actions.ts`
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.tsx`
- Modify: `packages/web/src/features/workspace/views/shared/agent-instructions-section.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/server/src/__tests__/terminal-commands.test.ts`
- Modify: `packages/server/src/__tests__/workspace-commands.test.ts`

- [ ] **Step 1: Write the failing regression tests**

Replace the current submit-rewrite expectation with a plain-submit expectation:

```ts
it("leaves submit payload untouched", async () => {
  const result = await dispatch(
    {
      kind: "command",
      id: "terminal-input-submit",
      op: "terminal.input",
      args: {
        terminalId: "term-1",
        bytes: Buffer.from("ship it\r").toString("base64"),
        activity: "submit",
        submittedText: "ship it",
      },
    },
    ctx
  );

  expect(sendInput).toHaveBeenCalledWith("sess-1", Buffer.from("ship it\r"), "submit", "ship it");
  expect(sessionMetadataRepo.get("sess-1")?.attachedAgentInstructions).toBeUndefined();
});
```

Update the workspace UI test to remove the auto-attach switch assertion and the `workspace.uiState.set` write for `agentInstructionsAutoAttach`.

- [ ] **Step 2: Run the focused tests and confirm they fail**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/terminal-commands.test.ts src/__tests__/workspace-commands.test.ts
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: the tests still reference the removed auto-attach behavior.

- [ ] **Step 3: Remove the auto-attach path and state**

In `terminal.ts`:

- delete the `maybeRewriteSessionSubmit` branch entirely
- stop importing `resolveEffectiveAgentInstructions` and `buildAutoAttachSubmitPayload`
- keep plain `sessionMgr.sendInput(...)`

In `agent-instructions.ts`:

- delete `buildAutoAttachSubmitPayload`
- keep `attachToSession` as the explicit manual fallback

In `types.ts` and the workspace UI:

- remove `agentInstructionsAutoAttach` from `UiState`
- remove the switch, related action, and stale locale copy
- keep the manual attach button and the three internal status pills

- [ ] **Step 4: Rerun the terminal and UI tests**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/terminal-commands.test.ts src/__tests__/workspace-commands.test.ts
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Expected: pass.

### Task 4: Ignore managed target files in the watcher

**Files:**
- Modify: `packages/server/src/fs/gitignore.ts`
- Modify: `packages/server/src/__tests__/fs/watcher.test.ts`

- [ ] **Step 1: Write the failing ignore test**

Add assertions that the watcher ignores the managed target files but still watches the internal source files:

```ts
it("ignores managed target files used for agent instruction publishing", () => {
  new WorkspaceWatcher("test-workspace-id", testDir, broadcaster);

  const options = watchSpy.mock.calls[0]?.[1];
  const ignored = options?.ignored;

  expect(ignored?.(join(testDir, "AGENTS.override.md"))).toBe(true);
  expect(ignored?.(join(testDir, "CLAUDE.local.md"))).toBe(true);
  expect(ignored?.(join(testDir, ".coder-studio", "AGENTS.md"))).toBe(false);
});
```

- [ ] **Step 2: Run the watcher test and confirm it fails**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/fs/watcher.test.ts
```

Expected: the new ignore assertions fail until the filter is updated.

- [ ] **Step 3: Add the ignore patterns**

Update the watcher ignore regexes so they skip the managed root files only:

```ts
/(^|\/)(AGENTS\.override\.md|CLAUDE\.local\.md)$/
```

Keep the existing `.git`, `node_modules`, and transient lock-file filters unchanged.

- [ ] **Step 4: Rerun the watcher test**

Run:

```bash
pnpm --filter @coder-studio/server test -- src/__tests__/fs/watcher.test.ts
```

Expected: pass.

## Final Verification

Run the focused slice first:

```bash
pnpm --filter @coder-studio/server test -- \
  src/__tests__/agent-instructions-publisher.test.ts \
  src/__tests__/workspace-commands.test.ts \
  src/__tests__/session-commands.test.ts \
  src/__tests__/terminal-commands.test.ts \
  src/__tests__/fs/watcher.test.ts \
  src/__tests__/workspace-watcher-hydrate-restart.test.ts
pnpm --filter @coder-studio/web test -- src/features/workspace/views/shared/agent-instructions-section.test.tsx
```

Then run the broader workspace slice if the focused tests pass:

```bash
pnpm --filter @coder-studio/server test
pnpm --filter @coder-studio/web test
```

Expected: all relevant tests pass, the auto-attach toggle is gone, `terminal.input` no longer rewrites submissions, and the provider-native instruction files are present after workspace open and after source changes.

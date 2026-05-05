# Shell Snapshot-First Terminal Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make shell terminals use the same snapshot-first historical recovery model as agent terminals while keeping replay for fallback and seq-gap repair.

**Architecture:** Extend the server's headless snapshot buffering from agent terminals to shell terminals, then remove the frontend's shell/agent split for baseline recovery so both kinds attempt `terminal.snapshot` before falling back to `terminal.replay`. Keep replay-based gap repair unchanged and preserve graceful degradation when headless snapshot buffering is unavailable or times out.

**Tech Stack:** TypeScript, Node.js, xterm headless, React, Jotai, Vitest, pnpm workspaces.

---

## File Structure

- Modify: `packages/server/src/terminal/manager.ts` - create snapshot buffers for shell terminals and broaden `snapshot()` support from agent-only to buffer-availability-based.
- Modify: `packages/server/src/terminal/manager.test.ts` - cover shell snapshot creation, shell snapshot responses, shell resize wiring, and shell snapshot disposal paths.
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx` - unify historical recovery to snapshot-first for both shell and agent terminals while preserving replay fallback and seq-gap replay repair.
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` - add shell snapshot-first cold-start, reconnect, and fallback coverage; keep replay-only expectations for gap repair.

## Task 1: Extend Snapshot Buffering To Shell Terminals

**Files:**
- Modify: `packages/server/src/terminal/manager.test.ts`
- Modify: `packages/server/src/terminal/manager.ts`

- [ ] **Step 1: Write failing server tests for shell snapshot support**

Add or update tests in `packages/server/src/terminal/manager.test.ts` so they assert:

```ts
it("creates a snapshot buffer for shell and agent terminals", () => {
  const shell = manager.create({
    workspaceId: "ws-123",
    kind: "shell",
    argv: ["bash"],
    cwd: "/home/user",
  });
  const agent = manager.create({
    workspaceId: "ws-123",
    kind: "agent",
    argv: ["node", "agent.js"],
    cwd: "/home/user",
  });

  expect(manager.get(shell.id)?.snapshotBuffer).toBeDefined();
  expect(manager.get(agent.id)?.snapshotBuffer).toBeDefined();
});

it("returns a serialized snapshot for shell terminals", async () => {
  const terminal = manager.create({
    workspaceId: "ws-123",
    kind: "shell",
    argv: ["bash"],
    cwd: "/home/user",
  });
  const onDataCallback = (mockPty.onData as Mock).mock.calls[0][0];

  onDataCallback("hello from shell\n");

  await expect(manager.snapshot(terminal.id)).resolves.toMatchObject({
    status: "ok",
    seq: "hello from shell\n".length,
    cols: 120,
    rows: 30,
  });
});

it("returns unsupported when shell snapshot buffer initialization fails", async () => {
  const snapshotCtorSpy = vi
    .spyOn(snapshotBufferModule, "HeadlessSnapshotBuffer")
    .mockImplementation(
      class MockHeadlessSnapshotBuffer {
        constructor() {
          throw new Error("headless init failed");
        }
      } as unknown as typeof snapshotBufferModule.HeadlessSnapshotBuffer
    );

  try {
    const terminal = manager.create({
      workspaceId: "ws-123",
      kind: "shell",
      argv: ["bash"],
      cwd: "/home/user",
    });

    await expect(manager.snapshot(terminal.id)).resolves.toEqual({
      status: "unsupported",
    });
  } finally {
    snapshotCtorSpy.mockRestore();
  }
});
```

- [ ] **Step 2: Run the targeted server tests to verify they fail**

Run: `pnpm --filter @coder-studio/server vitest run src/terminal/manager.test.ts -t "snapshot"`

Expected: FAIL because shell terminals currently do not allocate `HeadlessSnapshotBuffer` and `snapshot()` rejects non-agent terminals.

- [ ] **Step 3: Implement shell snapshot buffer creation and shell snapshot support**

Update `packages/server/src/terminal/manager.ts` so:

```ts
let snapshotBuffer: HeadlessSnapshotBuffer | undefined;

if (spec.kind === "shell" || spec.kind === "agent") {
  try {
    snapshotBuffer = new HeadlessSnapshotBuffer({
      cols: spec.cols ?? 120,
      rows: spec.rows ?? 30,
    });
  } catch (err) {
    traceTerminal(id, "snapshot.init.error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

And broaden `snapshot()` to gate on buffer availability instead of `spec.kind`:

```ts
async snapshot(terminalId: TerminalId): Promise<SnapshotResult> {
  const terminal = this.terminals.get(terminalId);
  if (!terminal || !terminal.snapshotBuffer) {
    return { status: "unsupported" };
  }

  if (terminal.snapshotBuffer.disabled) {
    return { status: "unsupported" };
  }

  try {
    const result = await terminal.snapshotBuffer.snapshot();
    return {
      status: "ok",
      data: result.data,
      seq: result.seq,
      cols: result.cols,
      rows: result.rows,
    };
  } catch (err) {
    traceTerminal(terminalId, "snapshot.unsupported", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { status: "unsupported" };
  }
}
```

- [ ] **Step 4: Re-run the targeted server tests to verify they pass**

Run: `pnpm --filter @coder-studio/server vitest run src/terminal/manager.test.ts -t "snapshot"`

Expected: PASS with shell terminals creating headless buffers and returning `status: "ok"` snapshots when mirrored output exists.

## Task 2: Preserve Cleanup And Resize Semantics For Shell Snapshot Buffers

**Files:**
- Modify: `packages/server/src/terminal/manager.test.ts`
- Verify: `packages/server/src/terminal/manager.ts`

- [ ] **Step 1: Write failing tests for shell snapshot resize and disposal**

Add tests in `packages/server/src/terminal/manager.test.ts` that assert shell snapshot buffers follow the same lifecycle as agent buffers:

```ts
it("resizes the shell snapshot buffer when the PTY is resized", () => {
  const terminal = manager.create({
    workspaceId: "ws-123",
    kind: "shell",
    argv: ["bash"],
    cwd: "/home/user",
  });

  const resizeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, "resize");

  manager.resize(terminal.id, 140, 40);

  expect(resizeSpy).toHaveBeenCalledWith(140, 40);
});

it("disposes shell snapshot buffers during shutdown", () => {
  const terminal = manager.create({
    workspaceId: "ws-123",
    kind: "shell",
    argv: ["bash"],
    cwd: "/home/user",
  });

  const disposeSpy = vi.spyOn(manager.get(terminal.id)!.snapshotBuffer!, "dispose");

  manager.shutdown();

  expect(disposeSpy).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run the targeted shell lifecycle tests to verify they fail**

Run: `pnpm --filter @coder-studio/server vitest run src/terminal/manager.test.ts -t "shell snapshot"`

Expected: FAIL before Task 1 is complete or before shell lifecycle assertions are updated to expect a real snapshot buffer.

- [ ] **Step 3: Keep the existing shared lifecycle logic and only update expectations**

Do not introduce new cleanup paths. The expected passing state is that existing shared code already covers shell terminals once they own a snapshot buffer:

```ts
if (terminal.snapshotBuffer && !terminal.snapshotBuffer.disabled) {
  try {
    terminal.snapshotBuffer.resize(cols, rows);
  } catch (err) {
    traceTerminal(terminalId, "snapshot.resize.error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

private finalizeTerminal(active: ActiveTerminal): void {
  if (active.cleanupTimer) {
    clearTimeout(active.cleanupTimer);
    active.cleanupTimer = null;
  }
  active.snapshotBuffer?.dispose();
  this.terminals.delete(active.id);
}
```

- [ ] **Step 4: Re-run the full server terminal manager suite**

Run: `pnpm --filter @coder-studio/server vitest run src/terminal/manager.test.ts`

Expected: PASS with shell and agent terminals sharing snapshot buffer lifecycle semantics.

## Task 3: Make Historical Recovery Snapshot-First For Shell Terminals

**Files:**
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`

- [ ] **Step 1: Write failing frontend tests for shell snapshot-first recovery**

Add tests in `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx` that mirror existing agent coverage for shell terminals:

```tsx
it("prefers terminal.snapshot for shell cold start and only flushes live chunks newer than the snapshot seq", async () => {
  const snapshotChunk = new TextEncoder().encode("shell snapshot\n");
  const coveredChunk = new TextEncoder().encode("covered\n");
  const liveChunk = new TextEncoder().encode("fresh shell output\n");
  const sendCommand = vi.fn().mockImplementation((op: string) => {
    if (op === "terminal.snapshot") {
      return Promise.resolve({
        status: "ok",
        transport: "binary",
        streamId: 1201,
        size: snapshotChunk.byteLength,
        seq: 200,
        cols: 132,
        rows: 36,
        source: "headless",
        bytes: snapshotChunk,
      } satisfies TerminalSnapshotPayload);
    }

    return Promise.resolve({ status: "ok" });
  });

  // Same structure as the existing agent snapshot test, but render with
  // terminalKind="shell" and assert replay is not requested.
});

it("falls back to terminal.replay when shell snapshot is unsupported", async () => {
  const replayChunk = new TextEncoder().encode("shell replay fallback\n");
  const sendCommand = vi.fn().mockImplementation((op: string) => {
    if (op === "terminal.snapshot") {
      return Promise.resolve({ status: "unsupported" });
    }
    if (op === "terminal.replay") {
      return Promise.resolve({
        status: "ok",
        transport: "binary",
        streamId: 1211,
        size: replayChunk.byteLength,
        seq: replayChunk.byteLength,
        bytes: replayChunk,
      } satisfies TerminalReplayPayload);
    }

    return Promise.resolve({ status: "ok" });
  });

  // Render with terminalKind="shell" and assert snapshot is attempted first,
  // replay is requested after unsupported, and the replay payload is written.
});
```

- [ ] **Step 2: Run the targeted frontend snapshot tests to verify they fail**

Run: `pnpm --filter @coder-studio/web vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx -t "shell snapshot"`

Expected: FAIL because shell historical recovery currently skips `terminal.snapshot` and goes directly to replay.

- [ ] **Step 3: Remove the shell/agent branch from historical recovery**

Update `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx` so `requestHistoricalRecovery()` always attempts snapshot first:

```ts
const requestHistoricalRecovery = (mode: "initial" | "reconnect") => {
  if (!wsClient) {
    return;
  }

  coldStartStateRef.current = "in-flight";
  replayCompletedRef.current = false;
  setReplayUiState({ kind: "loading" });

  const snapshotPromise: Promise<SnapshotCommandResult> = wsClient
    .sendCommand<TerminalSnapshotPayload>(
      "terminal.snapshot",
      { terminalId },
      { timeoutMs: TERMINAL_REPLAY_TIMEOUT_MS }
    )
    .then((data) => ({ ok: true as const, data }))
    .catch((error) => ({ ok: false as const, error }));

  void snapshotPromise.then((result) => {
    if (!mountedRef.current || !terminalRef.current) {
      return;
    }

    if (result.ok && result.data?.status === "ok") {
      finishHistoricalLoad(result, {
        successStatus: "ok",
        successBytes: result.data.bytes,
        coveredSeq: result.data.seq,
      });
      return;
    }

    traceTerminal(terminalId, "snapshot.fallback", {
      reason: result.ok ? (result.data?.status ?? "unsupported") : String(result.error),
    });
    requestReplay(mode === "initial" ? 0 : latestRenderedSeqRef.current);
  });
};
```

Do not change the live gap repair branch:

```ts
if (chunkStartSeq > replayedSeqRef.current) {
  pendingReplayChunksRef.current.push({
    bytes: outputData.bytes,
    seq: _seq,
  });
  setOutputAtom((_prev: OutputBuffer) => ({
    chunks: [],
    lastSeq: replayedSeqRef.current,
  }));
  requestReplay(replayedSeqRef.current);
  return;
}
```

- [ ] **Step 4: Re-run the targeted frontend snapshot tests to verify they pass**

Run: `pnpm --filter @coder-studio/web vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx -t "shell snapshot"`

Expected: PASS with shell terminals attempting snapshot first, preserving replay fallback, and only flushing live bytes newer than the snapshot's covered seq.

## Task 4: Keep Reconnect And Gap Recovery Semantics Intact

**Files:**
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Verify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`

- [ ] **Step 1: Write failing reconnect coverage for shell snapshot-first recovery**

Add reconnect-focused tests in `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`:

```tsx
it("replays shell history again after websocket reconnect using snapshot", async () => {
  const firstSnapshot = new TextEncoder().encode("shell snapshot\n");
  const reconnectSnapshot = new TextEncoder().encode("shell snapshot after reconnect\n");
  let snapshotCount = 0;

  const sendCommand = vi.fn().mockImplementation((op: string) => {
    if (op === "terminal.snapshot") {
      snapshotCount += 1;
      return Promise.resolve({
        status: "ok",
        transport: "binary",
        streamId: snapshotCount === 1 ? 1250 : 1251,
        size: (snapshotCount === 1 ? firstSnapshot : reconnectSnapshot).byteLength,
        seq: snapshotCount === 1 ? 200 : 240,
        rows: 36,
        cols: 132,
        source: "headless",
        bytes: snapshotCount === 1 ? firstSnapshot : reconnectSnapshot,
      } satisfies TerminalSnapshotPayload);
    }

    return Promise.resolve({ status: "ok" });
  });

  // Render with terminalKind="shell", drive websocket status changes,
  // and assert snapshotCount === 2 with both snapshot payloads painted.
});

it("falls back to replay on shell reconnect when snapshot refresh fails", async () => {
  const initialSnapshot = new TextEncoder().encode("initial shell snapshot\n");
  const replayFallback = new TextEncoder().encode("shell reconnect replay\n");
  let snapshotCount = 0;

  const sendCommand = vi.fn().mockImplementation((op: string, args: { lastSeq?: number }) => {
    if (op === "terminal.snapshot") {
      snapshotCount += 1;
      if (snapshotCount === 1) {
        return Promise.resolve({
          status: "ok",
          transport: "binary",
          streamId: 1260,
          size: initialSnapshot.byteLength,
          seq: 200,
          rows: 36,
          cols: 132,
          source: "headless",
          bytes: initialSnapshot,
        } satisfies TerminalSnapshotPayload);
      }

      return Promise.reject(new Error("Command timeout: terminal.snapshot"));
    }

    if (op === "terminal.replay") {
      expect(args.lastSeq).toBe(200);
      return Promise.resolve({
        status: "ok",
        transport: "binary",
        streamId: 1261,
        size: replayFallback.byteLength,
        seq: 240,
        bytes: replayFallback,
      } satisfies TerminalReplayPayload);
    }

    return Promise.resolve({ status: "ok" });
  });

  // Render with terminalKind="shell", reconnect, and assert replay fallback
  // starts from the snapshot-covered seq instead of from zero.
});
```

- [ ] **Step 2: Run the targeted reconnect tests to verify they fail**

Run: `pnpm --filter @coder-studio/web vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx -t "shell reconnect"`

Expected: FAIL because shell reconnects still use replay-only historical recovery.

- [ ] **Step 3: Keep seq-gap replay repair unchanged and verify no regressions**

The expected implementation state is:

```ts
if (chunkStartSeq > replayedSeqRef.current) {
  traceTerminal(terminalId, "live.gap", {
    seq: _seq,
    chunkStartSeq,
    replayedSeq: replayedSeqRef.current,
  });
  pendingReplayChunksRef.current.push({
    bytes: outputData.bytes,
    seq: _seq,
  });
  setOutputAtom((_prev: OutputBuffer) => ({
    chunks: [],
    lastSeq: replayedSeqRef.current,
  }));
  requestReplay(replayedSeqRef.current);
  return;
}
```

No snapshot-based replacement should be introduced into the seq-gap path in this phase.

- [ ] **Step 4: Re-run the full xterm host test suite**

Run: `pnpm --filter @coder-studio/web vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx`

Expected: PASS with shell and agent terminals sharing snapshot-first baseline recovery and replay-only gap repair.

## Task 5: Final Verification

**Files:**
- Verify: `packages/server/src/terminal/manager.ts`
- Verify: `packages/server/src/terminal/manager.test.ts`
- Verify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Verify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`

- [ ] **Step 1: Run targeted package tests**

Run:

```bash
pnpm --filter @coder-studio/server vitest run src/terminal/manager.test.ts
pnpm --filter @coder-studio/web vitest run src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected: PASS in both packages.

- [ ] **Step 2: Run a broader sanity check**

Run:

```bash
pnpm --filter @coder-studio/server test
pnpm --filter @coder-studio/web test
```

Expected: PASS, or if either suite is too slow or currently noisy, capture the exact failing tests before claiming completion.

- [ ] **Step 3: Stop before committing unless explicitly requested**

Do not create a git commit in this session unless the human partner asks for one after reviewing the diff and test results.

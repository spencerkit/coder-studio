import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  decodeTerminalBinaryFrame,
  type Terminal,
  TerminalBinaryFrameType,
} from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/recovery.js";
import "../commands/terminal.js";
import { clearPendingTerminalInput, registerPendingTerminalInput } from "../commands/terminal.js";

function createContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    db: {} as never,
    workspaceMgr: {
      get: vi.fn().mockReturnValue({
        id: "ws-1",
        path: "/tmp/workspace",
      }),
    } as never,
    sessionMgr: {
      findSessionIdByTerminal: vi.fn(),
      sendInput: vi.fn(),
      resize: vi.fn(),
    } as never,
    terminalMgr: {
      create: vi.fn().mockImplementation(
        (spec) =>
          ({
            id: "term-1",
            workspaceId: spec.workspaceId,
            kind: spec.kind,
            title: spec.title ?? spec.argv[0],
            cwd: spec.cwd,
            argv: spec.argv,
            cols: spec.cols ?? 120,
            rows: spec.rows ?? 30,
            alive: true,
            createdAt: Date.now(),
          }) satisfies Terminal
      ),
      getAll: vi.fn().mockReturnValue([]),
      replay: vi.fn(),
      snapshot: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      write: vi.fn(),
      resize: vi.fn(),
      syncThemeBackgroundForWorkspace: vi.fn(),
    } as never,
    eventBus: {} as never,
    broadcaster: {
      broadcast: vi.fn(),
      sendToClient: vi.fn(),
      sendBinaryToClient: vi.fn(),
    } as never,
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    providerRegistry: [],
    ...overrides,
  };
}

describe("terminal commands", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function createWorkspaceDir(): string {
    return mkdtempSync(join(tmpdir(), "terminal-commands-"));
  }

  it("returns task terminals from terminal.list", async () => {
    const taskTerminal: Terminal = {
      id: "term-task",
      workspaceId: "ws-1",
      kind: "task",
      title: "Task: Verify",
      cwd: "/tmp/workspace",
      argv: ["pnpm", "ci:verify"],
      cols: 120,
      rows: 30,
      alive: true,
      createdAt: 1,
    };
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn(() => [
          {
            toDTO: () => taskTerminal,
          },
        ]),
        replay: vi.fn(),
        snapshot: vi.fn(),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
        syncThemeBackgroundForWorkspace: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-list-task-1",
        op: "terminal.list",
        args: { workspaceId: "ws-1" },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([taskTerminal]);
  });

  it("returns binary metadata and sends replay payload to requesting client", async () => {
    const replayData = Buffer.from("replay payload");
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn().mockReturnValue({ status: "ok", data: replayData, seq: 9 }),
        snapshot: vi.fn(),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-replay-1",
        op: "terminal.replay",
        args: {
          terminalId: "term-1",
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "ok",
      transport: "binary",
      streamId: expect.any(Number),
      size: replayData.length,
      seq: 9,
    });
    expect(ctx.broadcaster.sendBinaryToClient).toHaveBeenCalledWith("client-1", expect.any(Buffer));
  });

  it("keeps replay streamId consistent between metadata and binary frame", async () => {
    const replayData = Buffer.from("replay payload");
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_777_177_555_456);
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn().mockReturnValue({ status: "ok", data: replayData, seq: 9 }),
        snapshot: vi.fn(),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "terminal-replay-stream-id-1",
          op: "terminal.replay",
          args: {
            terminalId: "term-1",
          },
        },
        ctx,
        "client-1"
      );

      expect(result.ok).toBe(true);
      expect(ctx.broadcaster.sendBinaryToClient).toHaveBeenCalledWith(
        "client-1",
        expect.any(Buffer)
      );

      const replayFrame = vi.mocked(ctx.broadcaster.sendBinaryToClient).mock
        .calls[0]?.[1] as Buffer;
      const { header, payload } = decodeTerminalBinaryFrame(replayFrame);

      expect(header.type).toBe(TerminalBinaryFrameType.Replay);
      expect(result.data).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: header.streamId,
        size: replayData.length,
        seq: 9,
      });
      expect(Buffer.from(payload)).toEqual(replayData);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("assigns unique streamIds to concurrent replay requests", async () => {
    const replayData = Buffer.alloc(0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(1_777_177_555_456);
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn().mockReturnValue({ status: "ok", data: replayData, seq: 0 }),
        snapshot: vi.fn(),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    try {
      const first = await dispatch(
        {
          kind: "command",
          id: "terminal-replay-unique-1",
          op: "terminal.replay",
          args: { terminalId: "term-1", lastSeq: 0 },
        },
        ctx,
        "client-a"
      );
      const second = await dispatch(
        {
          kind: "command",
          id: "terminal-replay-unique-2",
          op: "terminal.replay",
          args: { terminalId: "term-1", lastSeq: 0 },
        },
        ctx,
        "client-b"
      );

      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
      expect(first.data).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: expect.any(Number),
      });
      expect(second.data).toMatchObject({
        status: "ok",
        transport: "binary",
        streamId: expect.any(Number),
      });
      expect((first.data as { streamId: number }).streamId).not.toBe(
        (second.data as { streamId: number }).streamId
      );
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("uses the current user shell when creating shell terminals", async () => {
    vi.stubEnv("SHELL", "/bin/zsh");
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-create-1",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({
        argv: ["/bin/zsh", "-i"],
        title: "zsh",
      })
    );
  });

  it("returns terminal_spawn_failed when shell terminal creation throws a terminal spawn error", async () => {
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn().mockImplementation(() => {
          const error = new Error("Terminal spawn failed: posix_spawnp failed.") as Error & {
            code: string;
            details: Record<string, unknown>;
          };
          error.code = "terminal_spawn_failed";
          error.details = {
            command: "/bin/zsh",
            cwd: "/tmp/workspace",
            terminalKind: "shell",
          };
          throw error;
        }),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn(),
        snapshot: vi.fn(),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-create-fail-1",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "terminal_spawn_failed",
      message: "Terminal spawn failed: posix_spawnp failed.",
      details: {
        command: "/bin/zsh",
        cwd: "/tmp/workspace",
        terminalKind: "shell",
      },
    });
  });

  it("passes resolved cwdPath to terminalMgr.create", async () => {
    const workspacePath = createWorkspaceDir();
    const targetDir = join(workspacePath, "packages");
    const cleanup = () => rmSync(workspacePath, { recursive: true, force: true });
    rmSync(targetDir, { recursive: true, force: true });
    try {
      mkdirSync(targetDir);
      const ctx = createContext({
        workspaceMgr: {
          get: vi.fn().mockReturnValue({
            id: "ws-1",
            path: workspacePath,
          }),
        } as never,
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "terminal-create-cwd-1",
          op: "terminal.create",
          args: {
            workspaceId: "ws-1",
            cwdPath: "packages",
          },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(ctx.terminalMgr.create).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: targetDir,
        })
      );
    } finally {
      cleanup();
    }
  });

  it("returns invalid_cwd_path for absolute cwdPath", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-create-cwd-absolute-1",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
          cwdPath: "/tmp/workspace/packages",
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "invalid_cwd_path",
    });
    expect(ctx.terminalMgr.create).not.toHaveBeenCalled();
  });

  it("returns invalid_cwd_path for cwdPath traversal outside the workspace", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-create-cwd-traversal-1",
        op: "terminal.create",
        args: {
          workspaceId: "ws-1",
          cwdPath: "../outside",
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "invalid_cwd_path",
    });
    expect(ctx.terminalMgr.create).not.toHaveBeenCalled();
  });

  it("returns cwd_not_found for missing cwdPath", async () => {
    const workspacePath = createWorkspaceDir();
    try {
      const ctx = createContext({
        workspaceMgr: {
          get: vi.fn().mockReturnValue({
            id: "ws-1",
            path: workspacePath,
          }),
        } as never,
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "terminal-create-cwd-missing-1",
          op: "terminal.create",
          args: {
            workspaceId: "ws-1",
            cwdPath: "missing-dir",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "cwd_not_found",
      });
      expect(ctx.terminalMgr.create).not.toHaveBeenCalled();
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("returns cwd_not_directory for cwdPath that resolves to a file", async () => {
    const workspacePath = createWorkspaceDir();
    const filePath = join(workspacePath, "README.md");
    try {
      writeFileSync(filePath, "test");
      const ctx = createContext({
        workspaceMgr: {
          get: vi.fn().mockReturnValue({
            id: "ws-1",
            path: workspacePath,
          }),
        } as never,
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "terminal-create-cwd-file-1",
          op: "terminal.create",
          args: {
            workspaceId: "ws-1",
            cwdPath: "README.md",
          },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "cwd_not_directory",
      });
      expect(ctx.terminalMgr.create).not.toHaveBeenCalled();
    } finally {
      rmSync(workspacePath, { recursive: true, force: true });
    }
  });

  it("returns snapshot metadata and sends snapshot payload to requesting client", async () => {
    const snapshotData = Buffer.from("serialized snapshot");
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({
          status: "ok",
          data: snapshotData,
          seq: 17,
          cols: 132,
          rows: 40,
        }),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-snapshot-1",
        op: "terminal.snapshot",
        args: {
          terminalId: "term-1",
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      status: "ok",
      transport: "binary",
      streamId: expect.any(Number),
      size: snapshotData.length,
      seq: 17,
      cols: 132,
      rows: 40,
      source: "headless",
    });
    expect(ctx.broadcaster.sendBinaryToClient).toHaveBeenCalledWith("client-1", expect.any(Buffer));

    const frame = vi.mocked(ctx.broadcaster.sendBinaryToClient).mock.calls[0]?.[1] as Buffer;
    const { header, payload } = decodeTerminalBinaryFrame(frame);
    expect(header.type).toBe(TerminalBinaryFrameType.Snapshot);
    expect(header.meta).toBe(17);
    expect(header.streamId).toBe((result.data as { streamId: number }).streamId);
    expect(Buffer.from(payload)).toEqual(snapshotData);
  });

  it("returns unsupported for shell or disabled snapshot terminals", async () => {
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn(),
        snapshot: vi.fn().mockResolvedValue({ status: "unsupported" }),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-snapshot-unsupported-1",
        op: "terminal.snapshot",
        args: {
          terminalId: "term-shell",
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ status: "unsupported" });
    expect(ctx.broadcaster.sendBinaryToClient).not.toHaveBeenCalled();
  });

  it("uses one outbound allocator for replay and snapshot streamIds", async () => {
    const replayData = Buffer.from("replay payload");
    const snapshotData = Buffer.from("snapshot payload");
    const ctx = createContext({
      terminalMgr: {
        create: vi.fn(),
        getAll: vi.fn().mockReturnValue([]),
        replay: vi.fn().mockReturnValue({ status: "ok", data: replayData, seq: 9 }),
        snapshot: vi.fn().mockResolvedValue({
          status: "ok",
          data: snapshotData,
          seq: 11,
          cols: 120,
          rows: 30,
        }),
        kill: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        write: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const replayResult = await dispatch(
      {
        kind: "command",
        id: "terminal-replay-alloc-1",
        op: "terminal.replay",
        args: { terminalId: "term-1", lastSeq: 0 },
      },
      ctx,
      "client-a"
    );
    const snapshotResult = await dispatch(
      {
        kind: "command",
        id: "terminal-snapshot-alloc-1",
        op: "terminal.snapshot",
        args: { terminalId: "term-1" },
      },
      ctx,
      "client-a"
    );

    expect(replayResult.ok).toBe(true);
    expect(snapshotResult.ok).toBe(true);
    expect((replayResult.data as { streamId: number }).streamId).not.toBe(
      (snapshotResult.data as { streamId: number }).streamId
    );

    const replayFrame = vi.mocked(ctx.broadcaster.sendBinaryToClient).mock.calls[0]?.[1] as Buffer;
    const snapshotFrame = vi.mocked(ctx.broadcaster.sendBinaryToClient).mock
      .calls[1]?.[1] as Buffer;
    expect(decodeTerminalBinaryFrame(replayFrame).header.type).toBe(TerminalBinaryFrameType.Replay);
    expect(decodeTerminalBinaryFrame(snapshotFrame).header.type).toBe(
      TerminalBinaryFrameType.Snapshot
    );
  });

  it("returns noop when rendered seq already matches terminal head seq", async () => {
    const baseCtx = createContext();
    const ctx = createContext({
      terminalMgr: {
        ...baseCtx.terminalMgr,
        inspectRecovery: vi.fn().mockReturnValue({
          status: "ok",
          headSeq: 42,
          replay: { kind: "available", fromSeq: 42 },
          snapshot: { kind: "available" },
          alive: true,
        }),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "recovery-reconcile-noop",
        op: "recovery.reconcile",
        args: {
          reason: "foreground_resume",
          terminals: [{ terminalId: "term-1", renderedSeq: 42 }],
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      terminals: [{ terminalId: "term-1", action: "noop", headSeq: 42 }],
    });
  });

  it("prefers snapshot on initial mount when snapshot is available", async () => {
    const baseCtx = createContext();
    const ctx = createContext({
      terminalMgr: {
        ...baseCtx.terminalMgr,
        inspectRecovery: vi.fn().mockReturnValue({
          status: "ok",
          headSeq: 42,
          replay: { kind: "available", fromSeq: 0 },
          snapshot: { kind: "available" },
          alive: true,
        }),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "recovery-reconcile-snapshot",
        op: "recovery.reconcile",
        args: {
          reason: "initial_mount",
          terminals: [{ terminalId: "term-1", renderedSeq: 0 }],
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      terminals: [{ terminalId: "term-1", action: "snapshot", headSeq: 42 }],
    });
  });

  it("falls back to unrecoverable when replay is too old and no snapshot is available", async () => {
    const baseCtx = createContext();
    const ctx = createContext({
      terminalMgr: {
        ...baseCtx.terminalMgr,
        inspectRecovery: vi.fn().mockReturnValue({
          status: "ok",
          headSeq: 42,
          replay: { kind: "too_old" },
          snapshot: { kind: "unavailable" },
          alive: true,
        }),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "recovery-reconcile-bad",
        op: "recovery.reconcile",
        args: {
          reason: "seq_gap",
          terminals: [{ terminalId: "term-1", renderedSeq: 0 }],
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      terminals: [
        {
          terminalId: "term-1",
          action: "unrecoverable",
          reason: "too_old_no_snapshot",
        },
      ],
    });
  });

  it("returns closed together with replay when the terminal exited while the client is behind head seq", async () => {
    const baseCtx = createContext();
    const ctx = createContext({
      terminalMgr: {
        ...baseCtx.terminalMgr,
        inspectRecovery: vi.fn().mockReturnValue({
          status: "ok",
          headSeq: 42,
          replay: { kind: "available", fromSeq: 12 },
          snapshot: { kind: "available" },
          alive: false,
          exitCode: 7,
        }),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "recovery-reconcile-closed-replay",
        op: "recovery.reconcile",
        args: {
          reason: "socket_reconnected",
          terminals: [{ terminalId: "term-1", renderedSeq: 12 }],
        },
      },
      ctx,
      "client-1"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      terminals: [
        {
          terminalId: "term-1",
          action: "replay",
          fromSeq: 12,
          headSeq: 42,
          closed: { exitCode: 7 },
        },
      ],
    });
  });

  it("delegates terminal.input binary payload to sessionMgr.sendInput when a session owns the terminal", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue("sess-1"),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from("二进制输入");
    const streamId = 42;

    registerPendingTerminalInput(
      {
        terminalId: "term-1",
        transport: "binary",
        streamId,
        size: bytes.length,
        activity: "submit",
      },
      bytes
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-binary-1",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          transport: "binary",
          streamId,
          size: bytes.length,
          activity: "submit",
          submittedText: "你好，世界",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.sendInput).toHaveBeenCalledWith("sess-1", bytes, "submit", "你好，世界");
    expect(ctx.terminalMgr.write).not.toHaveBeenCalled();
  });

  it("delegates terminal.input to sessionMgr.sendInput when a session owns the terminal", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue("sess-1"),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from("hi").toString("base64");

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-1",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          bytes,
          activity: "submit",
          submittedText: "hi there",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.findSessionIdByTerminal).toHaveBeenCalledWith("term-1");
    expect(ctx.sessionMgr.sendInput).toHaveBeenCalledWith(
      "sess-1",
      Buffer.from("hi"),
      "submit",
      "hi there"
    );
    expect(ctx.terminalMgr.write).not.toHaveBeenCalled();
  });

  it("leaves submit payload untouched", async () => {
    const sessionMetadataRepo = {
      get: vi.fn(),
      upsert: vi.fn(),
    };
    const sendInput = vi.fn();
    const ctx = createContext({
      workspaceMgr: {
        get: vi.fn().mockReturnValue({
          id: "ws-1",
          path: "/workspace",
          uiState: {
            leftPanelWidth: 320,
            bottomPanelHeight: 240,
            focusMode: false,
          },
        }),
      } as never,
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue("sess-1"),
        get: vi.fn().mockReturnValue({
          id: "sess-1",
          terminalId: "term-1",
          state: "idle",
          workspaceId: "ws-1",
          providerId: "codex",
          capability: "full",
          startedAt: 1,
          lastActiveAt: 1,
        }),
        sendInput,
        resize: vi.fn(),
      } as never,
      sessionMetadataRepo: sessionMetadataRepo as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-submit-1",
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

    expect(result.ok).toBe(true);
    expect(sendInput).toHaveBeenCalledWith("sess-1", Buffer.from("ship it\r"), "submit", "ship it");
    expect(sessionMetadataRepo.get).not.toHaveBeenCalled();
    expect(sessionMetadataRepo.upsert).not.toHaveBeenCalled();
  });

  it("delegates ctrl-modified terminal.input to sessionMgr.sendInput as control activity", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue("sess-1"),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from("\x03");

    registerPendingTerminalInput(
      {
        terminalId: "term-1",
        transport: "binary",
        streamId: 77,
        size: bytes.length,
        activity: "control",
      },
      bytes
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-control-1",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          transport: "binary",
          streamId: 77,
          size: bytes.length,
          activity: "control",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.sendInput).toHaveBeenCalledWith("sess-1", bytes, "control", undefined);
    expect(ctx.terminalMgr.write).not.toHaveBeenCalled();
  });

  it("accepts system activity for session-owned terminal.input", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue("sess-1"),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-system-1",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          bytes: Buffer.from("\x1b[I").toString("base64"),
          activity: "system",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.sendInput).toHaveBeenCalledWith(
      "sess-1",
      Buffer.from("\x1b[I"),
      "system",
      undefined
    );
    expect(ctx.terminalMgr.write).not.toHaveBeenCalled();
  });

  it("falls back to terminalMgr.write for terminal.input when no session owns the terminal", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue(undefined),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });
    const bytes = Buffer.from("ls\n").toString("base64");

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-2",
        op: "terminal.input",
        args: {
          terminalId: "term-shell",
          bytes,
          activity: "submit",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.write).toHaveBeenCalledWith("term-shell", Buffer.from("ls\n"));
    expect(ctx.sessionMgr.sendInput).not.toHaveBeenCalled();
  });

  it("rejects invalid terminal.input activity values", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-invalid-activity",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          bytes: Buffer.from("hello").toString("base64"),
          activity: "definitely_invalid",
        },
      },
      createContext()
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("clears pending binary payloads after validation failures", async () => {
    const bytes = Buffer.from("hello");
    const streamId = 31337;
    registerPendingTerminalInput(
      {
        terminalId: "term-1",
        transport: "binary",
        streamId,
        size: bytes.length,
        activity: "typing",
      },
      bytes
    );

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-input-invalid-binary-activity",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          transport: "binary",
          streamId,
          size: bytes.length,
          activity: "definitely_invalid",
        },
      },
      createContext()
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");

    clearPendingTerminalInput(streamId);
  });

  it("delegates terminal.resize to sessionMgr.resize when a session owns the terminal", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue("sess-1"),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-resize-1",
        op: "terminal.resize",
        args: {
          terminalId: "term-1",
          cols: 120,
          rows: 40,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.sessionMgr.findSessionIdByTerminal).toHaveBeenCalledWith("term-1");
    expect(ctx.sessionMgr.resize).toHaveBeenCalledWith("sess-1", 120, 40);
    expect(ctx.terminalMgr.resize).not.toHaveBeenCalled();
  });

  it("falls back to terminalMgr.resize when no session owns the terminal", async () => {
    const ctx = createContext({
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue(undefined),
        sendInput: vi.fn(),
        resize: vi.fn(),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-resize-2",
        op: "terminal.resize",
        args: {
          terminalId: "term-shell",
          cols: 80,
          rows: 24,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.resize).toHaveBeenCalledWith("term-shell", 80, 24);
    expect(ctx.sessionMgr.resize).not.toHaveBeenCalled();
  });

  it("delegates terminal.syncThemeBackground to terminalMgr.syncThemeBackgroundForWorkspace", async () => {
    const ctx = createContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "terminal-sync-theme-1",
        op: "terminal.syncThemeBackground",
        args: {
          workspaceId: "ws-1",
          themeBackground: "#0b1218",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(ctx.terminalMgr.syncThemeBackgroundForWorkspace).toHaveBeenCalledWith("ws-1", "#0b1218");
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";
import { type CommandContext, dispatch } from "../ws/dispatch.js";

import "../commands/supervisor.js";

describe("supervisor commands", () => {
  const supervisorMgr = {
    create: vi.fn(async (input) => ({
      id: "sup-1",
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      state: "idle",
      objective: input.objective,
      evaluatorProviderId: input.evaluatorProviderId,
      evaluatorModel: input.evaluatorModel,
      maxSupervisionCount: input.maxSupervisionCount ?? 0,
      completedSupervisionCount: 0,
      scheduledAt: input.scheduledAt,
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    })),
    listRecoverableTargets: vi.fn(async () => [
      {
        targetId: "tgt-1",
        sessionId: "sess-old",
        workspaceId: "ws-1",
        objective: "Restore old work",
        status: "cancelled",
        updatedAt: 10,
        progressSummary: "Halfway done",
        cycleCount: 2,
      },
    ]),
    restore: vi.fn(async (input) => ({
      id: "sup-restored",
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      targetId: "sup-restored",
      state: "idle",
      objective: "Restore old work",
      evaluatorProviderId: input.evaluatorProviderId,
      evaluatorModel: input.evaluatorModel,
      maxSupervisionCount: input.maxSupervisionCount ?? 0,
      completedSupervisionCount: 2,
      scheduledAt: input.scheduledAt,
      recentTargetCycles: [],
      cycles: [],
      createdAt: 1,
      updatedAt: 1,
    })),
    getBySession: vi.fn(() => null),
    update: vi.fn(async (id, patch) => ({
      id,
      sessionId: "sess-1",
      workspaceId: "ws-1",
      state: "idle",
      objective: patch.objective ?? "existing objective",
      evaluatorProviderId: patch.evaluatorProviderId ?? "claude",
      evaluatorModel: patch.evaluatorModel ?? undefined,
      maxSupervisionCount: patch.maxSupervisionCount ?? 0,
      completedSupervisionCount: 0,
      scheduledAt: patch.scheduledAt ?? undefined,
      cycles: [],
      createdAt: 1,
      updatedAt: 2,
    })),
    delete: vi.fn(async () => {}),
    pause: vi.fn(),
    resume: vi.fn(),
    triggerEvaluation: vi.fn(),
  };

  let ctx: CommandContext;

  beforeEach(() => {
    vi.clearAllMocks();
    ctx = {
      db: {},
      workspaceMgr: {},
      sessionMgr: {},
      terminalMgr: {},
      eventBus: {},
      broadcaster: { broadcast: vi.fn() },
      providerRegistry: [],
      fencingMgr: {},
      supervisorMgr,
    } as unknown as CommandContext;
  });

  it("passes evaluatorProviderId through supervisor.create", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-1",
        op: "supervisor.create",
        args: {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Ship supervisor persistence",
          evaluatorProviderId: "codex",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({ evaluatorProviderId: "codex" })
    );
  });

  it("passes evaluatorModel, maxSupervisionCount, and scheduledAt through supervisor.create", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-1b",
        op: "supervisor.create",
        args: {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Ship execution policy",
          evaluatorProviderId: "codex",
          evaluatorModel: "o3",
          maxSupervisionCount: 5,
          scheduledAt: 1_746_950_400_000,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.create).toHaveBeenCalledWith(
      expect.objectContaining({
        evaluatorModel: "o3",
        maxSupervisionCount: 5,
        scheduledAt: 1_746_950_400_000,
      })
    );
  });

  it("rejects legacy intervalMs on supervisor.create", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-2",
        op: "supervisor.create",
        args: {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          objective: "Ship supervisor persistence",
          evaluatorProviderId: "claude",
          intervalMs: 60000,
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("passes evaluatorProviderId through supervisor.update", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-3",
        op: "supervisor.update",
        args: {
          id: "sup-1",
          evaluatorProviderId: "codex",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.update).toHaveBeenCalledWith("sup-1", {
      evaluatorProviderId: "codex",
      evaluatorModel: undefined,
      maxSupervisionCount: undefined,
      objective: undefined,
      scheduledAt: undefined,
    });
  });

  it("passes evaluatorModel, maxSupervisionCount, and scheduledAt through supervisor.update", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-3b",
        op: "supervisor.update",
        args: {
          id: "sup-1",
          evaluatorModel: "o3",
          maxSupervisionCount: 5,
          scheduledAt: 1_746_950_400_000,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.update).toHaveBeenCalledWith("sup-1", {
      evaluatorProviderId: undefined,
      evaluatorModel: "o3",
      maxSupervisionCount: 5,
      objective: undefined,
      scheduledAt: 1_746_950_400_000,
    });
  });

  it("rejects supervisor.update with no patch fields", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-4",
        op: "supervisor.update",
        args: {
          id: "sup-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("rejects legacy intervalMs on supervisor.update", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-5",
        op: "supervisor.update",
        args: {
          id: "sup-1",
          intervalMs: 60000,
        },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("validation_error");
  });

  it("lists recoverable targets for a workspace", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-6",
        op: "supervisor.listRecoverableTargets",
        args: {
          workspaceId: "ws-1",
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.listRecoverableTargets).toHaveBeenCalledWith("ws-1");
  });

  it("passes restore arguments through supervisor.restore", async () => {
    const result = await dispatch(
      {
        kind: "command",
        id: "cmd-7",
        op: "supervisor.restore",
        args: {
          sessionId: "sess-1",
          workspaceId: "ws-1",
          sourceTargetId: "tgt-1",
          evaluatorProviderId: "codex",
          evaluatorModel: "o3",
          maxSupervisionCount: 3,
          scheduledAt: 1_746_950_400_000,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(supervisorMgr.restore).toHaveBeenCalledWith({
      sessionId: "sess-1",
      workspaceId: "ws-1",
      sourceTargetId: "tgt-1",
      evaluatorProviderId: "codex",
      evaluatorModel: "o3",
      maxSupervisionCount: 3,
      scheduledAt: 1_746_950_400_000,
    });
  });
});

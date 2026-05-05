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
      objective: undefined,
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
});

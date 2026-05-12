import type { FastifyRequest } from "fastify";
import { describe, expect, it, vi } from "vitest";
import { ActivationManager } from "../ws/activation.js";
import { type CommandContext, dispatch } from "../ws/dispatch.js";
import type { Broadcaster } from "../ws/hub.js";
import "../commands/activation.js";
import "../commands/workspace.js";

function createMockRequest(): FastifyRequest {
  return {
    ip: "127.0.0.1",
    headers: { "user-agent": "test-agent" },
  } as unknown as FastifyRequest;
}

function createBaseContext(overrides?: {
  broadcaster?: Broadcaster;
  activationMgr?: ActivationManager;
}): CommandContext {
  return {
    workspaceMgr: {
      list: vi.fn(() => [{ id: "workspace-1" }]),
    } as unknown as CommandContext["workspaceMgr"],
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster:
      overrides?.broadcaster ??
      ({
        broadcast: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
      } as unknown as Broadcaster),
    db: {} as never,
    providerRegistry: [],
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: overrides?.activationMgr ?? new ActivationManager(),
  };
}

describe("activation commands", () => {
  it("returns generation data from activation.claim", async () => {
    const request = createMockRequest();
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000001",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      active: true,
      generation: 1,
      recoveryMode: "fresh",
    });
    expect(broadcaster.getRequestMetadata).toHaveBeenCalledWith("ws-a");
    expect(ctx.activationMgr.getLease()).toMatchObject({
      clientInstanceId: "client-a",
      wsClientId: "ws-a",
      ip: "127.0.0.1",
      userAgent: "test-agent",
    });
  });

  it("rejects non-activation commands for websocket clients without an active lease", async () => {
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => createMockRequest()),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000002",
        op: "workspace.list",
        args: {},
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "activation_required",
      message: "This tab is no longer the active session",
    });
  });

  it("rejects non-activation websocket commands when metadata lookup returns undefined", async () => {
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => undefined),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000004",
        op: "workspace.list",
        args: {},
      },
      ctx,
      "ws-a"
    );

    expect(result.ok).toBe(false);
    expect(result.error).toEqual({
      code: "activation_required",
      message: "This tab is no longer the active session",
    });
  });

  it("does not allow a stale websocket to heartbeat after same-client rebind", async () => {
    const request = createMockRequest();
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    await dispatch(
      {
        kind: "command",
        id: "claim-1",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    const rebound = await dispatch(
      {
        kind: "command",
        id: "claim-2",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-b"
    );

    expect(rebound.ok).toBe(true);

    const heartbeat = await dispatch(
      {
        kind: "command",
        id: "heartbeat-stale",
        op: "activation.heartbeat",
        args: { clientInstanceId: "client-a", generation: 1 },
      },
      ctx,
      "ws-a"
    );

    expect(heartbeat.ok).toBe(true);
    expect(heartbeat.data).toEqual({ ok: false });
  });

  it("does not allow a stale websocket to release after same-client rebind", async () => {
    const request = createMockRequest();
    const broadcaster = {
      broadcast: vi.fn(),
      sendToClient: vi.fn(() => true),
      sendBinaryToClient: vi.fn(() => true),
      getRequestMetadata: vi.fn(() => request),
    } satisfies Broadcaster;
    const ctx = createBaseContext({ broadcaster });

    await dispatch(
      {
        kind: "command",
        id: "claim-3",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    await dispatch(
      {
        kind: "command",
        id: "claim-4",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-b"
    );

    const release = await dispatch(
      {
        kind: "command",
        id: "release-stale",
        op: "activation.release",
        args: { clientInstanceId: "client-a", generation: 1 },
      },
      ctx,
      "ws-a"
    );

    expect(release.ok).toBe(true);
    expect(release.data).toEqual({ ok: false });
    expect(ctx.activationMgr.getLease()).toMatchObject({
      clientInstanceId: "client-a",
      wsClientId: "ws-b",
      generation: 1,
    });
  });

  it("claiming from a second client revokes the previous websocket", async () => {
    const request = createMockRequest();
    const revokeAndCloseClient = vi.fn();
    const ctx = createBaseContext({
      broadcaster: {
        broadcast: vi.fn(),
        sendToClient: vi.fn(() => true),
        sendBinaryToClient: vi.fn(() => true),
        getRequestMetadata: vi.fn(() => request),
        revokeAndCloseClient,
      } as unknown as Broadcaster,
    });

    await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000003",
        op: "activation.claim",
        args: { clientInstanceId: "client-a" },
      },
      ctx,
      "ws-a"
    );

    await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000004",
        op: "activation.claim",
        args: { clientInstanceId: "client-b" },
      },
      ctx,
      "ws-b"
    );

    expect(revokeAndCloseClient).toHaveBeenCalledWith("ws-a", 2);
  });

  it("does not block direct internal dispatches without websocket request metadata", async () => {
    const ctx = createBaseContext();

    const result = await dispatch(
      {
        kind: "command",
        id: "00000000-0000-4000-8000-000000000003",
        op: "workspace.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([{ id: "workspace-1" }]);
  });
});

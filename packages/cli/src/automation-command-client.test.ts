import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getServerStatus, getBrowserUrl } = vi.hoisted(() => ({
  getServerStatus: vi.fn(),
  getBrowserUrl: vi.fn(),
}));

const { MockWebSocket, socketInstances } = vi.hoisted(() => {
  const socketInstances: Array<{
    url: string;
    options?: { headers?: Record<string, string> };
    handlers: Map<string, Array<(...args: any[]) => void>>;
    send: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    emit: (event: string, ...args: any[]) => void;
  }> = [];

  class MockWebSocket {
    static readonly OPEN = 1;

    readonly handlers = new Map<string, Array<(...args: any[]) => void>>();
    readonly send = vi.fn();
    readonly close = vi.fn();

    constructor(
      public readonly url: string,
      public readonly options?: { headers?: Record<string, string> }
    ) {
      socketInstances.push(this);
      queueMicrotask(() => this.emit("open"));
    }

    on(event: string, handler: (...args: any[]) => void): void {
      const handlers = this.handlers.get(event) ?? [];
      handlers.push(handler);
      this.handlers.set(event, handlers);
    }

    emit(event: string, ...args: any[]): void {
      for (const handler of this.handlers.get(event) ?? []) {
        handler(...args);
      }
    }
  }

  return { MockWebSocket, socketInstances };
});

vi.mock("./server-control.js", () => ({
  getServerStatus,
}));

vi.mock("./server-url.js", () => ({
  getBrowserUrl,
}));

vi.mock("ws", () => ({
  default: MockWebSocket,
}));

import { callCoderStudioCommand } from "./automation-command-client.js";
import { callCoderStudioWsCommand } from "./automation-ws-client.js";

describe("automation command client", () => {
  beforeEach(() => {
    socketInstances.length = 0;
    vi.stubEnv("CODER_STUDIO_API_URL", "");
    vi.stubEnv("CODER_STUDIO_SESSION_TOKEN", "");
    getServerStatus.mockResolvedValue({
      status: "running",
      pid: 1,
      host: "127.0.0.1",
      port: 4173,
      restartCount: 0,
      outFile: "/tmp/server.out.log",
      errFile: "/tmp/server.err.log",
      startedAt: 1,
    });
    getBrowserUrl.mockReturnValue("http://127.0.0.1:4173");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("sends a bearer authorization header when a session token is present", async () => {
    vi.stubEnv("CODER_STUDIO_SESSION_TOKEN", "session-token-123");

    const pending = callCoderStudioCommand({
      op: "git.status",
      args: { workspaceId: "ws-1" },
    });

    await vi.waitFor(() => {
      expect(socketInstances).toHaveLength(1);
    });

    const socket = socketInstances[0]!;
    expect(socket?.url).toBe("ws://127.0.0.1:4173/ws");
    expect(socket?.options).toEqual({
      headers: {
        Authorization: "Bearer session-token-123",
      },
    });

    await vi.waitFor(() => {
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    const sentPayload = JSON.parse(socket.send.mock.calls[0]?.[0] as string) as {
      id: string;
    };
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          kind: "result",
          id: sentPayload.id,
          ok: true,
          data: { branch: "main" },
        })
      )
    );

    await expect(pending).resolves.toEqual({ branch: "main" });
  });

  it("opens the websocket without authorization headers when no session token is present", async () => {
    const pending = callCoderStudioCommand({
      op: "workspace.list",
      args: {},
    });

    await vi.waitFor(() => {
      expect(socketInstances).toHaveLength(1);
    });

    const socket = socketInstances[0]!;
    expect(socket?.options).toBeUndefined();

    await vi.waitFor(() => {
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    const sentPayload = JSON.parse(socket.send.mock.calls[0]?.[0] as string) as {
      id: string;
    };
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          kind: "result",
          id: sentPayload.id,
          ok: true,
          data: [],
        })
      )
    );

    await expect(pending).resolves.toEqual([]);
  });

  it("merges explicit websocket headers with session bearer auth", async () => {
    vi.stubEnv("CODER_STUDIO_SESSION_TOKEN", "session-token-123");

    const pending = callCoderStudioWsCommand({
      apiUrl: "http://127.0.0.1:4173",
      op: "updates.prepareInstall",
      args: {},
      headers: {
        Cookie: "coder_studio_auth=session-cookie",
      },
    });

    await vi.waitFor(() => {
      expect(socketInstances).toHaveLength(1);
    });

    const socket = socketInstances[0]!;
    expect(socket.options).toEqual({
      headers: {
        Cookie: "coder_studio_auth=session-cookie",
        Authorization: "Bearer session-token-123",
      },
    });

    await vi.waitFor(() => {
      expect(socket.send).toHaveBeenCalledTimes(1);
    });

    const sentPayload = JSON.parse(socket.send.mock.calls[0]?.[0] as string) as {
      id: string;
    };
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          kind: "result",
          id: sentPayload.id,
          ok: true,
          data: { hasActiveWork: false },
        })
      )
    );

    await expect(pending).resolves.toEqual({ hasActiveWork: false });
  });

  it("rejects session-scoped calls when CODER_STUDIO_API_URL is unavailable without falling back to managed-server discovery", async () => {
    vi.stubEnv("CODER_STUDIO_API_URL", "");
    getServerStatus.mockClear();
    getBrowserUrl.mockClear();

    await expect(
      callCoderStudioCommand({
        op: "workspace.list",
        args: {},
        resolveStrategy: "session",
      })
    ).rejects.toThrow(/CODER_STUDIO_API_URL/);

    expect(getServerStatus).not.toHaveBeenCalled();
    expect(getBrowserUrl).not.toHaveBeenCalled();
    expect(socketInstances).toHaveLength(0);
  });
});

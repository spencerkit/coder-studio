/**
 * Tests for WebSocket Hub
 */

import type { Result, ServerToClient, Session, Workspace } from "@coder-studio/core";
import {
  decodeTerminalOutputFrame,
  TERMINAL_BINARY_HEADER_SIZE,
  TERMINAL_BINARY_OUTPUT_VERSION,
  Topics,
} from "@coder-studio/core";
import type { FastifyRequest } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import { EventBus } from "../bus/event-bus.js";
import "../commands/connection.js";
import "../commands/terminal.js";
import { clearPendingTerminalInput } from "../commands/terminal.js";
import type { ServerConfig } from "../config.js";
import type { SessionManager } from "../session/manager.js";
import type { TerminalManager } from "../terminal/manager.js";
import type { WorkspaceManager } from "../workspace/manager.js";
import type { CommandContext } from "../ws/dispatch.js";
import type { FencingManager } from "../ws/fencing.js";
import { WsHub } from "../ws/hub.js";

type MockSocket = {
  readyState: number;
  send: ReturnType<typeof vi.fn>;
  ping: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  bufferedAmount: number;
};

type MessageHandler = ((data: Buffer, isBinary?: boolean) => void) | undefined;
type CloseHandler = (() => void) | undefined;
type PongHandler = (() => void) | undefined;

type ResultMessage = Extract<ServerToClient, { kind: "result" }>;

const TEST_CONFIG: Pick<ServerConfig, "auth" | "appVersion"> = {
  auth: { enabled: false },
  appVersion: "0.3.0",
};

const createMockSocket = (): MockSocket => ({
  readyState: WebSocket.OPEN,
  send: vi.fn(),
  ping: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  bufferedAmount: 0,
});

const createMockRequest = (): FastifyRequest =>
  ({
    ip: "127.0.0.1",
    headers: { "user-agent": "test-agent" },
  }) as unknown as FastifyRequest;

const createCommandContext = (eventBus: EventBus): CommandContext =>
  ({
    workspaceMgr: {},
    sessionMgr: {},
    terminalMgr: {},
    eventBus,
    broadcaster: {},
    db: {},
    providerRegistry: [],
    autoFetch: {
      registerViewer: vi.fn(),
      unregisterViewer: vi.fn(),
    },
    activationMgr: {
      getLease: vi.fn(() => null),
      heartbeat: vi.fn(() => false),
      release: vi.fn(),
      onSocketClosed: vi.fn(),
      claim: vi.fn(),
    },
  }) as unknown as CommandContext;

const createHub = (eventBus: EventBus, commandContext: CommandContext): WsHub =>
  new WsHub({
    eventBus,
    commandContext,
    config: TEST_CONFIG as ServerConfig,
    fencingMgr: {} as FencingManager,
  });

const getMessageHandler = (socket: MockSocket): MessageHandler =>
  socket.on.mock.calls.find((call: unknown[]) => call[0] === "message")?.[1] as
    | MessageHandler
    | undefined;

const getCloseHandler = (socket: MockSocket): CloseHandler =>
  socket.on.mock.calls.find((call: unknown[]) => call[0] === "close")?.[1] as
    | CloseHandler
    | undefined;

const getPongHandler = (socket: MockSocket): PongHandler =>
  socket.on.mock.calls.find((call: unknown[]) => call[0] === "pong")?.[1] as
    | PongHandler
    | undefined;

const subscribeToAllTopics = (socket: MockSocket) => {
  const messageHandler = getMessageHandler(socket);

  messageHandler?.(Buffer.from(JSON.stringify({ kind: "subscribe", topics: ["*"] })));
};

const parseSentEvents = (socket: MockSocket): ServerToClient[] =>
  socket.send.mock.calls
    .filter(([payload]: [string | Buffer]) => typeof payload === "string")
    .map(([payload]: [string]) => JSON.parse(payload) as ServerToClient);

const getLastSentEvent = (socket: MockSocket) => {
  const sentEvents = parseSentEvents(socket);
  return sentEvents[sentEvents.length - 1];
};

const getLastSentBinary = (socket: MockSocket) => {
  const binaryCalls = socket.send.mock.calls.filter(([payload]: [string | Buffer, unknown]) =>
    Buffer.isBuffer(payload)
  );
  return binaryCalls[binaryCalls.length - 1]?.[0] as Buffer | undefined;
};

const findResultMessage = (socket: MockSocket, id: string): ResultMessage | undefined =>
  parseSentEvents(socket).find(
    (message): message is ResultMessage => message.kind === "result" && message.id === id
  );

describe("WsHub", () => {
  let hub: WsHub;
  let eventBus: EventBus;
  let mockCommandContext: CommandContext;

  beforeEach(() => {
    eventBus = new EventBus();
    mockCommandContext = createCommandContext(eventBus);
    hub = createHub(eventBus, mockCommandContext);
  });

  afterEach(() => {
    hub.destroy();
    eventBus.clear();
  });

  it("unregisters autoFetch viewers when a client disconnects", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    const connected = parseSentEvents(socket)[0];
    const clientId = (connected as Extract<ServerToClient, { kind: "event" }>).data
      .clientId as string;
    const closeHandler = getCloseHandler(socket);

    closeHandler?.();

    expect(mockCommandContext.autoFetch.unregisterViewer).toHaveBeenCalledWith(clientId);
  });

  it("sends connection metadata including the CLI version on connect", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    const sentEvents = parseSentEvents(socket);
    expect(sentEvents[0]).toMatchObject({
      kind: "event",
      topic: "connection.status",
      data: expect.objectContaining({
        status: "connected",
        version: "0.3.0",
        serverInstanceId: expect.stringMatching(/^server-\d+$/),
        isWriter: false,
      }),
    });
  });

  it("should accept multiple connections (writer tracking moved to FencingManager)", () => {
    const socket1 = createMockSocket();
    const socket2 = createMockSocket();

    hub.handleConnection(socket1 as never, createMockRequest());
    hub.handleConnection(socket2 as never, createMockRequest());

    expect(socket1.send).toHaveBeenCalledWith(expect.stringContaining("connected"));
    expect(socket2.send).toHaveBeenCalledWith(expect.stringContaining("connected"));

    const send1Calls = socket1.send.mock.calls;
    const send2Calls = socket2.send.mock.calls;
    const clientId1 = JSON.parse(send1Calls[0][0]).data.clientId;
    const clientId2 = JSON.parse(send2Calls[0][0]).data.clientId;
    expect(clientId1).not.toBe(clientId2);
  });

  it("should broadcast to subscribed clients", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    const messageHandler = getMessageHandler(socket);
    messageHandler?.(Buffer.from(JSON.stringify({ kind: "subscribe", topics: ["workspace.*"] })));

    hub.broadcast("workspace.42.meta", { test: "data" });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("workspace.42.meta"));
  });

  it("should not broadcast to unsubscribed clients", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    hub.broadcast("workspace.42.meta", { test: "data" });

    expect(socket.send).toHaveBeenCalledTimes(1);
  });

  it("should handle domain events", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    subscribeToAllTopics(socket);

    eventBus.emit({
      type: "session.state.changed",
      workspaceId: "workspace-42",
      sessionId: "sess-123",
      from: "starting",
      to: "running",
    });

    expect(socket.send).toHaveBeenCalledWith(expect.stringContaining("session.sess-123.state"));
  });

  it("should translate terminal.created events to the terminal created topic and payload", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    subscribeToAllTopics(socket);

    eventBus.emit({
      type: "terminal.created",
      workspaceId: "workspace-42",
      terminalId: "term-123",
      kind: "shell",
      title: "Shell",
      cwd: "/tmp/workspace",
    });

    expect(getLastSentEvent(socket)).toMatchObject({
      kind: "event",
      topic: Topics.terminalCreated("workspace-42", "term-123"),
      data: {
        id: "term-123",
        kind: "shell",
        title: "Shell",
        cwd: "/tmp/workspace",
        workspaceId: "workspace-42",
      },
    });
  });

  it("should translate terminal.output events to a single v2 binary frame", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    subscribeToAllTopics(socket);
    socket.send.mockClear();

    const chunk = Buffer.from("hello terminal");
    eventBus.emit({
      type: "terminal.output",
      workspaceId: "workspace-42",
      terminalId: "term-123",
      chunk,
      seq: 7,
    });

    const sentEvents = parseSentEvents(socket);
    expect(sentEvents).toHaveLength(0);

    const binary = getLastSentBinary(socket);
    expect(binary).toBeDefined();
    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(binary?.[0]).toBe(TERMINAL_BINARY_OUTPUT_VERSION);

    const decoded = decodeTerminalOutputFrame(binary!);
    expect(decoded.topic).toBe(Topics.terminalOutput("workspace-42", "term-123"));
    expect(decoded.seq).toBe(7);
    expect(decoded.streamId).toEqual(expect.any(Number));
    expect(decoded.payload).toEqual(chunk);
    expect(binary?.subarray(TERMINAL_BINARY_HEADER_SIZE + decoded.topic.length)).toEqual(chunk);
  });

  it("routes terminal.output broadcasts through the stream path", () => {
    vi.useFakeTimers();
    try {
      const socket = createMockSocket();
      hub.handleConnection(socket as never, createMockRequest());
      subscribeToAllTopics(socket);
      socket.bufferedAmount = 1024 * 1024;
      socket.send.mockClear();

      eventBus.emit({
        type: "terminal.output",
        workspaceId: "workspace-42",
        terminalId: "term-123",
        chunk: Buffer.from("hi"),
        seq: 1,
      });

      expect(socket.send).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("routes non-terminal-output events through the control path regardless of buffer", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    subscribeToAllTopics(socket);
    socket.bufferedAmount = 8 * 1024 * 1024;
    socket.send.mockClear();

    eventBus.emit({
      type: "session.state.changed",
      workspaceId: "workspace-42",
      sessionId: "sess-123",
      from: "starting",
      to: "running",
    });

    expect(socket.send).toHaveBeenCalledTimes(1);
    expect(socket.send.mock.calls[0]?.[0]).toMatch(/session\.sess-123\.state/);
  });

  it("should translate terminal.exited events to the terminal exit topic and payload", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    subscribeToAllTopics(socket);

    eventBus.emit({
      type: "terminal.exited",
      workspaceId: "workspace-42",
      terminalId: "term-123",
      exitCode: 137,
    });

    expect(getLastSentEvent(socket)).toMatchObject({
      kind: "event",
      topic: Topics.terminalExit("workspace-42", "term-123"),
      data: {
        code: 137,
      },
    });
  });

  it("re-emits current workspace meta and session state on resync for subscribed topics", () => {
    hub.destroy();
    const workspace: Workspace = {
      id: "ws1",
      path: "/tmp/ws1",
      targetRuntime: "native",
      openedAt: 1,
      lastActiveAt: 1,
      uiState: { leftPanelWidth: 320, bottomPanelHeight: 240, focusMode: false },
    };
    const session: Session = {
      id: "s1",
      workspaceId: "ws1",
      terminalId: "term-1",
      providerId: "claude",
      state: "idle",
      capability: "full",
      startedAt: 1,
      lastActiveAt: 1,
    };
    const resyncContext = {
      ...mockCommandContext,
      workspaceMgr: {
        list: vi.fn().mockReturnValue([workspace]),
      } as unknown as WorkspaceManager,
      sessionMgr: {
        getForWorkspace: vi.fn().mockReturnValue([session]),
      } as unknown as SessionManager,
    } as CommandContext;
    hub = createHub(eventBus, resyncContext);

    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    const messageHandler = getMessageHandler(socket);
    socket.send.mockClear();

    messageHandler?.(
      Buffer.from(
        JSON.stringify({
          kind: "subscribe",
          topics: ["workspace.ws1.meta", "workspace.ws1.session.s1.state"],
        })
      )
    );
    messageHandler?.(
      Buffer.from(
        JSON.stringify({
          kind: "resync",
          lastSeen: {
            "workspace.ws1.meta": 3,
            "workspace.ws1.session.s1.state": 4,
          },
        })
      )
    );

    const sentEvents = parseSentEvents(socket);
    expect(sentEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "event", topic: "workspace.ws1.meta", data: workspace }),
        expect.objectContaining({
          kind: "event",
          topic: "workspace.ws1.session.s1.state",
          data: session,
        }),
        expect.objectContaining({
          kind: "event",
          topic: "connection.status",
          data: {
            status: "resynced",
            topics: ["workspace.ws1.meta", "workspace.ws1.session.s1.state"],
          },
        }),
      ])
    );
  });

  it("should close all connections on destroy", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    hub.destroy();

    expect(socket.close).toHaveBeenCalled();
  });

  it("should ping all clients", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    hub.pingAll();

    expect(socket.ping).toHaveBeenCalled();
  });

  it("handles connection.probe commands", async () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    const messageHandler = getMessageHandler(socket);
    socket.send.mockClear();

    messageHandler?.(
      Buffer.from(
        JSON.stringify({
          kind: "command",
          id: "00000000-0000-4000-8000-000000000001",
          op: "connection.probe",
          args: {},
        })
      )
    );

    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    expect(findResultMessage(socket, "00000000-0000-4000-8000-000000000001")).toMatchObject({
      ok: true,
      data: {
        ok: true,
      },
    });
  });

  it("closes clients that stay unresponsive across keepalive sweeps", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    hub.pingAll();
    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.close).not.toHaveBeenCalled();

    hub.pingAll();
    expect(socket.close).toHaveBeenCalledTimes(1);
  });

  it("does not close clients that answer the previous keepalive ping", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    const pongHandler = getPongHandler(socket);

    hub.pingAll();
    pongHandler?.();
    hub.pingAll();

    expect(socket.ping).toHaveBeenCalledTimes(2);
    expect(socket.close).not.toHaveBeenCalled();
  });

  it("treats inbound commands as proof of life before the next keepalive sweep", async () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    const messageHandler = getMessageHandler(socket);

    hub.pingAll();

    messageHandler?.(
      Buffer.from(
        JSON.stringify({
          kind: "command",
          id: "00000000-0000-4000-8000-000000000002",
          op: "connection.probe",
          args: {},
        })
      )
    );

    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));

    hub.pingAll();

    expect(socket.close).not.toHaveBeenCalled();
    expect(socket.ping).toHaveBeenCalledTimes(2);
  });

  it("should return null for writer (deprecated - use FencingManager)", () => {
    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());

    expect(hub.getWriter()).toBeNull();
  });

  it("should return null for writer when no connections", () => {
    expect(hub.getWriter()).toBeNull();
  });

  it("defers terminal.input dispatch until the matching binary frame arrives", async () => {
    hub.destroy();
    const write = vi.fn();
    const findSessionIdByTerminal = vi.fn().mockReturnValue(null);
    const inputContext = {
      ...mockCommandContext,
      terminalMgr: { write } as unknown as TerminalManager,
      sessionMgr: { findSessionIdByTerminal } as unknown as SessionManager,
    } as CommandContext;
    hub = createHub(eventBus, inputContext);

    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    const messageHandler = getMessageHandler(socket);
    socket.send.mockClear();

    const streamId = 1_000_001;
    const jsonCommand = Buffer.from(
      JSON.stringify({
        kind: "command",
        id: "cmd-input-1",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          transport: "binary",
          streamId,
          size: 5,
          activity: "typing",
        },
      })
    );

    messageHandler?.(jsonCommand, false);

    await Promise.resolve();
    await Promise.resolve();
    expect(write).not.toHaveBeenCalled();
    const sentBeforeBinary = socket.send.mock.calls.filter(
      ([payload]: [unknown]) => typeof payload === "string"
    );
    expect(sentBeforeBinary).toHaveLength(0);

    const payload = Buffer.from("hello");
    messageHandler?.(payload, true);
    await new Promise((resolve) => setImmediate(resolve));

    expect(write).toHaveBeenCalledWith("term-1", payload);
    const result = findResultMessage(socket, "cmd-input-1");
    expect(result?.ok).toBe(true);
  });

  it("clears buffered binary terminal.input payloads when validation fails", async () => {
    hub.destroy();
    const invalidInputContext = {
      ...mockCommandContext,
      terminalMgr: { write: vi.fn() } as unknown as TerminalManager,
      sessionMgr: {
        findSessionIdByTerminal: vi.fn().mockReturnValue(null),
      } as unknown as SessionManager,
    } as CommandContext;
    hub = createHub(eventBus, invalidInputContext);

    const socket = createMockSocket();
    hub.handleConnection(socket as never, createMockRequest());
    const messageHandler = getMessageHandler(socket);
    socket.send.mockClear();

    const streamId = 1_000_002;
    const jsonCommand = Buffer.from(
      JSON.stringify({
        kind: "command",
        id: "cmd-input-invalid-1",
        op: "terminal.input",
        args: {
          terminalId: "term-1",
          transport: "binary",
          streamId,
          size: 5,
          activity: "definitely_invalid",
        },
      })
    );

    messageHandler?.(jsonCommand, false);
    await Promise.resolve();
    await Promise.resolve();

    messageHandler?.(Buffer.from("hello"), true);
    await new Promise((resolve) => setImmediate(resolve));

    const result = findResultMessage(socket, "cmd-input-invalid-1");

    expect(result?.ok).toBe(false);
    expect(result?.error?.code).toBe("validation_error");

    clearPendingTerminalInput(streamId);
  });
});

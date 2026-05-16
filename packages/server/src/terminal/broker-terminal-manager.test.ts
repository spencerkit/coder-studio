import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { BrokerTerminalManager } from "./broker-terminal-manager.js";
import type { RuntimeTerminalRecord, TerminalDatabase } from "./types.js";

describe("BrokerTerminalManager", () => {
  const runtimeRecord: RuntimeTerminalRecord = {
    id: "term-1",
    workspaceId: "ws-1",
    kind: "shell",
    title: "bash",
    cwd: "/tmp",
    argv: ["bash"],
    cols: 120,
    rows: 30,
    alive: true,
    createdAt: 1000,
    ownerServerInstanceId: "server-a",
    leaseStatus: "attached",
    lastOutputAt: null,
  };

  let db: TerminalDatabase;

  beforeEach(() => {
    db = {
      insert: vi.fn(),
      markEnded: vi.fn(),
    };
  });

  it("returns the tail across multiple output chunks", async () => {
    let onEvent:
      | ((event: {
          type: "output" | "exit";
          terminalId: string;
          workspaceId: string;
          seq?: number;
          chunkBase64?: string;
          lastOutputAt?: number | null;
          exitCode?: number;
          ownerServerInstanceId?: string;
        }) => void)
      | undefined;

    const broker = {
      subscribeOutput: vi.fn().mockImplementation(async (_owner, handler) => {
        onEvent = handler;
        return async () => undefined;
      }),
      create: vi.fn(),
      hydrateAttached: vi.fn().mockResolvedValue([runtimeRecord]),
      claimPreserved: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(),
      replay: vi.fn(),
      snapshot: vi.fn(),
      recovery: vi.fn(),
      detachForRestart: vi.fn(),
      closeAllForOwner: vi.fn(),
    };

    const manager = new BrokerTerminalManager({
      broker,
      eventBus: new EventBus(),
      db,
      ownerServerInstanceId: "server-a",
    });

    await manager.connect();
    await manager.hydrateOwned();

    onEvent?.({
      type: "output",
      ownerServerInstanceId: "server-a",
      terminalId: "term-1",
      workspaceId: "ws-1",
      seq: 3,
      chunkBase64: Buffer.from("abc").toString("base64"),
      lastOutputAt: 1001,
    });
    onEvent?.({
      type: "output",
      ownerServerInstanceId: "server-a",
      terminalId: "term-1",
      workspaceId: "ws-1",
      seq: 6,
      chunkBase64: Buffer.from("def").toString("base64"),
      lastOutputAt: 1002,
    });

    expect(manager.getRingBufferTail("term-1", 4).toString("utf8")).toBe("cdef");
  });
});

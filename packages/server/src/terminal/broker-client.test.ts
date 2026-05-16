import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { TerminalBrokerClient } from "./broker-client.js";
import { startTerminalBrokerServer } from "./broker-server.js";
import type { PtyHost, PtyProcess } from "./types.js";

describe("TerminalBrokerClient", () => {
  let dir: string;
  let socketPath: string;
  let broker: Awaited<ReturnType<typeof startTerminalBrokerServer>>;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cs-broker-"));
    socketPath = join(dir, "terminal-broker.sock");

    const mockPty: PtyProcess = {
      onData: vi.fn(),
      onExit: vi.fn(),
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn().mockResolvedValue(undefined),
    };
    const ptyHost: PtyHost = {
      spawn: vi.fn().mockReturnValue(mockPty),
    };

    broker = await startTerminalBrokerServer({
      endpoint: socketPath,
      eventBus: new EventBus(),
      ptyHost,
    });
  });

  afterEach(async () => {
    await broker.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates, detaches, and claims a shell terminal across owners", async () => {
    const client = new TerminalBrokerClient({ endpoint: socketPath });

    await client.create(
      "term-1",
      {
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["bash"],
        cwd: "/tmp",
      },
      "server-a"
    );

    await client.detachForRestart("server-a", "restart-1", 5_000);
    const claimed = await client.claimPreserved("restart-1", "server-b");

    expect(claimed.map((terminal) => terminal.id)).toEqual(["term-1"]);
  });

  it("kills attached terminals when the owner output subscription disconnects", async () => {
    const client = new TerminalBrokerClient({ endpoint: socketPath });

    await client.create(
      "term-1",
      {
        workspaceId: "ws-1",
        kind: "shell",
        argv: ["bash"],
        cwd: "/tmp",
      },
      "server-a"
    );

    const unsubscribe = await client.subscribeOutput("server-a", () => undefined);
    expect(await client.hydrateAttached("server-a")).toHaveLength(1);

    await unsubscribe();

    expect(await client.hydrateAttached("server-a")).toEqual([]);
  });
});

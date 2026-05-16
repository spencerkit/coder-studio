import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTerminalBrokerRuntime } from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { TerminalBrokerClient } from "./broker-client.js";
import { startTerminalBrokerServer } from "./broker-server.js";
import type { PtyHost, PtyProcess } from "./types.js";

describe("TerminalBrokerClient", () => {
  const originalRuntimeDir = process.env.CODER_STUDIO_RUNTIME_DIR;
  let dir: string;
  let socketPath: string;
  let broker: Awaited<ReturnType<typeof startTerminalBrokerServer>> | undefined;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "cs-broker-"));
    socketPath = join(dir, "terminal-broker.sock");
    process.env.CODER_STUDIO_RUNTIME_DIR = dir;

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
    await broker?.close().catch(() => undefined);
    broker = undefined;

    if (originalRuntimeDir === undefined) {
      delete process.env.CODER_STUDIO_RUNTIME_DIR;
    } else {
      process.env.CODER_STUDIO_RUNTIME_DIR = originalRuntimeDir;
    }

    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
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
    await expect(client.status()).resolves.toEqual({
      pid: expect.any(Number),
      startedAt: expect.any(Number),
    });
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

  it("logs broker request failures when restart trace is enabled", async () => {
    vi.stubEnv("CODER_STUDIO_RESTART_TRACE", "1");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await broker?.close();
    broker = undefined;

    const client = new TerminalBrokerClient({ endpoint: socketPath });
    await expect(client.ping()).rejects.toMatchObject({
      code: "ENOENT",
    });

    expect(warnSpy).toHaveBeenCalledWith("[restart-trace] terminal_broker.request_failed", {
      op: "ping",
      endpoint: socketPath,
      message: expect.stringContaining("ENOENT"),
      code: "ENOENT",
    });
  });

  it("does not remove a newer broker runtime when an older broker closes", async () => {
    const olderBrokerRuntime = readTerminalBrokerRuntime();
    expect(olderBrokerRuntime).not.toBeNull();

    rmSync(socketPath, { force: true });
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue((olderBrokerRuntime?.startedAt ?? 0) + 1);
    const newerBroker = await startTerminalBrokerServer({
      endpoint: socketPath,
      eventBus: new EventBus(),
      ptyHost: {
        spawn: vi.fn().mockReturnValue({
          onData: vi.fn(),
          onExit: vi.fn(),
          write: vi.fn(),
          resize: vi.fn(),
          kill: vi.fn().mockResolvedValue(undefined),
        }),
      },
    });
    dateNowSpy.mockRestore();
    const newerBrokerRuntime = readTerminalBrokerRuntime();

    await broker?.close();
    broker = newerBroker;

    expect(readTerminalBrokerRuntime()).toEqual(newerBrokerRuntime);
  });
});

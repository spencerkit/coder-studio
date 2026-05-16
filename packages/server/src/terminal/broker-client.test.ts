import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getTerminalBrokerRuntimePath,
  readTerminalBrokerRuntime,
} from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { TerminalBrokerClient } from "./broker-client.js";
import { startTerminalBrokerServer } from "./broker-server.js";
import type { PtyHost, PtyProcess } from "./types.js";

describe("TerminalBrokerClient", () => {
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
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    delete process.env.CODER_STUDIO_RUNTIME_DIR;
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

  it("reports broker status for runtime recovery", async () => {
    const client = new TerminalBrokerClient({ endpoint: socketPath });

    const brokerStatus = await client.status();
    const runtime = readTerminalBrokerRuntime();

    expect(runtime).not.toBeNull();
    expect(brokerStatus).toEqual({
      pid: runtime!.pid,
      startedAt: runtime!.startedAt,
    });
  });

  it("preserves the replacement broker runtime artifacts when the old broker closes", async () => {
    const firstBroker = broker!;
    await new Promise((resolve) => setTimeout(resolve, 5));
    const secondBroker = await startTerminalBrokerServer({
      endpoint: socketPath,
      eventBus: new EventBus(),
    });
    broker = secondBroker;

    const replacementRuntime = readTerminalBrokerRuntime();
    expect(replacementRuntime).not.toBeNull();

    await firstBroker.close();

    expect(readTerminalBrokerRuntime()).toEqual(replacementRuntime);
    expect(
      JSON.parse(readFileSync(getTerminalBrokerRuntimePath(), "utf8")) as {
        endpoint: string;
        pid: number;
        startedAt: number;
      }
    ).toEqual(replacementRuntime);
  });
});

import { getTerminalBrokerSocketPath } from "@coder-studio/core/runtime";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../bus/event-bus.js";
import { createServer, type Server } from "../server.js";
import { startTerminalBrokerServer } from "../terminal/broker-server.js";
import { dispatch } from "../ws/dispatch.js";

import "../commands/workspace.js";
import "../commands/terminal.js";

describe("managed restart shell preservation", () => {
  let broker: Awaited<ReturnType<typeof startTerminalBrokerServer>> | undefined;
  let first: Server | undefined;
  let second: Server | undefined;

  beforeEach(async () => {
    broker = await startTerminalBrokerServer({
      endpoint: getTerminalBrokerSocketPath(),
      eventBus: new EventBus(),
    });
  });

  afterEach(async () => {
    await first?.stop();
    await second?.stop();
    await broker?.close();
    first = undefined;
    second = undefined;
    broker = undefined;
  });

  it("preserves a shell terminal across explicit restart and keeps stop destructive", async () => {
    first = await createServer({
      host: "127.0.0.1",
      port: 0,
      writeRuntimeConfig: false,
      serverInstanceId: "server-a",
      terminalBrokerEndpoint: getTerminalBrokerSocketPath(),
    });

    const firstCtx = first.__test__!.commandContext;
    const open = await dispatch(
      {
        kind: "command",
        id: "open",
        op: "workspace.open",
        args: { path: process.cwd() },
      },
      firstCtx
    );
    expect(open.ok).toBe(true);
    const workspaceId = open.data!.id;

    const created = await dispatch(
      {
        kind: "command",
        id: "term-create",
        op: "terminal.create",
        args: { workspaceId },
      },
      firstCtx
    );
    expect(created.ok).toBe(true);
    const terminalId = created.data!.id;

    await first.stop({
      mode: "restart-preserve",
      requestId: "restart-1",
      ttlMs: 5_000,
    });
    first = undefined;

    second = await createServer({
      host: "127.0.0.1",
      port: 0,
      writeRuntimeConfig: false,
      serverInstanceId: "server-b",
      terminalBrokerEndpoint: getTerminalBrokerSocketPath(),
      restartClaimRequestId: "restart-1",
    });

    const list = await dispatch(
      {
        kind: "command",
        id: "term-list",
        op: "terminal.list",
        args: { workspaceId },
      },
      second.__test__!.commandContext
    );

    expect(list.ok).toBe(true);
    expect(list.data).toEqual([
      expect.objectContaining({
        id: terminalId,
        workspaceId,
        alive: true,
      }),
    ]);
  });
});

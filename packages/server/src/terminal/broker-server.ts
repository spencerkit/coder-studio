import { existsSync, rmSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import type { DomainEvent } from "@coder-studio/core";
import {
  deleteTerminalBrokerRuntime,
  writeTerminalBrokerRuntime,
} from "@coder-studio/core/runtime";
import type { EventBus } from "../bus/event-bus.js";
import type { BrokerEvent, BrokerRequest, BrokerResponse } from "./broker-protocol.js";
import { NodePtyHost } from "./pty-host.js";
import { TerminalRuntime } from "./runtime.js";
import type { PtyHost } from "./types.js";

type TerminalOutputEvent = Extract<DomainEvent, { type: "terminal.output" }>;
type TerminalExitedEvent = Extract<DomainEvent, { type: "terminal.exited" }>;

function removeSocketFromSubscribers(subscribers: Map<string, Set<Socket>>, socket: Socket): void {
  for (const [ownerServerInstanceId, ownerSubscribers] of subscribers.entries()) {
    ownerSubscribers.delete(socket);
    if (ownerSubscribers.size === 0) {
      subscribers.delete(ownerServerInstanceId);
    }
  }
}

function toBrokerError(id: string, error: unknown): BrokerResponse {
  return {
    id,
    ok: false,
    code: "broker_request_failed",
    message: error instanceof Error ? error.message : String(error),
  };
}

export async function startTerminalBrokerServer(opts: {
  endpoint: string;
  eventBus: EventBus;
  ptyHost?: PtyHost;
}): Promise<{ close: () => Promise<void> }> {
  const runtime = new TerminalRuntime({
    ptyHost: opts.ptyHost ?? new NodePtyHost(),
    eventBus: opts.eventBus,
    db: {
      insert: () => undefined,
      markEnded: () => undefined,
    },
  });
  const subscribers = new Map<string, Set<Socket>>();

  if (process.platform !== "win32" && existsSync(opts.endpoint)) {
    rmSync(opts.endpoint, { force: true });
  }

  const server = createServer((socket) => {
    let buffer = "";
    let subscribedOwnerServerInstanceId: string | null = null;
    let ownerDisconnectHandled = false;
    socket.setEncoding("utf8");

    const cleanup = async (awaitOwnerDisconnect = false) => {
      removeSocketFromSubscribers(subscribers, socket);

      if (subscribedOwnerServerInstanceId === null || ownerDisconnectHandled) {
        return;
      }

      ownerDisconnectHandled = true;
      const ownerServerInstanceId = subscribedOwnerServerInstanceId;
      if (awaitOwnerDisconnect) {
        await runtime.handleOwnerDisconnect(ownerServerInstanceId);
        return;
      }

      void runtime.handleOwnerDisconnect(ownerServerInstanceId).catch(() => undefined);
    };
    socket.on("end", () => {
      void cleanup();
      if (!socket.writableEnded) {
        socket.end();
      }
    });
    socket.on("close", () => {
      void cleanup();
    });
    socket.on("error", () => {
      void cleanup();
    });

    socket.on("data", async (chunk) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) {
          continue;
        }

        let request: BrokerRequest | null = null;
        try {
          request = JSON.parse(line) as BrokerRequest;

          if (request.op === "unsubscribe_output") {
            if (request.ownerServerInstanceId !== subscribedOwnerServerInstanceId) {
              throw new Error("Output subscription owner mismatch");
            }

            await cleanup(true);
            subscribedOwnerServerInstanceId = null;
            socket.end(
              `${JSON.stringify({ id: request.id, ok: true } satisfies BrokerResponse)}\n`
            );
            continue;
          }

          const response = await handleBrokerRequest(runtime, request);
          socket.write(`${JSON.stringify(response)}\n`);

          if (request.op === "subscribe_output") {
            const ownerSubscribers =
              subscribers.get(request.ownerServerInstanceId) ?? new Set<Socket>();
            ownerSubscribers.add(socket);
            subscribers.set(request.ownerServerInstanceId, ownerSubscribers);
            subscribedOwnerServerInstanceId = request.ownerServerInstanceId;
          }
        } catch (error) {
          const response = toBrokerError(request?.id ?? "unknown", error);
          socket.write(`${JSON.stringify(response)}\n`);
        }
      }
    });
  });

  opts.eventBus.on("terminal.output", (event: TerminalOutputEvent) => {
    const ownerServerInstanceId = runtime.getOwnerServerInstanceId(event.terminalId);
    if (!ownerServerInstanceId) {
      return;
    }

    const message: BrokerEvent = {
      type: "output",
      ownerServerInstanceId,
      terminalId: event.terminalId,
      workspaceId: event.workspaceId,
      seq: event.seq,
      chunkBase64: event.chunk.toString("base64"),
      lastOutputAt: runtime.getRecoveryMetadata(event.terminalId)?.lastOutputAt ?? null,
    };

    for (const socket of subscribers.get(ownerServerInstanceId) ?? []) {
      socket.write(`${JSON.stringify(message)}\n`);
    }
  });

  opts.eventBus.on("terminal.exited", (event: TerminalExitedEvent) => {
    const ownerServerInstanceId = runtime.getOwnerServerInstanceId(event.terminalId);
    if (!ownerServerInstanceId) {
      return;
    }

    const message: BrokerEvent = {
      type: "exit",
      ownerServerInstanceId,
      terminalId: event.terminalId,
      workspaceId: event.workspaceId,
      exitCode: event.exitCode,
    };

    for (const socket of subscribers.get(ownerServerInstanceId) ?? []) {
      socket.write(`${JSON.stringify(message)}\n`);
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.endpoint, () => {
      server.off("error", reject);
      resolve();
    });
  });

  writeTerminalBrokerRuntime({
    endpoint: opts.endpoint,
    pid: process.pid,
    startedAt: Date.now(),
  });

  return {
    close: async () => {
      deleteTerminalBrokerRuntime();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });

      if (process.platform !== "win32" && existsSync(opts.endpoint)) {
        rmSync(opts.endpoint, { force: true });
      }
    },
  };
}

async function handleBrokerRequest(
  runtime: TerminalRuntime,
  request: BrokerRequest
): Promise<BrokerResponse> {
  switch (request.op) {
    case "create": {
      runtime.create(request.terminalId, request.spec, request.ownerServerInstanceId);
      return {
        id: request.id,
        ok: true,
        terminal: runtime.get(request.terminalId),
      };
    }
    case "detach_for_restart":
      runtime.detachForRestart(request.ownerServerInstanceId, request.requestId, request.ttlMs);
      return { id: request.id, ok: true };
    case "claim_preserved":
      return {
        id: request.id,
        ok: true,
        terminals: runtime.claimPreserved(request.requestId, request.ownerServerInstanceId),
      };
    case "hydrate_attached":
      return {
        id: request.id,
        ok: true,
        terminals: runtime.hydrateAttached(request.ownerServerInstanceId),
      };
    case "subscribe_output":
      return { id: request.id, ok: true };
    case "unsubscribe_output":
      return { id: request.id, ok: true };
    case "close_all_for_owner":
      await runtime.handleOwnerDisconnect(request.ownerServerInstanceId);
      return { id: request.id, ok: true };
    case "write":
      runtime.write(request.terminalId, Buffer.from(request.bytesBase64, "base64"));
      return { id: request.id, ok: true };
    case "resize":
      runtime.resize(request.terminalId, request.cols, request.rows);
      return { id: request.id, ok: true };
    case "close":
      await runtime.close(request.terminalId);
      return { id: request.id, ok: true };
    case "replay": {
      const replay = runtime.replay(request.terminalId, request.lastSeq);
      return replay.status === "ok"
        ? {
            id: request.id,
            ok: true,
            replay: {
              status: "ok",
              seq: replay.seq,
              dataBase64: replay.data.toString("base64"),
            },
          }
        : { id: request.id, ok: true, replay };
    }
    case "snapshot": {
      const snapshot = await runtime.snapshot(request.terminalId);
      return snapshot.status === "ok"
        ? {
            id: request.id,
            ok: true,
            snapshot: {
              status: "ok",
              seq: snapshot.seq,
              cols: snapshot.cols,
              rows: snapshot.rows,
              dataBase64: snapshot.data.toString("base64"),
            },
          }
        : { id: request.id, ok: true, snapshot };
    }
    case "recovery":
      return {
        id: request.id,
        ok: true,
        recovery: runtime.getRecoveryMetadata(request.terminalId),
      };
    case "ping":
      return { id: request.id, ok: true };
  }
}

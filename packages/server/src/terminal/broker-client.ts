import { randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import type {
  BrokerEvent,
  BrokerReplayResult,
  BrokerRequest,
  BrokerResponse,
  BrokerSnapshotResult,
} from "./broker-protocol.js";
import type { RuntimeTerminalRecord, TerminalRecoveryMetadata, TerminalSpec } from "./types.js";

export class TerminalBrokerClient {
  constructor(private readonly options: { endpoint: string }) {}

  async create(
    terminalId: string,
    spec: TerminalSpec,
    ownerServerInstanceId: string
  ): Promise<RuntimeTerminalRecord | undefined> {
    const result = await this.request({
      id: randomUUID(),
      op: "create",
      terminalId,
      spec,
      ownerServerInstanceId,
    });
    return result.terminal;
  }

  async detachForRestart(
    ownerServerInstanceId: string,
    requestId: string,
    ttlMs: number
  ): Promise<void> {
    await this.request({
      id: randomUUID(),
      op: "detach_for_restart",
      ownerServerInstanceId,
      requestId,
      ttlMs,
    });
  }

  async claimPreserved(
    requestId: string,
    ownerServerInstanceId: string
  ): Promise<RuntimeTerminalRecord[]> {
    const result = await this.request({
      id: randomUUID(),
      op: "claim_preserved",
      requestId,
      ownerServerInstanceId,
    });
    return result.terminals ?? [];
  }

  async hydrateAttached(ownerServerInstanceId: string): Promise<RuntimeTerminalRecord[]> {
    const result = await this.request({
      id: randomUUID(),
      op: "hydrate_attached",
      ownerServerInstanceId,
    });
    return result.terminals ?? [];
  }

  async closeAllForOwner(ownerServerInstanceId: string): Promise<void> {
    await this.request({
      id: randomUUID(),
      op: "close_all_for_owner",
      ownerServerInstanceId,
    });
  }

  async write(terminalId: string, bytesBase64: string): Promise<void> {
    await this.request({
      id: randomUUID(),
      op: "write",
      terminalId,
      bytesBase64,
    });
  }

  async resize(terminalId: string, cols: number, rows: number): Promise<void> {
    await this.request({
      id: randomUUID(),
      op: "resize",
      terminalId,
      cols,
      rows,
    });
  }

  async close(terminalId: string): Promise<void> {
    await this.request({
      id: randomUUID(),
      op: "close",
      terminalId,
    });
  }

  async replay(terminalId: string, lastSeq: number): Promise<BrokerReplayResult> {
    const result = await this.request({
      id: randomUUID(),
      op: "replay",
      terminalId,
      lastSeq,
    });
    return result.replay ?? { status: "unknown" };
  }

  async snapshot(terminalId: string): Promise<BrokerSnapshotResult> {
    const result = await this.request({
      id: randomUUID(),
      op: "snapshot",
      terminalId,
    });
    return result.snapshot ?? { status: "unsupported" };
  }

  async recovery(terminalId: string): Promise<TerminalRecoveryMetadata | null> {
    const result = await this.request({
      id: randomUUID(),
      op: "recovery",
      terminalId,
    });
    return result.recovery ?? null;
  }

  async ping(): Promise<boolean> {
    await this.request({
      id: randomUUID(),
      op: "ping",
    });
    return true;
  }

  async subscribeOutput(
    ownerServerInstanceId: string,
    onEvent: (event: BrokerEvent) => void
  ): Promise<() => Promise<void>> {
    const request: BrokerRequest = {
      id: randomUUID(),
      op: "subscribe_output",
      ownerServerInstanceId,
    };

    return await new Promise<() => Promise<void>>((resolve, reject) => {
      const socket = createConnection(this.options.endpoint);
      let buffer = "";
      let settled = false;
      socket.setEncoding("utf8");

      socket.once("error", (error) => {
        if (!settled) {
          settled = true;
          reject(error);
        }
      });

      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const message = JSON.parse(line) as BrokerResponse | BrokerEvent;
          if ("type" in message) {
            onEvent(message);
            continue;
          }

          if (message.id !== request.id) {
            continue;
          }
          if (!message.ok) {
            settled = true;
            reject(new Error(message.message));
            socket.destroy();
            return;
          }
          if (!settled) {
            settled = true;
            resolve(
              async () =>
                await new Promise<void>((endResolve) => {
                  socket.end(endResolve);
                })
            );
          }
        }
      });

      socket.once("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
    });
  }

  private async request(request: BrokerRequest): Promise<Extract<BrokerResponse, { ok: true }>> {
    return await new Promise<Extract<BrokerResponse, { ok: true }>>((resolve, reject) => {
      const socket = createConnection(this.options.endpoint);
      let buffer = "";
      socket.setEncoding("utf8");

      socket.once("error", reject);
      socket.on("data", (chunk) => {
        buffer += chunk;
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }

          const response = JSON.parse(line) as BrokerResponse;
          if (response.id !== request.id) {
            continue;
          }

          socket.end();
          if (!response.ok) {
            reject(new Error(response.message));
            return;
          }
          resolve(response);
          return;
        }
      });

      socket.once("connect", () => {
        socket.write(`${JSON.stringify(request)}\n`);
      });
    });
  }
}

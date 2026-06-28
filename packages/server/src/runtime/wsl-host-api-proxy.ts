import { createServer, type IncomingMessage } from "node:http";
import type { Result } from "@coder-studio/core";
import WebSocket, { WebSocketServer } from "ws";

export interface RelayHostCommandInput {
  id: string;
  op: string;
  args: unknown;
  sessionToken?: string;
}

export type RelayHostCommand = (input: RelayHostCommandInput) => Promise<Result>;

function getBearerToken(request: IncomingMessage): string | undefined {
  const header = request.headers.authorization;
  if (!header) {
    return undefined;
  }

  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim();
}

function parseCommandMessage(data: WebSocket.RawData): {
  id: string;
  op: string;
  args: unknown;
} | null {
  const text = Buffer.isBuffer(data)
    ? data.toString("utf8")
    : Buffer.from(data as ArrayBuffer).toString("utf8");
  const message = JSON.parse(text) as { kind?: string; id?: string; op?: string; args?: unknown };
  if (
    message.kind !== "command" ||
    typeof message.id !== "string" ||
    typeof message.op !== "string"
  ) {
    return null;
  }

  return {
    id: message.id,
    op: message.op,
    args: message.args,
  };
}

export async function startWslHostApiProxy(input: {
  port: number;
  relay: RelayHostCommand;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = request.url?.split("?", 1)[0];
    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (socket, request) => {
    const sessionToken = getBearerToken(request);

    socket.on("message", (data) => {
      void (async () => {
        let command: ReturnType<typeof parseCommandMessage>;
        try {
          command = parseCommandMessage(data);
        } catch {
          socket.send(
            JSON.stringify({
              kind: "result",
              id: "unknown",
              ok: false,
              error: { code: "invalid_command", message: "Invalid command payload" },
            } satisfies Result)
          );
          return;
        }

        if (!command) {
          return;
        }

        try {
          const result = await input.relay({
            id: command.id,
            op: command.op,
            args: command.args,
            sessionToken,
          });
          socket.send(JSON.stringify(result));
        } catch (error) {
          socket.send(
            JSON.stringify({
              kind: "result",
              id: command.id,
              ok: false,
              error: {
                code: "relay_failed",
                message: error instanceof Error ? error.message : String(error),
              },
            } satisfies Result)
          );
        }
      })();
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(input.port, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine WSL host API proxy address");
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        wss.close(() => {
          server.close((error) => {
            if (error) {
              reject(error);
              return;
            }
            resolve();
          });
        });
      }),
  };
}

import type { Server as NetServer, Socket, TcpNetConnectOpts } from "node:net";
import { createConnection, createServer } from "node:net";
import { createInterface } from "node:readline";
import {
  type JsonRpcErrorMessage,
  type JsonRpcInboundMessage,
  type JsonRpcNotificationMessage,
  type JsonRpcRequestMessage,
  type JsonRpcSuccessMessage,
  normalizeRemoteError,
  toThrowableRemoteError,
} from "./protocol.js";

type HandlerSet = {
  onNotification(method: string, params: unknown): Promise<void> | void;
  onRequest(method: string, params: unknown): Promise<unknown> | unknown;
};

export interface SocketJsonRpcPeer {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateSocketJsonRpcClientInput extends Partial<HandlerSet> {
  host: string;
  port: number;
  runtimeId: string;
}

export interface CreateSocketJsonRpcServerInput extends Partial<HandlerSet> {
  host?: string;
}

interface ConnectedSocketJsonRpcPeer extends SocketJsonRpcPeer {
  socket: Socket;
}

export interface SocketJsonRpcServer {
  host: string;
  port: number;
  acceptOnce(handlers?: Partial<HandlerSet>): Promise<ConnectedSocketJsonRpcPeer>;
  close(): Promise<void>;
}

function isSuccessMessage(message: JsonRpcInboundMessage): message is JsonRpcSuccessMessage {
  return "id" in message && "result" in message;
}

function isErrorMessage(message: JsonRpcInboundMessage): message is JsonRpcErrorMessage {
  return "id" in message && "error" in message;
}

function isRequestMessage(message: JsonRpcInboundMessage): message is JsonRpcRequestMessage {
  return "id" in message && "method" in message;
}

function isNotificationMessage(
  message: JsonRpcInboundMessage
): message is JsonRpcNotificationMessage {
  return !("id" in message) && "method" in message;
}

function writeMessage(socket: Socket, message: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.write(`${JSON.stringify(message)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function bindSocketJsonRpcPeer(
  socket: Socket,
  input: Partial<HandlerSet>,
  label: string
): ConnectedSocketJsonRpcPeer {
  let nextId = 1;
  let disposed = false;
  const pending = new Map<
    number,
    {
      resolve(value: unknown): void;
      reject(error: unknown): void;
    }
  >();

  const readline = createInterface({
    input: socket,
    crlfDelay: Infinity,
  });

  const rejectAll = (error: unknown) => {
    for (const waiter of pending.values()) {
      waiter.reject(error);
    }
    pending.clear();
  };

  const handleRequest = async (message: JsonRpcRequestMessage) => {
    try {
      const result = (await input.onRequest?.(message.method, message.params)) ?? null;
      await writeMessage(socket, {
        jsonrpc: "2.0",
        id: message.id,
        result,
      });
    } catch (error) {
      await writeMessage(socket, {
        jsonrpc: "2.0",
        id: message.id,
        error: normalizeRemoteError(error),
      });
    }
  };

  readline.on("line", (line) => {
    if (!line.trim()) {
      return;
    }

    let parsed: JsonRpcInboundMessage;
    try {
      parsed = JSON.parse(line) as JsonRpcInboundMessage;
    } catch (error) {
      rejectAll(error);
      return;
    }

    if (isSuccessMessage(parsed)) {
      pending.get(parsed.id)?.resolve(parsed.result);
      pending.delete(parsed.id);
      return;
    }

    if (isErrorMessage(parsed)) {
      pending.get(parsed.id)?.reject(toThrowableRemoteError(parsed.error));
      pending.delete(parsed.id);
      return;
    }

    if (isRequestMessage(parsed)) {
      void handleRequest(parsed);
      return;
    }

    if (isNotificationMessage(parsed)) {
      void input.onNotification?.(parsed.method, parsed.params);
    }
  });

  socket.once("close", () => {
    if (!disposed) {
      rejectAll(new Error(`${label} socket closed unexpectedly`));
    }
  });

  socket.once("error", (error) => {
    if (!disposed) {
      rejectAll(error);
    }
  });

  return {
    socket,
    request(method, params) {
      const id = nextId++;
      return new Promise(async (resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          await writeMessage(socket, {
            jsonrpc: "2.0",
            id,
            method,
            params,
          });
        } catch (error) {
          pending.delete(id);
          reject(error);
        }
      });
    },
    async notify(method, params) {
      await writeMessage(socket, {
        jsonrpc: "2.0",
        method,
        params,
      });
    },
    async dispose() {
      disposed = true;
      readline.close();
      rejectAll(new Error(`${label} transport disposed`));
      socket.destroy();
    },
  };
}

function listen(server: NetServer, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
}

export async function createSocketJsonRpcServer(
  input: CreateSocketJsonRpcServerInput = {}
): Promise<SocketJsonRpcServer> {
  const server = createServer();
  const host = input.host ?? "127.0.0.1";
  await listen(server, 0, host);
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unable to determine socket JSON-RPC server address");
  }

  return {
    host: address.address,
    port: address.port,
    acceptOnce(handlers = input) {
      return new Promise((resolve, reject) => {
        const onError = (error: Error) => {
          cleanup();
          reject(error);
        };
        const onConnection = (socket: Socket) => {
          cleanup();
          resolve(bindSocketJsonRpcPeer(socket, handlers, "WSL runtime server"));
        };
        const cleanup = () => {
          server.removeListener("error", onError);
          server.removeListener("connection", onConnection);
        };
        server.once("error", onError);
        server.once("connection", onConnection);
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function connect(options: TcpNetConnectOpts): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(options);
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onConnect = () => {
      cleanup();
      resolve(socket);
    };
    const cleanup = () => {
      socket.removeListener("error", onError);
      socket.removeListener("connect", onConnect);
    };
    socket.once("error", onError);
    socket.once("connect", onConnect);
  });
}

export async function createSocketJsonRpcClient(
  input: CreateSocketJsonRpcClientInput
): Promise<SocketJsonRpcPeer> {
  const socket = await connect({
    host: input.host,
    port: input.port,
  });
  return bindSocketJsonRpcPeer(socket, input, `WSL runtime ${input.runtimeId}`);
}

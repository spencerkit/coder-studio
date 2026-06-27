import type { ChildProcessWithoutNullStreams } from "node:child_process";
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

export interface StdioJsonRpcClient {
  request(method: string, params: unknown): Promise<unknown>;
  notify(method: string, params: unknown): Promise<void>;
  dispose(): Promise<void>;
}

export interface CreateStdioJsonRpcClientInput extends Partial<HandlerSet> {
  child: ChildProcessWithoutNullStreams;
  runtimeId: string;
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

function writeMessage(
  child: ChildProcessWithoutNullStreams,
  message: Record<string, unknown>
): Promise<void> {
  return new Promise((resolve, reject) => {
    const payload = `${JSON.stringify(message)}\n`;
    child.stdin.write(payload, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export async function createStdioJsonRpcClient(
  input: CreateStdioJsonRpcClientInput
): Promise<StdioJsonRpcClient> {
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
    input: input.child.stdout,
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
      await writeMessage(input.child, {
        jsonrpc: "2.0",
        id: message.id,
        result,
      });
    } catch (error) {
      await writeMessage(input.child, {
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

  input.child.stderr.on("data", () => {
    // ignore runtime stderr for transport purposes; caller can inspect process failure separately
  });

  input.child.once("exit", (code, signal) => {
    if (!disposed) {
      rejectAll(
        new Error(
          `WSL runtime ${input.runtimeId} exited unexpectedly (code=${code ?? "null"}, signal=${signal ?? "null"})`
        )
      );
    }
  });
  input.child.once("error", (error) => {
    if (!disposed) {
      rejectAll(error);
    }
  });

  return {
    request(method, params) {
      const id = nextId++;
      return new Promise(async (resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          await writeMessage(input.child, {
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
      await writeMessage(input.child, {
        jsonrpc: "2.0",
        method,
        params,
      });
    },
    async dispose() {
      disposed = true;
      readline.close();
      rejectAll(new Error(`WSL runtime ${input.runtimeId} transport disposed`));
    },
  };
}

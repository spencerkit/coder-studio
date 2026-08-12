import { randomUUID } from "node:crypto";
import type { Result } from "@coder-studio/core";
import WebSocket from "ws";

const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

export interface CoderStudioWsCommandInput {
  apiUrl: string;
  op: string;
  args: unknown;
  timeoutMs?: number;
}

function normalizeApiUrl(apiUrl: string): string {
  return apiUrl.endsWith("/") ? apiUrl.slice(0, -1) : apiUrl;
}

function toWebSocketUrl(apiUrl: string): string {
  const url = new URL(normalizeApiUrl(apiUrl));
  if (url.protocol === "http:") {
    url.protocol = "ws:";
  } else if (url.protocol === "https:") {
    url.protocol = "wss:";
  } else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new Error(`Unsupported Coder Studio API URL protocol: ${url.protocol}`);
  }

  url.pathname = `${url.pathname.replace(/\/$/u, "")}/ws`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function parseResultMessage(data: WebSocket.RawData): Result | null {
  if (Array.isArray(data)) {
    return null;
  }

  const text = Buffer.isBuffer(data)
    ? data.toString("utf8")
    : Buffer.from(data as ArrayBuffer).toString("utf8");
  const message = JSON.parse(text) as { kind?: string };

  if (message.kind !== "result") {
    return null;
  }

  return message as Result;
}

export async function callCoderStudioWsCommand<T = unknown>(
  input: CoderStudioWsCommandInput
): Promise<T> {
  const wsUrl = toWebSocketUrl(input.apiUrl);
  const id = randomUUID();
  const timeoutMs = input.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
  const sessionToken = process.env.CODER_STUDIO_SESSION_TOKEN?.trim();
  const socketOptions =
    sessionToken && sessionToken.length > 0
      ? {
          headers: {
            Authorization: `Bearer ${sessionToken}`,
          },
        }
      : undefined;

  return new Promise<T>((resolve, reject) => {
    const socket = new WebSocket(wsUrl, socketOptions);
    let settled = false;
    const timer = setTimeout(() => {
      finish(() => reject(new Error(`Timed out waiting for ${input.op} result`)));
    }, timeoutMs);

    function finish(callback: () => void): void {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      socket.close();
      callback();
    }

    socket.on("open", () => {
      socket.send(
        JSON.stringify({
          kind: "command",
          id,
          op: input.op,
          args: input.args,
        })
      );
    });

    socket.on("message", (data) => {
      let result: Result | null;
      try {
        result = parseResultMessage(data);
      } catch (error) {
        finish(() => reject(error));
        return;
      }

      if (!result || result.id !== id) {
        return;
      }

      if (result.ok) {
        finish(() => resolve(result.data as T));
        return;
      }

      const code = result.error?.code ? `${result.error.code}: ` : "";
      finish(() => reject(new Error(`${code}${result.error?.message ?? "Command failed"}`)));
    });

    socket.on("error", (error) => {
      finish(() => reject(error));
    });

    socket.on("close", () => {
      if (!settled) {
        finish(() => reject(new Error("Coder Studio command connection closed before a result")));
      }
    });
  });
}

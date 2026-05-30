/**
 * Forwards Volar's `tsserver/request` notifications to a paired TypeScript
 * language server (running `@vue/typescript-plugin`) and relays the response
 * back via `tsserver/response`.
 *
 * Volar 3.x removed its embedded TypeScript service; every semantic operation
 * (hover, definition, quick info, …) is now resolved by sending a
 * `tsserver/request` notification to the LSP client and awaiting a matching
 * `tsserver/response`. The TypeScript Language Server exposes the
 * `typescript.tsserverRequest` workspace command (>= v4.4) that takes a raw
 * tsserver command and arguments and returns the tsserver response body.
 *
 * Volar protocol shapes:
 *   primary -> client (notification):  tsserver/request: [id, command, args]
 *   client -> primary (notification):  tsserver/response: [id, body]
 *
 * Client -> companion translation:
 *   workspace/executeCommand({
 *     command: "typescript.tsserverRequest",
 *     arguments: [command, args],
 *   })
 */

import type { MessageConnection } from "vscode-jsonrpc";

const EXECUTE_COMMAND_METHOD = "workspace/executeCommand";
const TSSERVER_REQUEST_NOTIFICATION = "tsserver/request";
const TSSERVER_RESPONSE_NOTIFICATION = "tsserver/response";
const TSSERVER_BRIDGE_COMMAND = "typescript.tsserverRequest";

export interface TsserverBridgeLogger {
  warn: (...args: unknown[]) => void;
}

export interface BridgeTsserverRequestOptions {
  /** Maximum time to wait for the companion to respond before failing fast. */
  timeoutMs: number;
  logger: TsserverBridgeLogger;
  /** Test seam — defaults to a real `setTimeout`/`clearTimeout` pair. */
  scheduler?: {
    setTimeout: (handler: () => void, ms: number) => unknown;
    clearTimeout: (handle: unknown) => void;
  };
}

export interface BridgeConnections {
  /** Volar (or any LSP server that emits `tsserver/request`). */
  primary: Pick<MessageConnection, "onNotification" | "sendNotification">;
  /** TypeScript Language Server with `@vue/typescript-plugin` loaded. */
  companion: Pick<MessageConnection, "sendRequest">;
}

export interface BridgeHandle {
  /** Stop forwarding new notifications. Already in-flight ones still settle. */
  dispose: () => void;
}

interface ParsedRequest {
  id: number | string;
  command: string;
  args: unknown;
}

function parseRequestPayload(payload: unknown): ParsedRequest | null {
  if (!Array.isArray(payload) || payload.length < 2) {
    return null;
  }
  const [id, command, args] = payload as [unknown, unknown, unknown];
  if ((typeof id !== "number" && typeof id !== "string") || typeof command !== "string") {
    return null;
  }
  return { id, command, args };
}

export function bridgeTsserverRequests(
  connections: BridgeConnections,
  options: BridgeTsserverRequestOptions
): BridgeHandle {
  const scheduler = options.scheduler ?? {
    setTimeout: (handler, ms) => setTimeout(handler, ms),
    clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  let disposed = false;

  const disposable = connections.primary.onNotification(
    TSSERVER_REQUEST_NOTIFICATION,
    (payload: unknown) => {
      if (disposed) {
        return;
      }
      const parsed = parseRequestPayload(payload);
      if (!parsed) {
        options.logger.warn(
          { payload },
          "ignoring malformed tsserver/request notification from vue language server"
        );
        return;
      }

      void forward(parsed);
    }
  );

  async function forward(parsed: ParsedRequest): Promise<void> {
    try {
      const raw = await withTimeout(
        connections.companion.sendRequest(EXECUTE_COMMAND_METHOD, {
          command: TSSERVER_BRIDGE_COMMAND,
          arguments: [parsed.command, parsed.args],
        }),
        options.timeoutMs,
        scheduler
      );
      if (disposed) {
        return;
      }
      sendResponse(parsed.id, unwrapTsserverResponse(raw));
    } catch (error) {
      if (disposed) {
        return;
      }
      options.logger.warn(
        { err: error, tsCommand: parsed.command },
        "tsserver/request bridge failed; returning null to vue language server"
      );
      sendResponse(parsed.id, null);
    }
  }

  function sendResponse(id: ParsedRequest["id"], body: unknown): void {
    try {
      void connections.primary
        .sendNotification(TSSERVER_RESPONSE_NOTIFICATION, [id, body])
        .catch?.((error: unknown) => {
          options.logger.warn(
            { err: error, id },
            "failed to deliver tsserver/response notification"
          );
        });
    } catch (error) {
      options.logger.warn({ err: error, id }, "tsserver/response delivery threw synchronously");
    }
  }

  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      // vscode-jsonrpc `Disposable` interface — defensive in case the underlying
      // connection mock returns void instead.
      (disposable as { dispose?: () => void } | undefined)?.dispose?.();
    },
  };
}

/**
 * `typescript.tsserverRequest` returns the raw tsserver wire response —
 * `{ seq, type, command, request_seq, success, body }` — but Volar expects to
 * receive the inner `body` directly (see `getQuickInfoAtPosition`,
 * `_vue:projectInfo` consumers, etc. in `@vue/language-server`). Strip the
 * wrapper here; downgrade `success: false` responses to `null` so Volar
 * resolves the in-flight promise instead of trying to dereference an error
 * envelope.
 */
export function unwrapTsserverResponse(raw: unknown): unknown {
  if (raw === null || raw === undefined) {
    return null;
  }
  if (typeof raw !== "object") {
    return raw;
  }
  const wrapper = raw as { success?: boolean; body?: unknown; type?: unknown };
  // Only unwrap when this *looks* like a tsserver response envelope.
  if (!("body" in wrapper) && wrapper.type !== "response") {
    return raw;
  }
  if (wrapper.success === false) {
    return null;
  }
  return wrapper.body ?? null;
}

async function withTimeout<T>(
  promise: Promise<T> | T,
  ms: number,
  scheduler: Required<BridgeTsserverRequestOptions>["scheduler"]
): Promise<T> {
  if (!(promise instanceof Promise)) {
    return promise;
  }
  let timer: unknown;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = scheduler.setTimeout(() => {
          reject(new TsserverBridgeTimeoutError(ms));
        }, ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      scheduler.clearTimeout(timer);
    }
  }
}

export class TsserverBridgeTimeoutError extends Error {
  readonly timeoutMs: number;
  constructor(timeoutMs: number) {
    super(`tsserver/request bridge timed out after ${timeoutMs}ms`);
    this.name = "TsserverBridgeTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

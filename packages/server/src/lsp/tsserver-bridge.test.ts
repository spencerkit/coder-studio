import { describe, expect, it, vi } from "vitest";
import type { Disposable } from "vscode-jsonrpc";
import { bridgeTsserverRequests, unwrapTsserverResponse } from "./tsserver-bridge.js";

type NotificationHandler = (payload: unknown) => void;

interface FakePrimary {
  onNotification: ReturnType<typeof vi.fn>;
  sendNotification: ReturnType<typeof vi.fn>;
  emit: (method: string, payload: unknown) => void;
  notifications: Array<{ method: string; payload: unknown }>;
}

function createFakePrimary(): FakePrimary {
  const handlers = new Map<string, NotificationHandler>();
  const notifications: FakePrimary["notifications"] = [];
  const fake: FakePrimary = {
    onNotification: vi.fn((method: string, handler: NotificationHandler): Disposable => {
      handlers.set(method, handler);
      return { dispose: () => handlers.delete(method) };
    }),
    sendNotification: vi.fn(async (method: string, payload: unknown) => {
      notifications.push({ method, payload });
    }),
    emit(method, payload) {
      handlers.get(method)?.(payload);
    },
    notifications,
  };
  return fake;
}

describe("bridgeTsserverRequests", () => {
  it("forwards tsserver/request payloads, unwraps the tsserver body, and replies with tsserver/response", async () => {
    const primary = createFakePrimary();
    // typescript-language-server returns the raw tsserver wire response; we
    // must strip the wrapper before forwarding so Volar sees the inner body.
    const sendRequest = vi.fn(async () => ({
      seq: 0,
      type: "response",
      command: "quickinfo",
      request_seq: 4,
      success: true,
      body: { displayString: "const sharedValue: number" },
    }));
    const handle = bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 1000, logger: { warn: vi.fn() } }
    );

    primary.emit("tsserver/request", [42, "quickinfo", { file: "App.vue", line: 1, offset: 1 }]);

    await vi.waitFor(() => {
      expect(primary.notifications).toHaveLength(1);
    });

    expect(sendRequest).toHaveBeenCalledWith("workspace/executeCommand", {
      command: "typescript.tsserverRequest",
      arguments: ["quickinfo", { file: "App.vue", line: 1, offset: 1 }],
    });
    expect(primary.notifications[0]).toEqual({
      method: "tsserver/response",
      payload: [42, { displayString: "const sharedValue: number" }],
    });
    handle.dispose();
  });

  it("returns null to Volar when the tsserver wrapper reports success=false", async () => {
    const primary = createFakePrimary();
    const sendRequest = vi.fn(async () => ({
      seq: 0,
      type: "response",
      command: "quickinfo",
      request_seq: 4,
      success: false,
      message: "Cannot find file",
    }));
    bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 1000, logger: { warn: vi.fn() } }
    );

    primary.emit("tsserver/request", [1, "quickinfo", {}]);

    await vi.waitFor(() => {
      expect(primary.notifications).toHaveLength(1);
    });
    expect(primary.notifications[0]).toEqual({
      method: "tsserver/response",
      payload: [1, null],
    });
  });

  it("replies with null when the companion rejects, so vue stops waiting", async () => {
    const primary = createFakePrimary();
    const sendRequest = vi.fn(async () => {
      throw new Error("companion exploded");
    });
    const warn = vi.fn();
    bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 1000, logger: { warn } }
    );

    primary.emit("tsserver/request", [7, "quickinfo", {}]);

    await vi.waitFor(() => {
      expect(primary.notifications).toHaveLength(1);
    });
    expect(primary.notifications[0]).toEqual({
      method: "tsserver/response",
      payload: [7, null],
    });
    expect(warn).toHaveBeenCalled();
  });

  it("times out instead of letting volar hang forever", async () => {
    const primary = createFakePrimary();
    // Never resolves; bridge must time out.
    const sendRequest = vi.fn(() => new Promise(() => {}));
    const warn = vi.fn();
    let scheduledHandler: (() => void) | null = null;
    const scheduler = {
      setTimeout: vi.fn((handler: () => void) => {
        scheduledHandler = handler;
        return Symbol("timer");
      }),
      clearTimeout: vi.fn(),
    };
    bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 25, logger: { warn }, scheduler }
    );

    primary.emit("tsserver/request", [1, "definition", {}]);
    expect(scheduler.setTimeout).toHaveBeenCalled();

    // Fire the timeout deterministically.
    scheduledHandler?.();

    await vi.waitFor(() => {
      expect(primary.notifications).toHaveLength(1);
    });
    expect(primary.notifications[0]).toEqual({
      method: "tsserver/response",
      payload: [1, null],
    });
    expect(warn).toHaveBeenCalled();
  });

  it("ignores malformed payloads instead of crashing", async () => {
    const primary = createFakePrimary();
    const sendRequest = vi.fn();
    const warn = vi.fn();
    bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 1000, logger: { warn } }
    );

    primary.emit("tsserver/request", "garbage");
    primary.emit("tsserver/request", [1]); // missing command
    primary.emit("tsserver/request", [null, "x"]); // bad id type

    expect(sendRequest).not.toHaveBeenCalled();
    expect(primary.notifications).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it("passes through plain (non-wrapped) results without modification", async () => {
    // Some commands or pre-v4.4 servers may return the body directly; tolerate
    // that by leaving the value alone.
    const primary = createFakePrimary();
    const sendRequest = vi.fn(async () => ({ displayString: "string" }));
    bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 1000, logger: { warn: vi.fn() } }
    );

    primary.emit("tsserver/request", [3, "quickinfo", {}]);
    await vi.waitFor(() => {
      expect(primary.notifications).toHaveLength(1);
    });
    expect(primary.notifications[0]).toEqual({
      method: "tsserver/response",
      payload: [3, { displayString: "string" }],
    });
  });

  it("stops forwarding after dispose, even if responses arrive late", async () => {
    const primary = createFakePrimary();
    let resolveCompanion: ((value: unknown) => void) | null = null;
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveCompanion = resolve;
        })
    );
    const handle = bridgeTsserverRequests(
      { primary, companion: { sendRequest } },
      { timeoutMs: 1000, logger: { warn: vi.fn() } }
    );

    primary.emit("tsserver/request", [99, "x", {}]);
    handle.dispose();
    resolveCompanion?.({ body: "late" });

    // Give the microtask queue a tick.
    await Promise.resolve();
    await Promise.resolve();

    expect(primary.notifications).toHaveLength(0);
  });
});

describe("unwrapTsserverResponse", () => {
  it("returns the inner body for a successful tsserver wire response", () => {
    expect(
      unwrapTsserverResponse({
        seq: 0,
        type: "response",
        command: "quickinfo",
        request_seq: 4,
        success: true,
        body: { displayString: "string" },
      })
    ).toEqual({ displayString: "string" });
  });

  it("returns null when the tsserver response is unsuccessful", () => {
    expect(
      unwrapTsserverResponse({
        seq: 0,
        type: "response",
        command: "quickinfo",
        success: false,
        message: "no file",
      })
    ).toBeNull();
  });

  it("returns null for null / undefined / missing-body responses", () => {
    expect(unwrapTsserverResponse(null)).toBeNull();
    expect(unwrapTsserverResponse(undefined)).toBeNull();
    expect(
      unwrapTsserverResponse({ seq: 0, type: "response", command: "x", success: true })
    ).toBeNull();
  });

  it("passes through plain results unchanged", () => {
    expect(unwrapTsserverResponse({ displayString: "string" })).toEqual({
      displayString: "string",
    });
    expect(unwrapTsserverResponse("just a string")).toBe("just a string");
  });
});

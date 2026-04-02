import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceControllerState } from "../apps/web/src/features/workspace/workspace-controller.ts";
import { startSessionRuntime } from "../apps/web/src/services/http/session-runtime.service.ts";

type MockFetchCall = {
  input: string | URL | Request;
  init?: RequestInit;
};

const withMockWindow = (
  value: Window & typeof globalThis,
  run: () => Promise<void>,
) => {
  const originalWindow = globalThis.window;
  Object.defineProperty(globalThis, "window", {
    value,
    configurable: true,
    writable: true,
  });

  return run().finally(() => {
    if (typeof originalWindow === "undefined") {
      Reflect.deleteProperty(globalThis, "window");
      return;
    }

    Object.defineProperty(globalThis, "window", {
      value: originalWindow,
      configurable: true,
      writable: true,
    });
  });
};

test("startSessionRuntime posts to session_runtime_start without any client-supplied command", async () => {
  const calls: MockFetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { terminal_id: 9, started: true } }),
    } as Response;
  }) as typeof fetch;

  try {
    await withMockWindow(
      {
        location: {
          origin: "http://127.0.0.1:41033",
          protocol: "http:",
          hostname: "127.0.0.1",
          port: "41033",
          search: "",
        },
      } as Window & typeof globalThis,
      async () => {
        await startSessionRuntime({
          workspaceId: "ws-1",
          controller: createWorkspaceControllerState({
            role: "controller",
            deviceId: "device-a",
            clientId: "client-a",
            fencingToken: 7,
          }),
          sessionId: "42",
          cols: 120,
          rows: 30,
        });
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.match(String(calls[0].input), /\/api\/rpc\/session_runtime_start$/);
  const payload = JSON.parse(String(calls[0].init?.body));
  assert.deepEqual(payload, {
    workspaceId: "ws-1",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 7,
    sessionId: "42",
    cols: 120,
    rows: 30,
  });
  assert.equal(payload.command, undefined);
});

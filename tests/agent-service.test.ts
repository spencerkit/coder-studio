import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceControllerState } from "../apps/web/src/features/workspace/workspace-controller.ts";
import { startAgent } from "../apps/web/src/services/http/agent.service.ts";

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

test("startAgent omits legacy command field from agent_start payload", async () => {
  const calls: MockFetchCall[] = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ input, init });
    return {
      ok: true,
      status: 200,
      json: async () => ({ ok: true, data: { started: true } }),
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
        await startAgent({
          workspaceId: "ws-1",
          controller: createWorkspaceControllerState({
            role: "controller",
            deviceId: "device-a",
            clientId: "client-a",
            fencingToken: 7,
          }),
          sessionId: "1",
          provider: "claude",
          cols: 120,
          rows: 30,
        });
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  const payload = JSON.parse(String(calls[0].init?.body));
  assert.equal(payload.command, undefined);
  assert.deepEqual(payload, {
    workspaceId: "ws-1",
    deviceId: "device-a",
    clientId: "client-a",
    fencingToken: 7,
    sessionId: "1",
    provider: "claude",
    cols: 120,
    rows: 30,
  });
});

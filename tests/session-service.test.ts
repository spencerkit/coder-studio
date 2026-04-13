import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceControllerState } from "../apps/web/src/features/workspace/workspace-controller";
import {
  createSessionActivityPersistScheduler,
  updateSession,
} from "../apps/web/src/services/http/session.service";
import { WsConnectionManager } from "../apps/web/src/ws/connection-manager";

const createFakeTimeouts = () => {
  const timers = new Map<number, { callback: () => void; delayMs: number }>();
  const cancelled: number[] = [];
  let nextHandle = 1;

  return {
    cancelled,
    timers,
    schedule(callback: () => void, delayMs: number) {
      const handle = nextHandle++;
      timers.set(handle, { callback, delayMs });
      return handle;
    },
    cancel(handle: unknown) {
      cancelled.push(handle as number);
      timers.delete(handle as number);
    },
    runNext() {
      const next = timers.entries().next();
      if (next.done) return false;
      const [handle, timer] = next.value;
      timers.delete(handle);
      timer.callback();
      return true;
    },
  };
};

test("createSessionActivityPersistScheduler waits for stability and only persists the latest activity timestamp", () => {
  const timeouts = createFakeTimeouts();
  const persisted: Array<{
    workspaceId: string;
    sessionId: string;
    lastActiveAt?: number;
    controller: string;
  }> = [];
  const scheduler = createSessionActivityPersistScheduler(
    (workspaceId, sessionId, patch, controller) => {
      persisted.push({
        workspaceId,
        sessionId,
        lastActiveAt: patch.last_active_at,
        controller,
      });
    },
    timeouts.schedule,
    timeouts.cancel,
    1200,
  );

  scheduler.schedule("ws-1", "session-7", 101, "controller-a");
  scheduler.schedule("ws-1", "session-7", 205, "controller-b");

  assert.deepEqual(persisted, []);
  assert.equal(timeouts.timers.size, 1);
  assert.deepEqual(timeouts.cancelled, [1]);

  timeouts.runNext();

  assert.deepEqual(persisted, [
    {
      workspaceId: "ws-1",
      sessionId: "session-7",
      lastActiveAt: 205,
      controller: "controller-b",
    },
  ]);
});

test("createSessionActivityPersistScheduler can hand the latest pending activity timestamp to an immediate patch", () => {
  const timeouts = createFakeTimeouts();
  const scheduler = createSessionActivityPersistScheduler(
    () => {
      throw new Error("pending activity should not flush when an immediate patch takes over");
    },
    timeouts.schedule,
    timeouts.cancel,
    1200,
  );

  scheduler.schedule("ws-1", "session-7", 333, "controller-a");

  const pending = scheduler.takeLastActiveAt("ws-1", "session-7");

  assert.equal(pending, 333);
  assert.equal(timeouts.timers.size, 0);
  assert.deepEqual(timeouts.cancelled, [1]);
});

test("updateSession prefers websocket transport when available", async () => {
  const messages: unknown[] = [];
  const originalSend = WsConnectionManager.prototype.send;
  const originalFetch = globalThis.fetch;

  WsConnectionManager.prototype.send = function send(message) {
    messages.push(message);
    return true;
  };
  globalThis.fetch = (async () => {
    throw new Error("http fallback should not run when websocket send succeeds");
  }) as typeof fetch;

  try {
      const result = await updateSession(
        "ws-1",
        "session-7",
        { title: "Renamed Session" },
        createWorkspaceControllerState({
        role: "controller",
        deviceId: "device-a",
        clientId: "client-a",
        fencingToken: 9,
      }),
    );

    assert.equal(result, null);
    assert.deepEqual(messages, [
      {
        type: "session_update",
        workspace_id: "ws-1",
        session_id: "session-7",
        patch: { title: "Renamed Session" },
        fencing_token: 9,
      },
    ]);
  } finally {
    WsConnectionManager.prototype.send = originalSend;
    globalThis.fetch = originalFetch;
  }
});

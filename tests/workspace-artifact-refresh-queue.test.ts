import test from "node:test";
import assert from "node:assert/strict";

import { createWorkspaceArtifactRefreshQueue } from "../apps/web/src/features/workspace/workspace-artifact-refresh-queue";

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

test("createWorkspaceArtifactRefreshQueue returns the queued task to the first debounced caller", async () => {
  const timeouts = createFakeTimeouts();
  const calls: string[] = [];
  const queue = createWorkspaceArtifactRefreshQueue(
    async (tabId: string) => {
      calls.push(tabId);
      return { workspaceId: tabId };
    },
    timeouts.schedule,
    timeouts.cancel,
    120,
  );

  const task = queue.request("ws-1");

  assert.ok(task instanceof Promise);
  assert.deepEqual(calls, []);
  assert.equal(timeouts.timers.size, 1);

  timeouts.runNext();

  assert.deepEqual(await task, { workspaceId: "ws-1" });
  assert.deepEqual(calls, ["ws-1"]);
});

test("createWorkspaceArtifactRefreshQueue shares one queued promise across repeated callers", async () => {
  const timeouts = createFakeTimeouts();
  const calls: string[] = [];
  const queue = createWorkspaceArtifactRefreshQueue(
    async (tabId: string) => {
      calls.push(tabId);
      return { workspaceId: tabId, run: calls.length };
    },
    timeouts.schedule,
    timeouts.cancel,
    120,
  );

  const first = queue.request("ws-1");
  const second = queue.request("ws-1");

  assert.strictEqual(first, second);
  assert.equal(timeouts.timers.size, 1);

  timeouts.runNext();

  assert.deepEqual(await first, { workspaceId: "ws-1", run: 1 });
  assert.deepEqual(calls, ["ws-1"]);
});

test("createWorkspaceArtifactRefreshQueue flushes immediately when requested", async () => {
  const timeouts = createFakeTimeouts();
  const calls: string[] = [];
  const queue = createWorkspaceArtifactRefreshQueue(
    async (tabId: string) => {
      calls.push(tabId);
      return { workspaceId: tabId };
    },
    timeouts.schedule,
    timeouts.cancel,
    120,
  );

  queue.request("ws-1");
  const task = queue.request("ws-1", true);

  assert.deepEqual(timeouts.cancelled, [1]);
  assert.equal(timeouts.timers.size, 0);
  assert.deepEqual(await task, { workspaceId: "ws-1" });
  assert.deepEqual(calls, ["ws-1"]);
});

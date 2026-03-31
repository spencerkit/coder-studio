import test from "node:test";
import assert from "node:assert/strict";

import { createHistoryRefreshController } from "../apps/web/src/features/workspace/history-refresh-controller.ts";

test("createHistoryRefreshController replays a forced refresh after an inflight load settles", async () => {
  const resolvers: Array<(value: string[] | null) => void> = [];
  const calls: number[] = [];
  const controller = createHistoryRefreshController<string[]>(() => new Promise((resolve) => {
    calls.push(calls.length + 1);
    resolvers.push(resolve);
  }));

  const first = controller.request(false);
  const forced = controller.request(true);

  assert.deepEqual(calls, [1]);

  resolvers.shift()!(["stale"]);
  await new Promise((resolve) => setImmediate(resolve));

  resolvers.shift()!(["fresh"]);

  assert.deepEqual(await first, ["stale"]);
  assert.deepEqual(await forced, ["fresh"]);
  assert.deepEqual(calls, [1, 2]);
});

test("createHistoryRefreshController reuses loaded data until marked dirty", async () => {
  const calls: number[] = [];
  const controller = createHistoryRefreshController(async () => {
    calls.push(calls.length + 1);
    return [`run-${calls.length}`];
  });

  assert.deepEqual(await controller.request(false), ["run-1"]);
  assert.deepEqual(await controller.request(false), ["run-1"]);
  assert.deepEqual(calls, [1]);

  controller.markDirty();
  assert.deepEqual(await controller.request(false), ["run-2"]);
  assert.deepEqual(calls, [1, 2]);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_RUNTIME_RETRY_DELAYS_MS,
  runAttachWithRetry,
} from "../apps/web/src/features/workspace/runtime-attach.ts";

test("runAttachWithRetry keeps retrying until attach succeeds", async () => {
  const snapshot = { workspace: "ws-1" };
  let attempts = 0;

  const result = await runAttachWithRetry(async () => {
    attempts += 1;
    return attempts < 4 ? null : snapshot;
  }, [0, 0, 0, 0]);

  assert.equal(result, snapshot);
  assert.equal(attempts, 4);
});

test("runAttachWithRetry returns null after exhausting its retry budget", async () => {
  let attempts = 0;

  const result = await runAttachWithRetry(async () => {
    attempts += 1;
    return null;
  }, [0, 0, 0]);

  assert.equal(result, null);
  assert.equal(attempts, 3);
});

test("runtime attach retry delays reserve a longer recovery window for slow environments", () => {
  assert.deepEqual(
    ATTACH_RUNTIME_RETRY_DELAYS_MS,
    [0, 250, 750, 1500, 3000, 5000],
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTACH_RUNTIME_RETRY_DELAYS_MS,
  ATTACH_RUNTIME_SUCCESS_REUSE_MS,
  createWorkspaceRuntimeAttachDeduper,
  runAttachWithRetry,
} from "../apps/web/src/features/workspace/runtime-attach";

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

test("createWorkspaceRuntimeAttachDeduper shares an inflight attach across callers for the same workspace key", async () => {
  let calls = 0;
  let resolveAttach: ((value: { workspace: string }) => void) | null = null;
  const dedupe = createWorkspaceRuntimeAttachDeduper<{ workspace: string }>();

  const first = dedupe.run("ws-1:device-a:client-a", () => new Promise((resolve) => {
    calls += 1;
    resolveAttach = resolve;
  }));
  const second = dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "unexpected" };
  });

  assert.equal(calls, 1);

  resolveAttach?.({ workspace: "ws-1" });
  const [firstResult, secondResult] = await Promise.all([first, second]);

  assert.deepEqual(firstResult, { workspace: "ws-1" });
  assert.deepEqual(secondResult, { workspace: "ws-1" });
  assert.equal(calls, 1);
});

test("createWorkspaceRuntimeAttachDeduper reuses a recent successful attach result for a short cooldown window", async () => {
  let now = 10_000;
  let calls = 0;
  const dedupe = createWorkspaceRuntimeAttachDeduper<{ workspace: string }>({
    now: () => now,
  });

  const first = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1" };
  });
  const second = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1-second" };
  });

  assert.deepEqual(first, { workspace: "ws-1" });
  assert.deepEqual(second, { workspace: "ws-1" });
  assert.equal(calls, 1);

  now += ATTACH_RUNTIME_SUCCESS_REUSE_MS + 1;

  const third = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1-third" };
  });

  assert.deepEqual(third, { workspace: "ws-1-third" });
  assert.equal(calls, 2);
});

test("createWorkspaceRuntimeAttachDeduper allows callers to extend the success reuse window per request", async () => {
  let now = 5_000;
  let calls = 0;
  const dedupe = createWorkspaceRuntimeAttachDeduper<{ workspace: string }>({
    now: () => now,
    successReuseMs: 500,
  });

  const first = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1" };
  });

  now += 1_500;

  const second = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1-second" };
  }, {
    successReuseMs: 2_000,
  });

  assert.deepEqual(first, { workspace: "ws-1" });
  assert.deepEqual(second, { workspace: "ws-1" });
  assert.equal(calls, 1);
});

test("createWorkspaceRuntimeAttachDeduper lets force requests bypass cached success reuse", async () => {
  let calls = 0;
  const dedupe = createWorkspaceRuntimeAttachDeduper<{ workspace: string }>();

  const first = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1" };
  });

  const second = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1-forced" };
  }, {
    force: true,
  });

  assert.deepEqual(first, { workspace: "ws-1" });
  assert.deepEqual(second, { workspace: "ws-1-forced" });
  assert.equal(calls, 2);
});

test("createWorkspaceRuntimeAttachDeduper does not cache null attach results", async () => {
  let calls = 0;
  const dedupe = createWorkspaceRuntimeAttachDeduper<{ workspace: string }>();

  const first = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return null;
  });
  const second = await dedupe.run("ws-1:device-a:client-a", async () => {
    calls += 1;
    return { workspace: "ws-1" };
  });

  assert.equal(first, null);
  assert.deepEqual(second, { workspace: "ws-1" });
  assert.equal(calls, 2);
});

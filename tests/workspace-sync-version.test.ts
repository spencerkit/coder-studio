import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceSyncVersionTracker } from "../apps/web/src/features/workspace/workspace-sync-version";

test("later sync versions invalidate earlier in-flight syncs for the same workspace", () => {
  const tracker = createWorkspaceSyncVersionTracker();

  const firstVersion = tracker.advance("ws-sync-race");
  const secondVersion = tracker.advance("ws-sync-race");

  assert.equal(firstVersion, 1);
  assert.equal(secondVersion, 2);
  assert.equal(tracker.isCurrent("ws-sync-race", firstVersion), false);
  assert.equal(tracker.isCurrent("ws-sync-race", secondVersion), true);
});

test("sync versions stay isolated per workspace", () => {
  const tracker = createWorkspaceSyncVersionTracker();

  const leftVersion = tracker.advance("ws-sync-left");
  const rightVersion = tracker.advance("ws-sync-right");

  assert.equal(leftVersion, 1);
  assert.equal(rightVersion, 1);
  assert.equal(tracker.isCurrent("ws-sync-left", leftVersion), true);
  assert.equal(tracker.isCurrent("ws-sync-right", rightVersion), true);
});

test("a local mutation bump invalidates an older attach version", () => {
  const tracker = createWorkspaceSyncVersionTracker();

  const attachVersion = tracker.advance("ws-sync-restore");
  const restoreVersion = tracker.advance("ws-sync-restore");

  assert.equal(restoreVersion, attachVersion + 1);
  assert.equal(tracker.isCurrent("ws-sync-restore", attachVersion), false);
  assert.equal(tracker.isCurrent("ws-sync-restore", restoreVersion), true);
});

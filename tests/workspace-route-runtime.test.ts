import test from "node:test";
import assert from "node:assert/strict";
import {
  ROUTE_RUNTIME_ATTACH_RECOVERY_DELAYS_MS,
  shouldAttachRouteRuntimeForExistingTab,
} from "../apps/web/src/features/workspace/workspace-route-runtime";

test("route runtime recovery delays keep the slower fallback windows for cold route loads", () => {
  assert.deepEqual(ROUTE_RUNTIME_ATTACH_RECOVERY_DELAYS_MS, [0, 1_000, 3_000, 7_000]);
});

test("ready route tabs skip direct runtime reattach because coordinator recovery owns that path", () => {
  assert.equal(shouldAttachRouteRuntimeForExistingTab({ status: "ready" }), false);
});

test("missing or initializing route tabs still attach runtime directly", () => {
  assert.equal(shouldAttachRouteRuntimeForExistingTab(undefined), true);
  assert.equal(shouldAttachRouteRuntimeForExistingTab({ status: "init" }), true);
});

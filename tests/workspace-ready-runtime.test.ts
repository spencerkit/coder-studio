import test from "node:test";
import assert from "node:assert/strict";

import {
  READY_TAB_RUNTIME_RECOVERY_DELAYS_MS,
  collectReadyTabRuntimeRecoveryWorkspaceIds,
} from "../apps/web/src/features/workspace/workspace-ready-runtime";

test("ready-tab runtime recovery uses a single delayed follow-up attach", () => {
  assert.deepEqual(READY_TAB_RUNTIME_RECOVERY_DELAYS_MS, [0, 3_000]);
});

test("collectReadyTabRuntimeRecoveryWorkspaceIds only includes ready tabs", () => {
  assert.deepEqual(
    collectReadyTabRuntimeRecoveryWorkspaceIds([
      { id: "ws-ready-a", status: "ready" },
      { id: "ws-init", status: "init" },
      { id: "ws-ready-b", status: "ready" },
      { id: "ws-loading", status: "loading" },
    ]),
    ["ws-ready-a", "ws-ready-b"],
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkspaceShellSummary } from "../apps/web/src/features/workspace/workspace-shell-summary";

test("buildWorkspaceShellSummary returns branch runtime changes and queue items", () => {
  const summary = buildWorkspaceShellSummary({
    branchName: "feature/mock-readme",
    changeCount: 7,
    target: { type: "wsl", distro: "Ubuntu" },
    sessions: [
      { status: "running", queue: [] },
      { status: "idle", queue: [{ status: "queued" }, { status: "done" }] },
      { status: "idle", queue: [{ status: "queued" }] },
    ],
    t: (key) => key,
  });

  assert.deepEqual(
    summary.map((item) => item.label),
    ["branch", "runtimeLabel", "changes", "queueLabel"],
  );
  assert.deepEqual(
    summary.map((item) => item.value),
    ["feature/mock-readme", "WSL (Ubuntu)", "7", "2"],
  );
});

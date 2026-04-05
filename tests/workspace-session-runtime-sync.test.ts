import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("starting a session runtime reattaches the workspace runtime snapshot so terminal bindings land in state", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const startSessionRuntimeInPane = async[\s\S]*?advanceWorkspaceSyncVersion\(tab\.id\);[\s\S]*?startSessionRuntime\([\s\S]*?attachWorkspaceRuntimeWithRetry\([\s\S]*?applyWorkspaceRuntimeSnapshot\(/,
  );
});

test("history restore starts the recovered session immediately on first click", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const handleHistoryRecordSelect = async[\s\S]*?const action = selectHistoryPrimaryAction\(record\);[\s\S]*?const restored = await restoreSessionIntoPane\(\s*record\.workspaceId,\s*record\.sessionId,\s*restorePaneId,\s*record,\s*\{\s*strategy:\s*"split-new",\s*\},\s*\);[\s\S]*?if \(action === "restore"\)[\s\S]*?const restoredPaneId = latestTab[\s\S]*?findPaneIdBySessionId\(latestTab\.paneLayout,\s*String\(restored\.id\)\)[\s\S]*?startAgentSessionInPane\(restoredPaneId,/,
  );
});

test("history restore keeps the current pane mounted and starts the recovered session in a new pane", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const currentTab = stateRef\.current\.tabs\.find\(\(tab\) => tab\.id === record\.workspaceId\) \?\? targetTab;/,
  );
  assert.match(
    source,
    /const restorePaneId = currentTab\.activePaneId;[\s\S]*?const restored = await restoreSessionIntoPane\(\s*record\.workspaceId,\s*record\.sessionId,\s*restorePaneId,\s*record,\s*\{\s*strategy:\s*"split-new",\s*\},\s*\);/,
  );
  assert.match(
    source,
    /const restoredPaneId = latestTab[\s\S]*?findPaneIdBySessionId\(latestTab\.paneLayout,\s*String\(restored\.id\)\)/,
  );
});

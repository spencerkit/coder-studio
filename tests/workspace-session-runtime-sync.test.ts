import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("../apps/web/src/features/workspace/workspace-sync-hooks.ts", import.meta.url),
  "utf8",
);

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

test("agent pane terminal resize treats runtime bindings as the live gate and keeps terminal ids as fallback compatibility", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /if \(!tab \|\| !session\?\.terminalRuntimeId\) return;/);
  assert.match(source, /const terminalId = resolveSessionTerminalIdByRuntimeId\(tab\.sessions, session\.terminalRuntimeId, tab\.terminals\)\s*\?\? session\.terminalId/);
  assert.match(source, /syncWorkspaceTerminalSize\([\s\S]*?terminalId,[\s\S]*?size\.cols,[\s\S]*?size\.rows,[\s\S]*?\);/);
});

test("legacy terminal events skip session-bound workspace terminals to avoid duplicate streams", () => {
  assert.match(source, /const unsubscribe = subscribeTerminalEvents\(\(\{ workspace_id, terminal_id, data \}\) => \{[\s\S]*?const mappedTerminalId = `term-\$\{terminal_id\}`;[\s\S]*?const matchedTab = currentState\.tabs\.find\(\(tab\) => tab\.id === workspace_id\);[\s\S]*?if \(matchedTab && isSessionBoundWorkspaceTerminalId\(matchedTab\.sessions, mappedTerminalId\)\) \{[\s\S]*?return;[\s\S]*?\}/);
});

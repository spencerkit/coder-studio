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

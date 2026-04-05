import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("materializing a draft session stays local and avoids backend history creation", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/session-actions.ts", import.meta.url),
    "utf8",
  );
  const materializeSessionSource = source.match(
    /const materializeSession = async[\s\S]*?const refreshTabFromBackend = async/,
  )?.[0] ?? "";

  assert.match(materializeSessionSource, /const materializeSession = async[\s\S]*?isDraft: false/);
  assert.doesNotMatch(materializeSessionSource, /createSessionRequest\(/);
  assert.doesNotMatch(materializeSessionSource, /advanceWorkspaceSyncVersion\(tabId\)/);
});

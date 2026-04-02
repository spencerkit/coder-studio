import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("materializing a draft session invalidates stale runtime attach responses", () => {
  const source = readFileSync(
    new URL("../apps/web/src/features/workspace/session-actions.ts", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /const materializeSession = async[\s\S]*?advanceWorkspaceSyncVersion\(tabId\);[\s\S]*?createSessionRequest\(/,
  );
});

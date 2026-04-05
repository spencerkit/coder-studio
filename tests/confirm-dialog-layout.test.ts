import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("history delete confirmation includes session content and time details", () => {
  const screenSource = readFileSync(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );
  const dialogSource = readFileSync(
    new URL("../apps/web/src/components/ConfirmDialog/ConfirmDialog.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    screenSource,
    /setConfirmDialog\(\{[\s\S]*details:\s*\{[\s\S]*content:\s*record\.title[\s\S]*timestamp:\s*formatHistoryRecordTimestamp\(record\.lastActiveAt\)[\s\S]*\}\s*,[\s\S]*\}\);/,
  );
  assert.match(
    dialogSource,
    /state\.details[\s\S]*confirm-dialog-details[\s\S]*state\.details\.content[\s\S]*state\.details\.timestamp/,
  );
});

test("confirm dialog styles clamp long details so the modal stays within the viewport", () => {
  const styleSource = readFileSync(
    new URL("../apps/web/src/styles/app.css", import.meta.url),
    "utf8",
  );

  assert.match(
    styleSource,
    /\.confirm-dialog-card\s*\{[\s\S]*max-height:\s*calc\(100vh - 32px\);/,
  );
  assert.match(
    styleSource,
    /\.confirm-dialog-details-content\s*\{[\s\S]*overflow:\s*hidden;[\s\S]*-webkit-line-clamp:\s*3;/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("code expand control lives with the workspace panel toggles instead of the editor search row", async () => {
  const editorPanel = await fs.readFile(
    new URL("../apps/web/src/components/workspace/WorkspaceEditorPanel.tsx", import.meta.url),
    "utf8",
  );
  const workspaceShell = await fs.readFile(
    new URL("../apps/web/src/components/workspace/WorkspaceShell.tsx", import.meta.url),
    "utf8",
  );
  const workspaceScreen = await fs.readFile(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(editorPanel, /MaximizeIcon|MinimizeIcon/);
  assert.doesNotMatch(editorPanel, /onToggleExpanded/);

  assert.match(workspaceShell, /MaximizeIcon|MinimizeIcon/);
  assert.match(workspaceShell, /onToggleCodeExpanded: \(\) => void;/);
  assert.match(workspaceShell, /onClick=\{onToggleCodeExpanded\}/);

  assert.match(workspaceScreen, /onToggleCodeExpanded=\{\(\) => \{/);
  assert.doesNotMatch(workspaceScreen, /onToggleExpanded=\{\(\) => \{/);
});

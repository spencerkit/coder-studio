import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("workspace code and terminal panels avoid redundant panel-inner wrappers", async () => {
  const editorPanel = await fs.readFile(
    new URL("../apps/web/src/components/workspace/WorkspaceEditorPanel.tsx", import.meta.url),
    "utf8",
  );
  const terminalPanel = await fs.readFile(
    new URL("../apps/web/src/components/workspace/WorkspaceTerminalPanel.tsx", import.meta.url),
    "utf8",
  );
  const agentPanel = await fs.readFile(
    new URL("../apps/web/src/features/agents/AgentWorkspaceFeature.tsx", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(editorPanel, /panel-inner workspace-code-panel/);
  assert.match(editorPanel, /className="panel workspace-code-shell workspace-code-panel"/);

  assert.doesNotMatch(terminalPanel, /panel-inner terminal-card workspace-terminal-panel/);
  assert.match(terminalPanel, /className="panel workspace-terminal-shell terminal-card workspace-terminal-panel"/);

  assert.doesNotMatch(agentPanel, /className="panel-inner studio-panel compact"/);
  assert.doesNotMatch(agentPanel, /className="agent-pane-workspace"/);
  assert.match(agentPanel, /className="panel center-panel workspace-agent-shell studio-panel compact"/);
});

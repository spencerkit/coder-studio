import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";

test("workspace runtime no longer retains the frontend slash menu chain", async () => {
  const workspaceScreen = await fs.readFile(
    new URL("../apps/web/src/features/workspace/WorkspaceScreen.tsx", import.meta.url),
    "utf8",
  );
  const workspaceService = await fs.readFile(
    new URL("../apps/web/src/services/http/workspace.service.ts", import.meta.url),
    "utf8",
  );
  const agentIndex = await fs.readFile(
    new URL("../apps/web/src/features/agents/index.ts", import.meta.url),
    "utf8",
  );
  const appConstants = await fs.readFile(
    new URL("../apps/web/src/shared/app/constants.ts", import.meta.url),
    "utf8",
  );
  const appStyles = await fs.readFile(
    new URL("../apps/web/src/styles/app.css", import.meta.url),
    "utf8",
  );
  const serverHttp = await fs.readFile(
    new URL("../apps/server/src/command/http.rs", import.meta.url),
    "utf8",
  );
  const serverModels = await fs.readFile(
    new URL("../apps/server/src/models.rs", import.meta.url),
    "utf8",
  );
  const serverSystem = await fs.readFile(
    new URL("../apps/server/src/services/system.rs", import.meta.url),
    "utf8",
  );
  const slashMenuActionsPath = new URL("../apps/web/src/features/agents/slash-menu-actions.ts", import.meta.url);
  const slashMenuActionsExists = await fs.access(slashMenuActionsPath).then(() => true).catch(() => false);

  assert.doesNotMatch(workspaceScreen, /slashMenuOpen/);
  assert.doesNotMatch(workspaceScreen, /slashMenuPaneId/);
  assert.doesNotMatch(workspaceScreen, /slashSkillItems/);
  assert.doesNotMatch(workspaceScreen, /listClaudeSlashSkills/);
  assert.doesNotMatch(workspaceScreen, /buildSlashMenuItems/);
  assert.doesNotMatch(workspaceScreen, /buildSlashMenuSections/);
  assert.doesNotMatch(workspaceScreen, /replaceLeadingSlashToken/);

  assert.doesNotMatch(workspaceService, /claude_slash_skills/);
  assert.doesNotMatch(agentIndex, /slash-menu-actions/);
  assert.doesNotMatch(appConstants, /BUILTIN_SLASH_COMMANDS/);
  assert.doesNotMatch(appConstants, /BUNDLED_CLAUDE_SKILLS/);
  assert.doesNotMatch(appConstants, /replaceLeadingSlashToken/);
  assert.doesNotMatch(appStyles, /\.agent-slash-menu/);
  assert.doesNotMatch(serverHttp, /claude_slash_skills/);
  assert.doesNotMatch(serverModels, /ClaudeSlashSkillEntry/);
  assert.doesNotMatch(serverSystem, /claude_slash_skills/);
  assert.doesNotMatch(serverSystem, /scan_claude_root/);
  assert.equal(slashMenuActionsExists, false);
});

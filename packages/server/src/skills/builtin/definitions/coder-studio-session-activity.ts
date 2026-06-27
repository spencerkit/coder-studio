import {
  AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
  AUTOMATION_CMD_FILE_NAME,
  BUILTIN_AUTOMATION_BRIDGE_SOURCE,
} from "../automation-bridge.js";
import type { BuiltinSkillDefinition } from "./types.js";

const DESCRIPTION =
  "Record structured session activity for meaningful milestones during a coding session.";

const CONTENT = [
  "---",
  "name: coder-studio-session-activity",
  `description: ${DESCRIPTION}`,
  "---",
  "",
  "# Coder Studio Session Activity",
  "",
  "Use this skill to record structured session activity during a coding session.",
  "",
  "Record meaningful milestones, not trivial noise. Log progress when plans change, commands finish with relevant outcomes, edits complete across important files, or when you need to review what already happened in the session.",
  "",
  "## Record Activity",
  "",
  "Use `session.activity.record` with clear summaries and relevant metadata:",
  "",
  "```bash",
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.record --kind plan_update --summary "Refined the implementation plan after reviewing the registry tests." --json`,
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.record --kind command_finish --summary "Vitest targeted run failed because the session activity skill definition was missing." --command 'pnpm exec vitest run packages/server/src/__tests__/skills/builtin-registry.test.ts --testNamePattern "session activity skill|metadata descriptions"' --exit-code 1 --json`,
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.record --kind edit_finish --files packages/server/src/skills/builtin/definitions/coder-studio-session-activity.ts,packages/server/src/skills/builtin/definitions/index.ts,packages/server/src/skills/builtin/registry.ts --summary "Added the built-in session activity skill definition and registered it." --json`,
  "```",
  "",
  "## Review Activity",
  "",
  "Use `session.activity.list` to inspect previously recorded session milestones:",
  "",
  "```bash",
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.list --json`,
  "```",
  "",
].join("\n");

export const CODER_STUDIO_SESSION_ACTIVITY_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-session-activity",
  displayName: "Coder Studio Session Activity",
  description: DESCRIPTION,
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: true,
  files: [
    {
      relativePath: AUTOMATION_CMD_FILE_NAME,
      content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
    },
  ],
  mountRendering: "automation_bridge",
  content: CONTENT,
};

import {
  AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
  AUTOMATION_CMD_FILE_NAME,
  BUILTIN_AUTOMATION_BRIDGE_SOURCE,
} from "../automation-bridge.js";
import type { BuiltinSkillDefinition } from "./types.js";

const DESCRIPTION =
  "Use when an agent running inside Coder Studio needs to open or close a workspace file, open or close a localhost URL, or open a canvas for the user.";

const CONTENT = [
  "---",
  "name: coder-studio-open",
  `description: ${DESCRIPTION}`,
  "---",
  "",
  "# Coder Studio Open",
  "",
  "Use this only to open or close a workspace file, open or close a localhost URL, or open a canvas tab for the user inside Coder Studio.",
  "",
  "Run the mounted bridge command directly:",
  "",
  "```bash",
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-file --path src/index.ts --line 12 --json`,
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.close-file --path src/index.ts --json`,
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-url --url http://127.0.0.1:5173 --json`,
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.close-url --url http://127.0.0.1:5173 --json`,
  `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-canvas --canvas canvas_123 --json`,
  "```",
  "",
  "Use workspace-relative file paths only; do not use absolute paths or `..` segments. URLs must stay on localhost `http` or `https`. Close commands only close a matching file path or the current browser URL. `accepted: true` means the request was dispatched, not that the frontend has finished rendering it.",
  "",
].join("\n");

export const CODER_STUDIO_OPEN_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-open",
  displayName: "Coder Studio Open",
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

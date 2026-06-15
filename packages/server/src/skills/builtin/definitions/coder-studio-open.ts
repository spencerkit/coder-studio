import type { BuiltinSkillDefinition } from "./types.js";

const CONTENT = [
  "---",
  "name: coder-studio-open",
  "description: Use when an agent running inside Coder Studio needs to open or close a workspace file or localhost URL for the user.",
  "---",
  "",
  "# Coder Studio Open",
  "",
  "Use this only to open or close a workspace file in Coder Studio's editor or a localhost URL in Coder Studio's browser for the user.",
  "",
  "Run one of:",
  "",
  "coder-studio ui open-file --path <workspace-relative-path> [--line N] [--column N] [--workspace <workspace-id>] --json",
  "coder-studio ui close-file --path <workspace-relative-path> [--workspace <workspace-id>] --json",
  "coder-studio ui open-url --url http://127.0.0.1:5173 [--workspace <workspace-id>] --json",
  "coder-studio ui close-url --url http://127.0.0.1:5173 [--workspace <workspace-id>] --json",
  "",
  "If the CLI cannot find the running Coder Studio server, pass `--api-url <url>` or set `CODER_STUDIO_API_URL`.",
  "",
  "Use workspace-relative file paths only; do not use absolute paths or `..` segments. URLs must be localhost `http` or `https` URLs. Close commands only close a matching file path or current browser URL. `accepted: true` means the request was dispatched, not that the frontend has finished rendering it.",
  "",
].join("\n");

export const CODER_STUDIO_OPEN_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-open",
  displayName: "Coder Studio Open",
  description: "Open workspace files and localhost URLs in Coder Studio.",
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: true,
  content: CONTENT,
};

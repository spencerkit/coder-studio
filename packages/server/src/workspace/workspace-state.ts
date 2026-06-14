import { join } from "node:path";

export const WORKSPACE_STATE_DIR = ".coder-studio" as const;
export const AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH = `${WORKSPACE_STATE_DIR}/agent.md` as const;
export const AGENT_INSTRUCTIONS_RELATIVE_PATH = AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH;
export const SESSION_METADATA_FILE_NAME = "session-metadata.json" as const;
export const SESSION_METADATA_RELATIVE_PATH =
  `${WORKSPACE_STATE_DIR}/${SESSION_METADATA_FILE_NAME}` as const;

export function resolveWorkspaceStateFilePath(workspacePath: string, fileName: string): string {
  return join(workspacePath, WORKSPACE_STATE_DIR, fileName);
}

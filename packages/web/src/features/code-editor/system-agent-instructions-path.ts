import type { SystemAgentInstructionsProviderId } from "@coder-studio/core";
import { SYSTEM_AGENT_INSTRUCTIONS_PROVIDER_IDS } from "@coder-studio/core";

export const SYSTEM_AGENT_INSTRUCTIONS_EDITOR_PATH_PREFIX = "agent-system:";

const SYSTEM_AGENT_PROVIDER_ID_SET = new Set<string>(SYSTEM_AGENT_INSTRUCTIONS_PROVIDER_IDS);

export function toSystemAgentInstructionsEditorPath(
  providerId: SystemAgentInstructionsProviderId
): string {
  return `${SYSTEM_AGENT_INSTRUCTIONS_EDITOR_PATH_PREFIX}${providerId}`;
}

export function parseSystemAgentInstructionsEditorPath(
  path: string
): SystemAgentInstructionsProviderId | null {
  if (!path.startsWith(SYSTEM_AGENT_INSTRUCTIONS_EDITOR_PATH_PREFIX)) {
    return null;
  }

  const providerId = path.slice(SYSTEM_AGENT_INSTRUCTIONS_EDITOR_PATH_PREFIX.length);
  return SYSTEM_AGENT_PROVIDER_ID_SET.has(providerId)
    ? (providerId as SystemAgentInstructionsProviderId)
    : null;
}

export function isSystemAgentInstructionsEditorPath(path: string): boolean {
  return parseSystemAgentInstructionsEditorPath(path) !== null;
}

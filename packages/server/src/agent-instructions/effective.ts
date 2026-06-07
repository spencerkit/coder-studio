import { createHash } from "node:crypto";
import { readFile } from "../fs/file-io.js";
import { AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH } from "../workspace/workspace-state.js";

interface AgentInstructionsDocumentReadResult {
  exists: boolean;
  content: string;
}

export function normalizeAgentInstructionsContent(content: string | undefined): string | undefined {
  const trimmed = content?.trim();
  return trimmed ? `${trimmed}\n` : undefined;
}

export function hashAgentInstructionsContent(content: string): string {
  return createHash("sha256")
    .update(normalizeAgentInstructionsContent(content) ?? "")
    .digest("hex");
}

async function readAgentInstructionsDocument(
  workspaceId: string,
  rootPath: string
): Promise<AgentInstructionsDocumentReadResult> {
  try {
    const result = await readFile(workspaceId, rootPath, AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH);
    if (result.kind !== "text") {
      return {
        exists: true,
        content: "",
      };
    }

    return {
      exists: true,
      content: result.content,
    };
  } catch {
    return {
      exists: false,
      content: "",
    };
  }
}

export async function resolveEffectiveAgentInstructions(
  workspaceId: string,
  rootPath: string
): Promise<{ content: string; effectiveHash: string } | null> {
  const document = await readAgentInstructionsDocument(workspaceId, rootPath);

  if (!document.exists) {
    return null;
  }

  const normalized = normalizeAgentInstructionsContent(document.content);
  if (!normalized) {
    return null;
  }

  return {
    content: normalized,
    effectiveHash: hashAgentInstructionsContent(normalized),
  };
}

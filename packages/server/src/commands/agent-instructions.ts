/**
 * Agent Instructions Commands
 */

import type { AgentInstructionsDocument, AgentInstructionsHealth } from "@coder-studio/core";
import { z } from "zod";
import { buildAgentInstructionsMarkdown } from "../agent-instructions/generator.js";
import { evaluateAgentInstructionsMarkdown } from "../agent-instructions/health.js";
import { readFile, writeFile } from "../fs/file-io.js";
import { inspectWorkspaceIntelligence } from "../workspace/intelligence.js";
import { registerCommand } from "../ws/dispatch.js";

async function readAgentInstructionsDocument(
  workspaceId: string,
  rootPath: string
): Promise<AgentInstructionsDocument> {
  const path = "AGENTS.md" as const;

  try {
    const result = await readFile(workspaceId, rootPath, path);
    if (result.kind !== "text") {
      return {
        path,
        exists: true,
        content: "",
      };
    }

    return {
      path,
      exists: true,
      content: result.content,
      baseHash: result.baseHash,
    };
  } catch {
    return {
      path,
      exists: false,
      content: "",
    };
  }
}

registerCommand(
  "agentInstructions.read",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    return readAgentInstructionsDocument(workspace.id, workspace.path);
  }
);

registerCommand(
  "agentInstructions.generate",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const summary = await inspectWorkspaceIntelligence({
      workspaceId: workspace.id,
      rootPath: workspace.path,
    });

    return {
      path: "AGENTS.md",
      exists: false,
      content: buildAgentInstructionsMarkdown(summary),
    } satisfies AgentInstructionsDocument;
  }
);

registerCommand(
  "agentInstructions.write",
  z.object({
    workspaceId: z.string(),
    content: z.string(),
    overwrite: z.boolean().optional(),
    baseHash: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const existing = await readAgentInstructionsDocument(workspace.id, workspace.path);
    if (existing.exists && !args.overwrite) {
      throw {
        code: "agent_instructions_exists",
        message: "AGENTS.md already exists",
      };
    }

    const result = await writeFile(workspace.path, "AGENTS.md", args.content, args.baseHash);
    ctx.eventBus.emit({
      type: "fs.dirty",
      workspaceId: args.workspaceId,
      reason: "file_content",
    });

    return {
      path: "AGENTS.md",
      exists: true,
      content: args.content,
      baseHash: result.newHash,
    } satisfies AgentInstructionsDocument;
  }
);

registerCommand(
  "agentInstructions.health",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
    }

    const document = await readAgentInstructionsDocument(workspace.id, workspace.path);
    return evaluateAgentInstructionsMarkdown(document.content) satisfies AgentInstructionsHealth;
  }
);

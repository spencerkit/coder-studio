/**
 * Agent Instructions Commands
 */

import { createHash } from "node:crypto";
import {
  mkdir as fsMkdir,
  readFile as fsReadFile,
  stat as fsStat,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AgentInstructionsDocument,
  AgentInstructionsHealth,
  AgentInstructionsPanelStatus,
  AgentInstructionsSystemDocument,
  AgentInstructionsSystemStatusEntry,
  SystemAgentInstructionsProviderId,
} from "@coder-studio/core";
import {
  SYSTEM_AGENT_INSTRUCTIONS_PATHS,
  SYSTEM_AGENT_INSTRUCTIONS_PROVIDER_IDS,
} from "@coder-studio/core";
import { z } from "zod";
import { AgentInstructionsGenerator } from "../agent-instructions/agent-generator.js";
import { resolveEffectiveAgentInstructions } from "../agent-instructions/effective.js";
import { buildAgentInstructionsMarkdown } from "../agent-instructions/generator.js";
import { evaluateAgentInstructionsMarkdown } from "../agent-instructions/health.js";
import { readFile as readWorkspaceFile, writeFile as writeWorkspaceFile } from "../fs/file-io.js";
import { describeNonInjectableState, INJECTABLE_SESSION_STATES } from "../supervisor/injector.js";
import { inspectWorkspaceIntelligence } from "../workspace/intelligence.js";
import {
  AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
  AGENT_INSTRUCTIONS_RELATIVE_PATH,
} from "../workspace/workspace-state.js";
import type { CommandContext } from "../ws/dispatch.js";
import { registerCommand } from "../ws/dispatch.js";

type AgentInstructionsPath = typeof AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH;

async function readDocument(
  workspaceId: string,
  rootPath: string,
  path: AgentInstructionsPath
): Promise<AgentInstructionsDocument & { path: AgentInstructionsPath }> {
  try {
    const result = await readWorkspaceFile(workspaceId, rootPath, path);
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

async function getWorkspaceOrThrow(
  workspaceId: string,
  ctx: Parameters<typeof registerCommand>[2] extends (
    args: unknown,
    ctx: infer T,
    clientId?: string
  ) => Promise<unknown>
    ? T
    : never
) {
  const workspace = ctx.workspaceMgr.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }

  return workspace;
}

async function buildGeneratedDocument(
  workspaceId: string,
  rootPath: string
): Promise<{
  summary: Awaited<ReturnType<typeof inspectWorkspaceIntelligence>>;
  content: string;
}> {
  const summary = await inspectWorkspaceIntelligence({
    workspaceId,
    rootPath,
  });

  return {
    summary,
    content: buildAgentInstructionsMarkdown(summary),
  };
}

async function writeCustomDocument(
  workspaceId: string,
  rootPath: string,
  content: string,
  ctx: CommandContext,
  options?: {
    overwrite?: boolean;
    baseHash?: string;
  }
): Promise<AgentInstructionsDocument> {
  const existing = await readDocument(
    workspaceId,
    rootPath,
    AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH
  );
  if (existing.exists && !options?.overwrite) {
    throw {
      code: "agent_instructions_exists",
      message: `${AGENT_INSTRUCTIONS_RELATIVE_PATH} already exists`,
    };
  }

  const result = await writeWorkspaceFile(
    rootPath,
    AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
    content,
    options?.baseHash
  );
  emitDirty(workspaceId, ctx.eventBus);

  return {
    path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
    exists: true,
    content,
    baseHash: result.newHash,
  } satisfies AgentInstructionsDocument;
}

type EditableSystemAgentInstructionsProviderId = SystemAgentInstructionsProviderId;

type SystemAgentInstructionsTarget = {
  providerId: EditableSystemAgentInstructionsProviderId;
  displayName: string;
  relPath: string;
  displayPath: string;
  absPath: string;
};

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function resolveSystemAgentInstructionsTarget(providerId: string): SystemAgentInstructionsTarget {
  const metadata = SYSTEM_AGENT_INSTRUCTIONS_PATHS[providerId as SystemAgentInstructionsProviderId];
  if (!metadata?.editable || !metadata.relPath) {
    throw {
      code: "agent_system_instructions_unsupported",
      message: `System agent instructions are not supported for provider: ${providerId}`,
    };
  }

  return {
    providerId: providerId as EditableSystemAgentInstructionsProviderId,
    displayName: metadata.displayName,
    relPath: metadata.relPath,
    displayPath: metadata.displayPath,
    absPath: join(homedir(), metadata.relPath),
  };
}

async function exists(path: string): Promise<boolean> {
  try {
    await fsStat(path);
    return true;
  } catch {
    return false;
  }
}

async function readSystemAgentInstructionsDocument(
  providerId: string
): Promise<AgentInstructionsSystemDocument> {
  const target = resolveSystemAgentInstructionsTarget(providerId);

  try {
    const content = await fsReadFile(target.absPath, "utf-8");
    return {
      providerId: target.providerId,
      path: target.relPath,
      displayPath: target.displayPath,
      exists: true,
      content,
      baseHash: hashContent(content),
    };
  } catch {
    return {
      providerId: target.providerId,
      path: target.relPath,
      displayPath: target.displayPath,
      exists: false,
      content: "",
    };
  }
}

async function writeSystemAgentInstructionsDocument(
  providerId: string,
  content: string,
  baseHash?: string
): Promise<AgentInstructionsSystemDocument> {
  const target = resolveSystemAgentInstructionsTarget(providerId);

  if (baseHash) {
    const current = await fsReadFile(target.absPath, "utf-8").catch(() => "");
    const currentHash = hashContent(current);
    if (currentHash !== baseHash) {
      throw {
        code: "conflict",
        message: "File has been modified externally",
        details: {
          expectedHash: baseHash,
          actualHash: currentHash,
        },
      };
    }
  }

  await fsMkdir(dirname(target.absPath), { recursive: true });
  await fsWriteFile(target.absPath, content, "utf-8");

  return {
    providerId: target.providerId,
    path: target.relPath,
    displayPath: target.displayPath,
    exists: true,
    content,
    baseHash: hashContent(content),
  };
}

async function buildSystemStatus(): Promise<AgentInstructionsSystemStatusEntry[]> {
  return Promise.all(
    SYSTEM_AGENT_INSTRUCTIONS_PROVIDER_IDS.map(async (providerId) => {
      const metadata = SYSTEM_AGENT_INSTRUCTIONS_PATHS[providerId];
      const fileExists = await exists(join(homedir(), metadata.relPath));
      return {
        providerId,
        displayName: metadata.displayName,
        path: metadata.relPath,
        displayPath: metadata.displayPath,
        exists: fileExists,
        editable: true,
        status: fileExists ? "ready" : "missing",
      } satisfies AgentInstructionsSystemStatusEntry;
    })
  );
}

export function buildAgentInstructionsSubmitPayload(content: string): string {
  const BRACKETED_PASTE_START = "\x1b[200~";
  const BRACKETED_PASTE_END = "\x1b[201~";
  const SUBMIT = "\r";
  return `${BRACKETED_PASTE_START}${content}${BRACKETED_PASTE_END}${SUBMIT}`;
}

async function buildStatus(
  workspaceId: string,
  rootPath: string
): Promise<AgentInstructionsPanelStatus> {
  const document = await readDocument(
    workspaceId,
    rootPath,
    AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH
  );

  const project = {
    exists: document.exists,
    stale: false,
    path: AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH,
    displayPath: "项目 Agent.md",
  } satisfies AgentInstructionsPanelStatus["project"];

  return {
    project,
    system: await buildSystemStatus(),
    document: project,
  };
}

function emitDirty(workspaceId: string, eventBus: CommandContext["eventBus"]): void {
  eventBus.emit({
    type: "fs.dirty",
    workspaceId,
    reason: "file_content",
  });
}

registerCommand(
  "agentInstructions.read",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    return readDocument(workspace.id, workspace.path, AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH);
  }
);

registerCommand(
  "agentInstructions.generate",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    const { content } = await buildGeneratedDocument(workspace.id, workspace.path);

    return {
      path: AGENT_INSTRUCTIONS_RELATIVE_PATH,
      exists: false,
      content,
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
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    return writeCustomDocument(workspace.id, workspace.path, args.content, ctx, {
      overwrite: args.overwrite,
      baseHash: args.baseHash,
    });
  }
);

registerCommand(
  "agentInstructions.system.status",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    await getWorkspaceOrThrow(args.workspaceId, ctx);
    return buildSystemStatus();
  }
);

registerCommand(
  "agentInstructions.system.read",
  z.object({
    workspaceId: z.string(),
    providerId: z.string(),
  }),
  async (args, ctx) => {
    await getWorkspaceOrThrow(args.workspaceId, ctx);
    return readSystemAgentInstructionsDocument(args.providerId);
  }
);

registerCommand(
  "agentInstructions.system.write",
  z.object({
    workspaceId: z.string(),
    providerId: z.string(),
    content: z.string(),
    baseHash: z.string().optional(),
  }),
  async (args, ctx) => {
    await getWorkspaceOrThrow(args.workspaceId, ctx);
    return writeSystemAgentInstructionsDocument(args.providerId, args.content, args.baseHash);
  }
);

registerCommand(
  "agentInstructions.generateByAgent",
  z.object({
    workspaceId: z.string(),
    providerId: z.string().optional(),
    model: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    const generator = new AgentInstructionsGenerator({
      providerConfigRepo: ctx.providerConfigRepo,
    });

    return generator.generate(workspace.id, workspace.path, ctx.providerRegistry, {
      providerId: args.providerId,
      model: args.model,
    });
  }
);

registerCommand(
  "agentInstructions.generateAndWriteByAgent",
  z.object({
    workspaceId: z.string(),
    providerId: z.string().optional(),
    model: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    const generator = new AgentInstructionsGenerator({
      providerConfigRepo: ctx.providerConfigRepo,
    });
    const generated = await generator.generate(workspace.id, workspace.path, ctx.providerRegistry, {
      providerId: args.providerId,
      model: args.model,
    });
    const document = await writeCustomDocument(
      workspace.id,
      workspace.path,
      generated.content,
      ctx,
      {
        overwrite: true,
      }
    );

    return {
      document,
      meta: generated.meta,
    };
  }
);

registerCommand(
  "agentInstructions.health",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    const document = await readDocument(
      workspace.id,
      workspace.path,
      AGENT_INSTRUCTIONS_CUSTOM_RELATIVE_PATH
    );
    return evaluateAgentInstructionsMarkdown(document.content) satisfies AgentInstructionsHealth;
  }
);

registerCommand(
  "agentInstructions.status",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    return buildStatus(workspace.id, workspace.path);
  }
);

registerCommand(
  "agentInstructions.regenerate",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    const { content } = await buildGeneratedDocument(workspace.id, workspace.path);
    return writeCustomDocument(workspace.id, workspace.path, content, ctx, {
      overwrite: true,
    });
  }
);

registerCommand(
  "agentInstructions.attachToSession",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = await getWorkspaceOrThrow(args.workspaceId, ctx);
    const sessionId = args.sessionId ?? workspace.uiState.activeSessionId;
    if (!sessionId) {
      throw {
        code: "session_not_found",
        message: "No active session is available for attach",
      };
    }

    const session = ctx.sessionMgr.get(sessionId);
    if (!session) {
      throw {
        code: "session_not_found",
        message: `Session not found: ${sessionId}`,
      };
    }
    if (!INJECTABLE_SESSION_STATES.has(session.state)) {
      throw {
        code: "inject_target_unavailable",
        message: `Cannot inject into session ${sessionId}: ${describeNonInjectableState(session.state)}`,
      };
    }

    const effective = await resolveEffectiveAgentInstructions(workspace.id, workspace.path);
    if (!effective) {
      throw {
        code: "agent_instructions_missing",
        message: "No agent instructions are available for this workspace",
      };
    }

    ctx.sessionMgr.sendInput(
      sessionId,
      Buffer.from(buildAgentInstructionsSubmitPayload(effective.content), "utf8"),
      "internal_submit"
    );

    ctx.sessionMetadataRepo?.upsert({
      ...(ctx.sessionMetadataRepo.get(sessionId) ?? {
        sessionId,
        workspaceId: workspace.id,
        providerId: session.providerId,
        verificationRuns: [],
      }),
      sessionId,
      workspaceId: workspace.id,
      providerId: session.providerId,
      attachedAgentInstructions: {
        effectiveHash: effective.effectiveHash,
        mode: "manual",
        attachedAt: Date.now(),
      },
    });

    return {
      injected: true as const,
      sessionId,
      mode: "manual" as const,
      effectiveHash: effective.effectiveHash,
    };
  }
);

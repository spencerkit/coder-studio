/**
 * Session Commands
 */

import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { z } from "zod";
import { registerHostCommand } from "../host/command-registry.js";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import { applyPaneDisposition } from "../workspace/pane-layout.js";
import { executeRuntimeCommandOnTarget, registerCommand } from "../ws/dispatch.js";

function getProviderFromRegistry(
  providerId: string,
  registry: ProviderDefinition[]
): ProviderDefinition | undefined {
  return registry.find((provider) => provider.id === providerId);
}

async function tryReadGitHead(workspacePath: string): Promise<string | undefined> {
  try {
    const gitEntryPath = join(workspacePath, ".git");
    const gitEntry = await readFile(gitEntryPath, "utf8").catch(() => null);

    let gitDir = gitEntryPath;
    if (gitEntry && gitEntry.startsWith("gitdir:")) {
      const relativeGitDir = gitEntry.slice("gitdir:".length).trim();
      gitDir = resolve(workspacePath, relativeGitDir);
    }

    const head = await readFile(join(gitDir, "HEAD"), "utf8");
    const trimmed = head.trim();
    return trimmed.length > 0 && !trimmed.startsWith("ref:") ? trimmed : undefined;
  } catch {
    return undefined;
  }
}

// session.list
registerRuntimeCommand(
  "session.list",
  z.object({
    workspaceId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      return ctx.sessionMgr.getForWorkspace(args.workspaceId);
    },
  }
);

// session.create
registerRuntimeCommand(
  "session.create",
  z.object({
    workspaceId: z.string(),
    providerId: z.string(),
    draft: z.string().optional(),
    themeBackground: z
      .string()
      .regex(/^#[0-9a-fA-F]{3,8}$/)
      .optional(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      const workspace = ctx.workspaceLookup.get(args.workspaceId);
      if (!workspace) {
        throw { code: "workspace_not_found", message: `Workspace not found: ${args.workspaceId}` };
      }

      const provider = getProviderFromRegistry(args.providerId, ctx.providerRegistry);
      if (!provider) {
        throw { code: "unknown_provider", message: `Provider not found: ${args.providerId}` };
      }

      const runtimeStatus = await buildProviderRuntimeStatus([provider], ctx.providerRuntimeDeps);
      const providerStatus = runtimeStatus.providers[provider.id];

      if (!providerStatus?.available) {
        throw {
          code: "provider_cli_missing",
          message: "Provider CLI is not installed",
          details: {
            providerId: provider.id,
            missingCommands: providerStatus?.missingCommands ?? provider.requiredCommands,
          },
        };
      }

      await ctx.agentInstructionPublisher?.syncWorkspace(args.workspaceId);

      const session = await ctx.sessionMgr.create({
        workspaceId: args.workspaceId,
        workspacePath: workspace.path,
        providerId: args.providerId,
        provider,
        draft: args.draft,
        themeBackground: args.themeBackground,
      });

      ctx.sessionMetadataRepo?.upsert({
        sessionId: session.id,
        workspaceId: args.workspaceId,
        providerId: args.providerId,
        objective: args.draft?.trim() || undefined,
        baselineGitHead: await tryReadGitHead(workspace.path),
        baselineCapturedAt: Date.now(),
        verificationRuns: [],
        activityEntries: [],
      });

      return session;
    },
  }
);

// session.stop
registerRuntimeCommand(
  "session.stop",
  z.object({
    sessionId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "session", sessionId: args.sessionId }),
    handler: async (args, ctx) => {
      await ctx.sessionMgr.stop(args.sessionId);
    },
  }
);

// session.remove
registerRuntimeCommand(
  "session.remove",
  z.object({
    sessionId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "session", sessionId: args.sessionId }),
    handler: async (args, ctx) => {
      const session = ctx.sessionMgr.get(args.sessionId);
      if (!session) {
        throw { code: "session_not_found", message: `Session not found: ${args.sessionId}` };
      }

      if (session.state !== "ended") {
        throw {
          code: "invalid_state",
          message: `Cannot remove session in state: ${session.state}`,
        };
      }

      ctx.sessionMgr.delete(args.sessionId);
      ctx.sessionMetadataRepo?.delete(args.sessionId);
    },
  }
);

registerHostCommand(
  "session.close",
  z.object({
    sessionId: z.string(),
    paneDisposition: z.enum(["draft", "remove"]).default("draft"),
  }),
  async (args, ctx) => {
    const session = ctx.sessionMgr?.get?.(args.sessionId);
    const workspaceId =
      ctx.runtimeBindings.findWorkspaceIdBySessionId(args.sessionId) ?? session?.workspaceId;
    if (!workspaceId) {
      throw {
        code: "workspace_not_found",
        message: `Workspace not found for session: ${args.sessionId}`,
      };
    }

    if (session?.state !== "ended") {
      await executeRuntimeCommandOnTarget(
        "session.stop",
        { sessionId: args.sessionId },
        ctx,
        undefined,
        { kind: "session", sessionId: args.sessionId }
      );
    }

    const workspace = ctx.workspaceMgr.get(workspaceId);
    if (!workspace) {
      throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
    }

    const nextUiState = {
      ...workspace.uiState,
      paneLayout: applyPaneDisposition(
        workspace.uiState.paneLayout,
        args.sessionId,
        args.paneDisposition
      ),
    };

    ctx.workspaceMgr.updateUiState(workspaceId, nextUiState);
    await executeRuntimeCommandOnTarget(
      "session.remove",
      { sessionId: args.sessionId },
      ctx,
      undefined,
      { kind: "session", sessionId: args.sessionId }
    );
    ctx.runtimeBindings.removeSession(args.sessionId);
  }
);

registerCommand(
  "session.analysis.get",
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    if (!ctx.sessionAnalysisService) {
      throw {
        code: "session_analysis_unavailable",
        message: "Session analysis service is unavailable",
      };
    }

    return ctx.sessionAnalysisService.get(args.sessionId);
  }
);

registerCommand(
  "session.analysis.run",
  z.object({
    sessionId: z.string(),
    force: z.boolean().optional(),
  }),
  async (args, ctx) => {
    if (!ctx.sessionAnalysisService) {
      throw {
        code: "session_analysis_unavailable",
        message: "Session analysis service is unavailable",
      };
    }

    return await ctx.sessionAnalysisService.run(args);
  }
);

/**
 * Session Commands
 */

import type { ProviderDefinition } from "@coder-studio/core";
import { z } from "zod";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { registerCommand } from "../ws/dispatch.js";

function getProviderFromRegistry(
  providerId: string,
  registry: ProviderDefinition[]
): ProviderDefinition | undefined {
  return registry.find((provider) => provider.id === providerId);
}

// session.list
registerCommand(
  "session.list",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx) => {
    return ctx.sessionMgr.getForWorkspace(args.workspaceId);
  }
);

// session.create
registerCommand(
  "session.create",
  z.object({
    workspaceId: z.string(),
    providerId: z.string(),
    draft: z.string().optional(),
  }),
  async (args, ctx) => {
    // Get workspace
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
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

    return ctx.sessionMgr.create({
      workspaceId: args.workspaceId,
      workspacePath: workspace.path,
      providerId: args.providerId,
      provider,
      draft: args.draft,
    });
  }
);

// session.stop
registerCommand(
  "session.stop",
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    await ctx.sessionMgr.stop(args.sessionId);
  }
);

// session.remove
registerCommand(
  "session.remove",
  z.object({
    sessionId: z.string(),
  }),
  async (args, ctx) => {
    const session = ctx.sessionMgr.get(args.sessionId);
    if (!session) {
      throw { code: "session_not_found", message: `Session not found: ${args.sessionId}` };
    }

    if (session.state !== "ended") {
      throw { code: "invalid_state", message: `Cannot remove session in state: ${session.state}` };
    }

    ctx.sessionMgr.delete(args.sessionId);
  }
);

/**
 * Session Commands
 */

import type { ProviderDefinition } from "@coder-studio/core";
import { z } from "zod";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { withTransaction } from "../storage/database.js";
import { applyPaneDisposition } from "../workspace/pane-layout.js";
import { registerCommand } from "../ws/dispatch.js";

const SESSION_CLOSE_POLL_INTERVAL_MS = 100;
const SESSION_CLOSE_TIMEOUT_MS = 5_000;

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

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

registerCommand(
  "session.close",
  z.object({
    sessionId: z.string(),
    paneDisposition: z.enum(["draft", "remove"]).default("draft"),
  }),
  async (args, ctx) => {
    let session = ctx.sessionMgr.get(args.sessionId);
    if (!session) {
      throw { code: "session_not_found", message: `Session not found: ${args.sessionId}` };
    }

    if (session.state !== "ended") {
      try {
        await ctx.sessionMgr.stop(args.sessionId);
      } catch (error) {
        const candidate = error as { message?: string };
        throw {
          code: "session_close_failed",
          message: candidate.message ?? `Failed to stop session: ${args.sessionId}`,
        };
      }

      const deadline = Date.now() + SESSION_CLOSE_TIMEOUT_MS;
      while (Date.now() < deadline) {
        session = ctx.sessionMgr.get(args.sessionId);
        if (!session) {
          return;
        }
        if (session.state === "ended") {
          break;
        }
        await delay(SESSION_CLOSE_POLL_INTERVAL_MS);
      }

      session = ctx.sessionMgr.get(args.sessionId);
      if (!session) {
        return;
      }
      if (session.state !== "ended") {
        throw {
          code: "session_close_timeout",
          message: `Timed out waiting for session to end before closing: ${args.sessionId}`,
        };
      }
    }

    const workspace = ctx.workspaceMgr.get(session.workspaceId);
    if (!workspace) {
      throw {
        code: "workspace_not_found",
        message: `Workspace not found: ${session.workspaceId}`,
      };
    }

    const nextUiState = {
      ...workspace.uiState,
      paneLayout: applyPaneDisposition(
        workspace.uiState.paneLayout,
        args.sessionId,
        args.paneDisposition
      ),
    };

    withTransaction(ctx.db, () => {
      ctx.workspaceMgr.updateUiState(session.workspaceId, nextUiState);
      ctx.sessionMgr.delete(args.sessionId);
    });
  }
);

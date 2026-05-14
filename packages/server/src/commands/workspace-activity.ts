import type { WorkspaceLastViewedTarget } from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const WORKSPACE_LAST_VIEWED_TARGET_KEY = "workspace.lastViewedTarget";

registerCommand(
  "workspace.activate",
  z.object({
    workspaceId: z.string(),
  }),
  async (args, ctx, clientId) => {
    if (!clientId) {
      return {};
    }

    ctx.autoFetch.registerViewer(clientId, args.workspaceId);
    return {};
  }
);

registerCommand("workspace.deactivate", z.object({}), async (_args, ctx, clientId) => {
  if (!clientId) {
    return {};
  }

  ctx.autoFetch.unregisterViewer(clientId);
  return {};
});

registerCommand("workspace.lastViewedTarget.get", z.object({}), async (_args, ctx) => {
  const row = ctx.db
    .prepare("SELECT value FROM user_settings WHERE key = ?")
    .get(WORKSPACE_LAST_VIEWED_TARGET_KEY) as { value: string } | undefined;

  if (!row) {
    return null;
  }

  const target = JSON.parse(row.value) as WorkspaceLastViewedTarget;
  return {
    workspaceId: target.workspaceId,
    sessionId: target.sessionId,
    updatedAt: target.updatedAt,
  } satisfies WorkspaceLastViewedTarget;
});

registerCommand(
  "workspace.lastViewedTarget.set",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string().optional(),
  }),
  async (args, ctx) => {
    const workspace = ctx.workspaceMgr.get(args.workspaceId);
    if (!workspace) {
      throw {
        code: "workspace_not_found",
        message: `Workspace not found: ${args.workspaceId}`,
      };
    }

    const session = args.sessionId ? ctx.sessionMgr.get(args.sessionId) : undefined;

    const nextTarget: WorkspaceLastViewedTarget = {
      workspaceId: args.workspaceId,
      sessionId: session && session.workspaceId === args.workspaceId ? session.id : undefined,
      updatedAt: Date.now(),
    };

    ctx.db
      .prepare(
        `
          INSERT INTO user_settings (key, value)
          VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value
        `
      )
      .run(WORKSPACE_LAST_VIEWED_TARGET_KEY, JSON.stringify(nextTarget));

    return nextTarget;
  }
);

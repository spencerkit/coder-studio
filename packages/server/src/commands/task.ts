import { z } from "zod";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";
import { discoverTasks } from "../tasks/discovery.js";

const workspaceSchema = z.object({
  workspaceId: z.string(),
});

const taskRunSchema = z.object({
  workspaceId: z.string(),
  taskId: z.string(),
  themeBackground: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/)
    .optional(),
});

function getWorkspaceOrThrow(ctx: RuntimeCommandContext, workspaceId: string) {
  const workspace = ctx.workspaceLookup.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }
  return workspace;
}

registerRuntimeCommand("task.discover", workspaceSchema, {
  resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
  handler: async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
    const tasks = ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
    return { tasks, warnings: result.warnings };
  },
});

registerRuntimeCommand("task.list", workspaceSchema, {
  resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
  handler: async (args, ctx) => {
    getWorkspaceOrThrow(ctx, args.workspaceId);
    const existing = ctx.taskMgr.list(args.workspaceId);
    if (existing.length > 0) {
      return existing;
    }

    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
    return ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
  },
});

registerRuntimeCommand("task.run", taskRunSchema, {
  resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
  handler: async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    if (ctx.taskMgr.list(args.workspaceId).length === 0) {
      const result = await discoverTasks({
        workspaceId: args.workspaceId,
        rootPath: workspace.path,
      });
      ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
    }

    return ctx.taskMgr.run({
      workspaceId: args.workspaceId,
      workspacePath: workspace.path,
      taskId: args.taskId,
      themeBackground: args.themeBackground,
    });
  },
});

registerRuntimeCommand("task.rerun", taskRunSchema, {
  resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
  handler: async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    return ctx.taskMgr.rerun({
      workspaceId: args.workspaceId,
      workspacePath: workspace.path,
      taskId: args.taskId,
      themeBackground: args.themeBackground,
    });
  },
});

registerRuntimeCommand(
  "task.stop",
  z.object({
    workspaceId: z.string(),
    runId: z.string(),
  }),
  {
    resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
    handler: async (args, ctx) => {
      getWorkspaceOrThrow(ctx, args.workspaceId);
      return ctx.taskMgr.stop({ workspaceId: args.workspaceId, runId: args.runId });
    },
  }
);

registerRuntimeCommand("task.history", workspaceSchema, {
  resolveTarget: (args) => ({ kind: "workspace", workspaceId: args.workspaceId }),
  handler: async (args, ctx) => {
    getWorkspaceOrThrow(ctx, args.workspaceId);
    return ctx.taskMgr.history(args.workspaceId);
  },
});

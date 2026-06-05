import { z } from "zod";
import { discoverTasks } from "../tasks/discovery.js";
import { type CommandContext, registerCommand } from "../ws/dispatch.js";

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

function getWorkspaceOrThrow(ctx: CommandContext, workspaceId: string) {
  const workspace = ctx.workspaceMgr.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }
  return workspace;
}

registerCommand("task.discover", workspaceSchema, async (args, ctx) => {
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
  const tasks = ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
  return { tasks, warnings: result.warnings };
});

registerCommand("task.list", workspaceSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  const existing = ctx.taskMgr.list(args.workspaceId);
  if (existing.length > 0) {
    return existing;
  }

  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
  return ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
});

registerCommand("task.run", taskRunSchema, async (args, ctx) => {
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  if (ctx.taskMgr.list(args.workspaceId).length === 0) {
    const result = await discoverTasks({ workspaceId: args.workspaceId, rootPath: workspace.path });
    ctx.taskMgr.setDiscoveredTasks(args.workspaceId, result.tasks);
  }

  return ctx.taskMgr.run({
    workspaceId: args.workspaceId,
    workspacePath: workspace.path,
    taskId: args.taskId,
    themeBackground: args.themeBackground,
  });
});

registerCommand("task.rerun", taskRunSchema, async (args, ctx) => {
  const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
  return ctx.taskMgr.rerun({
    workspaceId: args.workspaceId,
    workspacePath: workspace.path,
    taskId: args.taskId,
    themeBackground: args.themeBackground,
  });
});

registerCommand(
  "task.stop",
  z.object({
    workspaceId: z.string(),
    runId: z.string(),
  }),
  async (args, ctx) => {
    getWorkspaceOrThrow(ctx, args.workspaceId);
    return ctx.taskMgr.stop({ workspaceId: args.workspaceId, runId: args.runId });
  }
);

registerCommand("task.history", workspaceSchema, async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  return ctx.taskMgr.history(args.workspaceId);
});

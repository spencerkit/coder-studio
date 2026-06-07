import { WORKSPACE_LOG_LEVELS, WORKSPACE_STATUS_PILL_STATES } from "@coder-studio/core";
import { z } from "zod";
import type { CommandContext } from "../ws/dispatch.js";
import { registerCommand } from "../ws/dispatch.js";

function requireWorkspaceExtensionStateService(
  ctx: CommandContext
): asserts ctx is CommandContext & {
  workspaceExtensionStateService: NonNullable<CommandContext["workspaceExtensionStateService"]>;
} {
  if (!ctx.workspaceExtensionStateService) {
    throw {
      code: "workspace_extension_state_unavailable",
      message: "Workspace extension state is not configured",
    };
  }
}

const workspaceIdSchema = z.string().trim().min(1);
const keySchema = z.string().trim().min(1);
const optionalTextSchema = z.string().trim().min(1).optional();

registerCommand(
  "workspace.extensionState.list",
  z.object({
    workspaceId: workspaceIdSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.get(args.workspaceId);
  }
);

registerCommand(
  "workspace.extensionState.statusPills.set",
  z.object({
    workspaceId: workspaceIdSchema,
    key: keySchema,
    label: z.string().trim().min(1),
    state: z.enum(WORKSPACE_STATUS_PILL_STATES),
    detail: optionalTextSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.setStatusPill(args);
  }
);

registerCommand(
  "workspace.extensionState.statusPills.list",
  z.object({
    workspaceId: workspaceIdSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.get(args.workspaceId).statusPills;
  }
);

registerCommand(
  "workspace.extensionState.statusPills.clear",
  z.object({
    workspaceId: workspaceIdSchema,
    key: keySchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.clearStatusPill(args);
  }
);

registerCommand(
  "workspace.extensionState.progress.set",
  z.object({
    workspaceId: workspaceIdSchema,
    key: keySchema,
    label: z.string().trim().min(1),
    value: z.number().finite().optional(),
    max: z.number().finite().positive().optional(),
    detail: optionalTextSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.setProgress(args);
  }
);

registerCommand(
  "workspace.extensionState.progress.list",
  z.object({
    workspaceId: workspaceIdSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.get(args.workspaceId).progress;
  }
);

registerCommand(
  "workspace.extensionState.progress.clear",
  z.object({
    workspaceId: workspaceIdSchema,
    key: keySchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.clearProgress(args);
  }
);

registerCommand(
  "workspace.extensionState.logs.append",
  z.object({
    workspaceId: workspaceIdSchema,
    key: keySchema,
    level: z.enum(WORKSPACE_LOG_LEVELS).default("info"),
    message: z.string().trim().min(1),
    timestamp: z.number().finite().optional(),
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.appendLog(args);
  }
);

registerCommand(
  "workspace.extensionState.logs.list",
  z.object({
    workspaceId: workspaceIdSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.get(args.workspaceId).logs;
  }
);

registerCommand(
  "workspace.extensionState.logs.clear",
  z.object({
    workspaceId: workspaceIdSchema,
    key: keySchema.optional(),
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.clearLog(args);
  }
);

registerCommand(
  "workspace.extensionState.quickActions.set",
  z.object({
    workspaceId: workspaceIdSchema,
    id: keySchema,
    label: z.string().trim().min(1),
    command: z.string().trim().min(1),
    description: optionalTextSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.setQuickAction(args);
  }
);

registerCommand(
  "workspace.extensionState.quickActions.list",
  z.object({
    workspaceId: workspaceIdSchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.get(args.workspaceId).quickActions;
  }
);

registerCommand(
  "workspace.extensionState.quickActions.clear",
  z.object({
    workspaceId: workspaceIdSchema,
    id: keySchema,
  }),
  async (args, ctx) => {
    requireWorkspaceExtensionStateService(ctx);
    return ctx.workspaceExtensionStateService.clearQuickAction(args);
  }
);

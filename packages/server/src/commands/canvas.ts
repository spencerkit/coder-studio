import { CanvasPresetIdSchema, createUiActionEvent, Topics } from "@coder-studio/core";
import { z } from "zod";
import { type CommandContext, registerCommand } from "../ws/dispatch.js";

function getWorkspaceOrThrow(ctx: CommandContext, workspaceId: string) {
  const workspace = ctx.workspaceMgr.get(workspaceId);
  if (!workspace) {
    throw { code: "workspace_not_found", message: `Workspace not found: ${workspaceId}` };
  }

  return workspace;
}

function getCanvasServiceOrThrow(ctx: CommandContext) {
  if (!ctx.canvasService) {
    throw { code: "canvas_unavailable", message: "Canvas service is not available" };
  }

  return ctx.canvasService;
}

function broadcastCanvasOpen(
  ctx: CommandContext,
  input: {
    workspaceId: string;
    canvasId: string;
    title: string;
    artifactType: "architecture_canvas" | "report_canvas";
    sourcePath: string;
  }
): void {
  const event = createUiActionEvent({
    request: {
      intent: {
        type: "canvas.open",
        workspaceId: input.workspaceId,
        canvasId: input.canvasId,
        title: input.title,
        artifactType: input.artifactType,
        sourcePath: input.sourcePath,
      },
    },
    workspaceId: input.workspaceId,
    dispatchedAt: Date.now(),
  });

  ctx.broadcaster.broadcast(Topics.workspaceUiAction(input.workspaceId), event);
}

const canvasKindSchema = z.enum(["architecture_canvas", "report_canvas"]);

registerCommand("canvas.list", z.object({ workspaceId: z.string() }), async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  return getCanvasServiceOrThrow(ctx).list(args.workspaceId);
});

registerCommand("canvas.preset.list", z.object({ workspaceId: z.string() }), async (args, ctx) => {
  getWorkspaceOrThrow(ctx, args.workspaceId);
  return getCanvasServiceOrThrow(ctx).listPresets();
});

registerCommand(
  "canvas.create",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string().optional(),
    kind: canvasKindSchema,
    title: z.string(),
    document: z.unknown(),
    openInEditor: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await getCanvasServiceOrThrow(ctx).create({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sessionId: args.sessionId,
      title: args.title,
      kind: args.kind,
      document: args.document,
    });

    if (args.openInEditor) {
      broadcastCanvasOpen(ctx, {
        workspaceId: args.workspaceId,
        canvasId: result.record.id,
        title: result.record.title,
        artifactType: result.record.artifactType,
        sourcePath: result.record.sourcePath,
      });
    }

    return result;
  }
);

registerCommand(
  "canvas.create-from-preset",
  z.object({
    workspaceId: z.string(),
    sessionId: z.string().optional(),
    presetId: CanvasPresetIdSchema,
    title: z.string(),
    openInEditor: z.boolean().optional(),
  }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await getCanvasServiceOrThrow(ctx).createFromPreset({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sessionId: args.sessionId,
      presetId: args.presetId,
      title: args.title,
    });

    if (args.openInEditor) {
      broadcastCanvasOpen(ctx, {
        workspaceId: args.workspaceId,
        canvasId: result.record.id,
        title: result.record.title,
        artifactType: result.record.artifactType,
        sourcePath: result.record.sourcePath,
      });
    }

    return result;
  }
);

registerCommand(
  "canvas.update",
  z.object({
    workspaceId: z.string(),
    canvasId: z.string(),
    title: z.string().optional(),
    document: z.unknown(),
  }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    return getCanvasServiceOrThrow(ctx).update({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      canvasId: args.canvasId,
      title: args.title,
      document: args.document,
    });
  }
);

registerCommand(
  "canvas.snapshot.create",
  z.object({
    workspaceId: z.string(),
    sourcePath: z.string(),
  }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    return getCanvasServiceOrThrow(ctx).createSnapshot({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sourcePath: args.sourcePath,
    });
  }
);

registerCommand(
  "canvas.clone",
  z
    .object({
      workspaceId: z.string(),
      sessionId: z.string().optional(),
      sourcePath: z.string().optional(),
      snapshotId: z.string().optional(),
      title: z.string(),
      openInEditor: z.boolean().optional(),
    })
    .refine((value) => Boolean(value.sourcePath || value.snapshotId), {
      message: "sourcePath or snapshotId is required",
    }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const result = await getCanvasServiceOrThrow(ctx).cloneCanvas({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sessionId: args.sessionId,
      sourcePath: args.sourcePath,
      snapshotId: args.snapshotId,
      title: args.title,
    });

    if (args.openInEditor) {
      broadcastCanvasOpen(ctx, {
        workspaceId: args.workspaceId,
        canvasId: result.record.id,
        title: result.record.title,
        artifactType: result.record.artifactType,
        sourcePath: result.record.sourcePath,
      });
    }

    return result;
  }
);

registerCommand(
  "canvas.render",
  z
    .object({
      workspaceId: z.string(),
      canvasId: z.string().optional(),
      sourcePath: z.string().optional(),
    })
    .refine((value) => Boolean(value.canvasId || value.sourcePath), {
      message: "canvasId or sourcePath is required",
    }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const canvasService = getCanvasServiceOrThrow(ctx);
    const sourcePath =
      args.sourcePath ??
      (args.canvasId
        ? canvasService.getRecord(args.workspaceId, args.canvasId)?.sourcePath
        : undefined);

    if (!sourcePath) {
      throw {
        code: "canvas_not_found",
        message: `Canvas not found: ${args.canvasId ?? args.sourcePath ?? "unknown"}`,
      };
    }

    const result = await canvasService.getCanvasData({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sourcePath,
    });

    return result;
  }
);

registerCommand(
  "canvas.inspect",
  z
    .object({
      workspaceId: z.string(),
      canvasId: z.string().optional(),
      sourcePath: z.string().optional(),
    })
    .refine((value) => Boolean(value.canvasId || value.sourcePath), {
      message: "canvasId or sourcePath is required",
    }),
  async (args, ctx) => {
    const workspace = getWorkspaceOrThrow(ctx, args.workspaceId);
    const canvasService = getCanvasServiceOrThrow(ctx);
    const sourcePath =
      args.sourcePath ??
      (args.canvasId
        ? canvasService.getRecord(args.workspaceId, args.canvasId)?.sourcePath
        : undefined);

    if (!sourcePath) {
      throw {
        code: "canvas_not_found",
        message: `Canvas not found: ${args.canvasId ?? args.sourcePath ?? "unknown"}`,
      };
    }

    return canvasService.getCanvasInspectionData({
      workspaceId: args.workspaceId,
      workspaceRootPath: workspace.path,
      sourcePath,
    });
  }
);

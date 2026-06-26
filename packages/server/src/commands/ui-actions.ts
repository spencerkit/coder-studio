import {
  type AutomationPermission,
  createUiActionDispatchResult,
  createUiActionEvent,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listUiActionCapabilities,
  normalizeUiActionDispatchRequest,
  resolveUiActionWorkspaceId,
  Topics,
} from "@coder-studio/core";
import { z } from "zod";
import { getSessionTokenRequestAuthContext, registerCommand } from "../ws/dispatch.js";

const uiActionIntentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("editor.openFile"),
    workspaceId: z.string().optional(),
    path: z.string(),
    line: z.number().int().optional(),
    column: z.number().int().optional(),
    target: z
      .union([z.literal("active"), z.literal("newPane"), z.object({ paneId: z.string() })])
      .optional(),
  }),
  z.object({
    type: z.literal("editor.closeFile"),
    workspaceId: z.string().optional(),
    path: z.string(),
  }),
  z.object({
    type: z.literal("browser.openUrl"),
    workspaceId: z.string().optional(),
    url: z.string(),
    target: z.union([z.literal("preview"), z.literal("external")]).optional(),
  }),
  z.object({
    type: z.literal("browser.closeUrl"),
    workspaceId: z.string().optional(),
    url: z.string(),
  }),
  z
    .object({
      type: z.literal("canvas.open"),
      workspaceId: z.string().optional(),
      canvasId: z.string().optional(),
      title: z.string().optional(),
      artifactType: z.enum(["architecture_canvas", "report_canvas"]).optional(),
      sourcePath: z.string().optional(),
    })
    .refine((value) => Boolean(value.canvasId?.trim() || value.sourcePath?.trim()), {
      message: "canvas.open requires canvasId or sourcePath",
    }),
  z.object({
    type: z.literal("workspace.focus"),
    workspaceId: z.string(),
  }),
  z.object({
    type: z.literal("panel.show"),
    workspaceId: z.string().optional(),
    panel: z.enum(["terminal", "explorer", "search", "git", "skills", "agentInstructions"]),
  }),
  z.object({
    type: z.literal("command.run"),
    commandId: z.enum(["quickOpen.open", "commandPalette.open"]),
    args: z.record(z.string(), z.unknown()).optional(),
  }),
]);

const uiActionDispatchSchema = z.object({
  workspaceId: z.string().optional(),
  intent: uiActionIntentSchema,
  requestId: z.string().optional(),
  source: z
    .object({
      kind: z.enum(["agent", "user", "system"]),
      sessionId: z.string().optional(),
      providerId: z.string().optional(),
    })
    .optional(),
});

registerCommand(
  "uiAction.capabilities",
  z.object({
    permissions: z.array(z.string()).optional(),
  }),
  async (args, ctx, clientId) => {
    const authContext = getSessionTokenRequestAuthContext(ctx, clientId);
    const permissions = !authContext
      ? (args.permissions ?? DEFAULT_AGENT_AUTOMATION_PERMISSIONS)
      : !args.permissions
        ? authContext.permissions
        : args.permissions.filter((permission) =>
            new Set<AutomationPermission>(authContext.permissions).has(
              permission as AutomationPermission
            )
          );

    return {
      version: 1,
      actions: listUiActionCapabilities({
        permissions,
      }),
    };
  }
);

registerCommand("uiAction.dispatch", uiActionDispatchSchema, async (args, ctx, clientId) => {
  const authContext = getSessionTokenRequestAuthContext(ctx, clientId);
  const fallbackWorkspaceId = args.workspaceId ?? authContext?.workspaceId;
  const { intent } = args;
  const request =
    intent.type === "canvas.open"
      ? await (async () => {
          if (!ctx.canvasService) {
            throw {
              code: "canvas_unavailable",
              message: "Canvas service is not available",
            };
          }

          const workspaceId = intent.workspaceId?.trim() || fallbackWorkspaceId;
          if (!workspaceId) {
            throw new Error("workspaceId is required for this UI action");
          }

          const workspace = ctx.workspaceMgr.get(workspaceId);
          if (!workspace) {
            throw {
              code: "workspace_not_found",
              message: `Workspace not found: ${workspaceId}`,
            };
          }

          const compatibilityCanvasId = intent.canvasId?.trim();
          const compatibilityRecord = compatibilityCanvasId
            ? ctx.canvasService.getRecord(workspaceId, compatibilityCanvasId)
            : undefined;
          const sourcePath = compatibilityRecord?.sourcePath ?? intent.sourcePath?.trim();

          if (!sourcePath) {
            throw {
              code: "canvas_not_found",
              message: `Canvas not found: ${intent.canvasId ?? "unknown"}`,
            };
          }

          const canvasData = await ctx.canvasService.getCanvasData({
            workspaceId,
            workspaceRootPath: workspace.path,
            sourcePath,
          });

          return normalizeUiActionDispatchRequest({
            intent: {
              type: "canvas.open" as const,
              workspaceId,
              ...(canvasData.canvasId ? { canvasId: canvasData.canvasId } : {}),
              title: canvasData.title,
              artifactType: canvasData.kind,
              sourcePath: canvasData.sourcePath,
            },
            requestId: args.requestId,
            source: args.source,
          });
        })()
      : normalizeUiActionDispatchRequest({
          intent,
          requestId: args.requestId,
          source: args.source,
        });
  const workspaceId = resolveUiActionWorkspaceId(request, fallbackWorkspaceId);
  const event = createUiActionEvent({
    request,
    workspaceId,
    dispatchedAt: Date.now(),
  });
  const topic = Topics.workspaceUiAction(workspaceId);

  ctx.broadcaster.broadcast(topic, event);

  return createUiActionDispatchResult(event);
});

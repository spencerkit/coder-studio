import {
  createUiActionDispatchResult,
  createUiActionEvent,
  DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
  listUiActionCapabilities,
  normalizeUiActionDispatchRequest,
  resolveUiActionWorkspaceId,
  Topics,
} from "@coder-studio/core";
import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

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
  async (args) => ({
    version: 1,
    actions: listUiActionCapabilities({
      permissions: args.permissions ?? DEFAULT_AGENT_AUTOMATION_PERMISSIONS,
    }),
  })
);

registerCommand("uiAction.dispatch", uiActionDispatchSchema, async (args, ctx) => {
  const request = normalizeUiActionDispatchRequest({
    intent: args.intent,
    requestId: args.requestId,
    source: args.source,
  });
  const workspaceId = resolveUiActionWorkspaceId(request, args.workspaceId);
  const event = createUiActionEvent({
    request,
    workspaceId,
    dispatchedAt: Date.now(),
  });
  const topic = Topics.workspaceUiAction(workspaceId);

  ctx.broadcaster.broadcast(topic, event);

  return createUiActionDispatchResult(event);
});

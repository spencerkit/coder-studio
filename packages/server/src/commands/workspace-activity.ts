import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

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

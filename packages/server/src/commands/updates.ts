import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("updates.getState", z.object({}).default({}), async (_args, ctx) => {
  if (!ctx.updateService) {
    throw {
      code: "update_unavailable",
      message: "Update service is not available",
    };
  }
  return ctx.updateService.getStateView();
});

registerCommand("updates.check", z.object({}).default({}), async (_args, ctx) => {
  if (!ctx.updateService) {
    throw {
      code: "update_unavailable",
      message: "Update service is not available",
    };
  }
  return await ctx.updateService.checkForUpdates({ manual: true });
});

registerCommand("updates.prepareInstall", z.object({}).default({}), async (_args, ctx) => {
  if (!ctx.updateService) {
    throw {
      code: "update_unavailable",
      message: "Update service is not available",
    };
  }
  return ctx.updateService.prepareInstall();
});

registerCommand(
  "updates.startInstall",
  z.object({
    targetVersion: z.string().optional(),
    force: z.boolean().optional(),
  }),
  async (args, ctx) => {
    if (!ctx.updateService) {
      throw {
        code: "update_unavailable",
        message: "Update service is not available",
      };
    }
    return await ctx.updateService.startInstall(args);
  }
);

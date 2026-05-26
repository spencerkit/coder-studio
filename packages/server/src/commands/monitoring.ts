import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

function resolveMonitoringService(
  ctx: Parameters<typeof registerCommand>[2] extends (
    args: never,
    ctx: infer T,
    clientId?: string
  ) => Promise<unknown>
    ? T
    : never
) {
  if (!ctx.monitoringService) {
    throw Object.assign(new Error("Monitoring service unavailable"), {
      code: "monitoring_unavailable",
    });
  }

  return ctx.monitoringService;
}

registerCommand("monitoring.get", z.object({}).default({}), async (_args, ctx) => {
  return resolveMonitoringService(ctx).getResponse();
});

registerCommand("monitoring.recheck", z.object({}).default({}), async (_args, ctx) => {
  return await resolveMonitoringService(ctx).recheck();
});

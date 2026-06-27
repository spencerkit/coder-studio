import { z } from "zod";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import { resolveOptionalRuntimeTarget } from "../runtime/targeting.js";
import type { WorkAnalysisService } from "../work-analysis/service.js";
import { registerCommand } from "../ws/dispatch.js";

const workAnalysisQuerySchema = z.object({
  workspaceId: z.string().optional(),
  runtimeId: z.string().optional(),
  workspacePaths: z.array(z.string().trim().min(1)).optional(),
  timeRange: z.union([
    z.object({ preset: z.enum(["24h", "7d", "30d", "90d"]) }),
    z.object({ startAt: z.number(), endAt: z.number() }),
  ]),
});

type WorkAnalysisServiceLike = Pick<
  WorkAnalysisService,
  "get" | "runBasic" | "runDeep" | "getDashboard" | "refreshDashboard" | "rebuildDashboardIndex"
>;

async function ensureWorkAnalysisService<T>(
  ctx: {
    workAnalysisService?: WorkAnalysisServiceLike;
  },
  action: (service: WorkAnalysisServiceLike) => Promise<T> | T
): Promise<T> {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return action(ctx.workAnalysisService);
}

registerCommand("work.analysis.get", workAnalysisQuerySchema, async (args, ctx) => {
  if (args.workspaceId || args.runtimeId) {
    return ctx.runtimeRouter.executeOnTarget(
      resolveOptionalRuntimeTarget(args),
      "work.analysis.get",
      args
    );
  }

  return ensureWorkAnalysisService(ctx, (service) => service.get(args));
});

registerCommand("work.analysis.runBasic", workAnalysisQuerySchema, async (args, ctx) => {
  if (args.workspaceId || args.runtimeId) {
    return ctx.runtimeRouter.executeOnTarget(
      resolveOptionalRuntimeTarget(args),
      "work.analysis.runBasic",
      args
    );
  }

  return ensureWorkAnalysisService(ctx, (service) => service.runBasic(args));
});

registerCommand("work.analysis.runDeep", workAnalysisQuerySchema, async (args, ctx) => {
  if (args.workspaceId || args.runtimeId) {
    return ctx.runtimeRouter.executeOnTarget(
      resolveOptionalRuntimeTarget(args),
      "work.analysis.runDeep",
      args
    );
  }

  return ensureWorkAnalysisService(ctx, (service) => service.runDeep(args));
});

registerCommand("work.analysis.dashboard.get", workAnalysisQuerySchema, async (args, ctx) => {
  if (args.workspaceId || args.runtimeId) {
    return ctx.runtimeRouter.executeOnTarget(
      resolveOptionalRuntimeTarget(args),
      "work.analysis.dashboard.get",
      args
    );
  }

  return ensureWorkAnalysisService(ctx, (service) => service.getDashboard(args));
});

registerCommand("work.analysis.dashboard.refresh", workAnalysisQuerySchema, async (args, ctx) => {
  if (args.workspaceId || args.runtimeId) {
    return ctx.runtimeRouter.executeOnTarget(
      resolveOptionalRuntimeTarget(args),
      "work.analysis.dashboard.refresh",
      args
    );
  }

  return ensureWorkAnalysisService(ctx, (service) => service.refreshDashboard(args, "manual"));
});

registerCommand("work.analysis.dashboard.rebuild", workAnalysisQuerySchema, async (args, ctx) => {
  if (args.workspaceId || args.runtimeId) {
    return ctx.runtimeRouter.executeOnTarget(
      resolveOptionalRuntimeTarget(args),
      "work.analysis.dashboard.rebuild",
      args
    );
  }

  return ensureWorkAnalysisService(ctx, (service) => service.rebuildDashboardIndex(args));
});

registerRuntimeCommand("work.analysis.get", workAnalysisQuerySchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (args, ctx) => ensureWorkAnalysisService(ctx, (service) => service.get(args)),
});

registerRuntimeCommand("work.analysis.runBasic", workAnalysisQuerySchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (args, ctx) => ensureWorkAnalysisService(ctx, (service) => service.runBasic(args)),
});

registerRuntimeCommand("work.analysis.runDeep", workAnalysisQuerySchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (args, ctx) => ensureWorkAnalysisService(ctx, (service) => service.runDeep(args)),
});

registerRuntimeCommand("work.analysis.dashboard.get", workAnalysisQuerySchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (args, ctx) =>
    ensureWorkAnalysisService(ctx, (service) => service.getDashboard(args)),
});

registerRuntimeCommand("work.analysis.dashboard.refresh", workAnalysisQuerySchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (args, ctx) =>
    ensureWorkAnalysisService(ctx, (service) => service.refreshDashboard(args, "manual")),
});

registerRuntimeCommand("work.analysis.dashboard.rebuild", workAnalysisQuerySchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (args, ctx) =>
    ensureWorkAnalysisService(ctx, (service) => service.rebuildDashboardIndex(args)),
});

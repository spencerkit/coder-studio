import { z } from "zod";
import { registerCommand } from "../ws/dispatch.js";

const workAnalysisQuerySchema = z.object({
  workspacePaths: z.array(z.string().trim().min(1)).optional(),
  timeRange: z.union([
    z.object({ preset: z.enum(["24h", "7d", "30d", "90d"]) }),
    z.object({ startAt: z.number(), endAt: z.number() }),
  ]),
});

registerCommand("work.analysis.get", workAnalysisQuerySchema, async (args, ctx) => {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return ctx.workAnalysisService.get(args);
});

registerCommand("work.analysis.runBasic", workAnalysisQuerySchema, async (args, ctx) => {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return await ctx.workAnalysisService.runBasic(args);
});

registerCommand("work.analysis.runDeep", workAnalysisQuerySchema, async (args, ctx) => {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return await ctx.workAnalysisService.runDeep(args);
});

registerCommand("work.analysis.dashboard.get", workAnalysisQuerySchema, async (args, ctx) => {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return ctx.workAnalysisService.getDashboard(args);
});

registerCommand("work.analysis.dashboard.refresh", workAnalysisQuerySchema, async (args, ctx) => {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return await ctx.workAnalysisService.refreshDashboard(args, "manual");
});

registerCommand("work.analysis.dashboard.rebuild", workAnalysisQuerySchema, async (args, ctx) => {
  if (!ctx.workAnalysisService) {
    throw {
      code: "work_analysis_unavailable",
      message: "Work analysis service is unavailable",
    };
  }

  return await ctx.workAnalysisService.rebuildDashboardIndex(args);
});

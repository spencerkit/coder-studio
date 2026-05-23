import { SYSTEM_DEPENDENCY_IDS, type SystemDependencyInstallJobSnapshot } from "@coder-studio/core";
import { z } from "zod";
import { buildSystemDependencyRuntimeStatus } from "../system-deps/runtime-status.js";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("systemDeps.runtimeStatus", z.object({}), async (_args, ctx) => {
  return buildSystemDependencyRuntimeStatus(ctx.providerRuntimeDeps);
});

registerCommand(
  "systemDeps.install.start",
  z.object({
    dependencyId: z.enum(SYSTEM_DEPENDENCY_IDS),
  }),
  async (args, ctx, clientId) => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }

    return ctx.systemDependencyInstallMgr.start(args.dependencyId, clientId);
  }
);

registerCommand(
  "systemDeps.install.get",
  z.object({
    jobId: z.string(),
  }),
  async (args, ctx, clientId): Promise<SystemDependencyInstallJobSnapshot> => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }

    const job = ctx.systemDependencyInstallMgr.get(args.jobId, clientId);
    if (!job) {
      throw {
        code: "system_dependency_install_job_not_found",
        message: `Install job not found: ${args.jobId}`,
      };
    }

    return job;
  }
);

registerCommand(
  "systemDeps.install.input",
  z.object({
    jobId: z.string(),
    text: z.string(),
  }),
  async (args, ctx, clientId) => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }

    return ctx.systemDependencyInstallMgr.submitInput(args.jobId, clientId, args.text);
  }
);

registerCommand(
  "systemDeps.install.cancel",
  z.object({
    jobId: z.string(),
  }),
  async (args, ctx, clientId) => {
    if (!ctx.systemDependencyInstallMgr) {
      throw {
        code: "system_dependency_install_unavailable",
        message: "System dependency install manager not configured",
      };
    }

    return ctx.systemDependencyInstallMgr.cancel(args.jobId, clientId);
  }
);

import { SYSTEM_DEPENDENCY_IDS, type SystemDependencyInstallJobSnapshot } from "@coder-studio/core";
import { z } from "zod";
import { buildSystemDependencyRuntimeStatus } from "../system-deps/runtime-status.js";
import type { CommandContext } from "../ws/dispatch.js";
import { registerCommand } from "../ws/dispatch.js";

function resolveInstallOwnerId(ctx: CommandContext, clientId?: string): string | undefined {
  if (!clientId) {
    return undefined;
  }

  const activeLease = ctx.activationMgr?.getLease?.();
  if (activeLease?.wsClientId === clientId) {
    return activeLease.clientInstanceId;
  }

  return clientId;
}

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

    const ownerId = resolveInstallOwnerId(ctx, clientId);
    return ctx.systemDependencyInstallMgr.start(args.dependencyId, ownerId, clientId);
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

    const ownerId = resolveInstallOwnerId(ctx, clientId);
    const job = ctx.systemDependencyInstallMgr.get(args.jobId, ownerId, clientId);
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

    const ownerId = resolveInstallOwnerId(ctx, clientId);
    return ctx.systemDependencyInstallMgr.submitInput(args.jobId, ownerId, args.text, clientId);
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

    const ownerId = resolveInstallOwnerId(ctx, clientId);
    return ctx.systemDependencyInstallMgr.cancel(args.jobId, ownerId, clientId);
  }
);

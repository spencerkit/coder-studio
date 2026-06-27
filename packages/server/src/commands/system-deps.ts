import { SYSTEM_DEPENDENCY_IDS, type SystemDependencyInstallJobSnapshot } from "@coder-studio/core";
import { z } from "zod";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import type { RuntimeCommandContext } from "../runtime/context.js";
import type { RuntimeExecuteMeta } from "../runtime/contract.js";
import { resolveOptionalRuntimeTarget } from "../runtime/targeting.js";
import { buildSystemDependencyRuntimeStatus } from "../system-deps/runtime-status.js";

function resolveOwnerId(ctx: RuntimeCommandContext, meta?: RuntimeExecuteMeta): string | undefined {
  if (meta?.clientOwnerId) {
    return meta.clientOwnerId;
  }

  const clientId = meta?.clientId;
  if (!clientId) {
    return undefined;
  }

  return ctx.hostBridge.resolveClientOwnerId?.(clientId) ?? clientId;
}

const runtimeTargetSchema = z.object({
  workspaceId: z.string().optional(),
  runtimeId: z.string().optional(),
});

registerRuntimeCommand("systemDeps.runtimeStatus", runtimeTargetSchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (_args, ctx) => {
    return buildSystemDependencyRuntimeStatus(ctx.providerRuntimeDeps);
  },
});

registerRuntimeCommand(
  "systemDeps.install.start",
  z.object({
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
    dependencyId: z.enum(SYSTEM_DEPENDENCY_IDS),
  }),
  {
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx, meta) => {
      if (!ctx.systemDependencyInstallMgr) {
        throw {
          code: "system_dependency_install_unavailable",
          message: "System dependency install manager not configured",
        };
      }

      const ownerId = resolveOwnerId(ctx, meta);
      return ctx.systemDependencyInstallMgr.start(args.dependencyId, ownerId, meta?.clientId);
    },
  }
);

registerRuntimeCommand(
  "systemDeps.install.get",
  z.object({
    jobId: z.string(),
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
  }),
  {
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx, meta): Promise<SystemDependencyInstallJobSnapshot> => {
      if (!ctx.systemDependencyInstallMgr) {
        throw {
          code: "system_dependency_install_unavailable",
          message: "System dependency install manager not configured",
        };
      }

      const ownerId = resolveOwnerId(ctx, meta);
      const job = ctx.systemDependencyInstallMgr.get(args.jobId, ownerId, meta?.clientId);
      if (!job) {
        throw {
          code: "system_dependency_install_job_not_found",
          message: `Install job not found: ${args.jobId}`,
        };
      }

      return job;
    },
  }
);

registerRuntimeCommand(
  "systemDeps.install.input",
  z.object({
    jobId: z.string(),
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
    text: z.string(),
  }),
  {
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx, meta) => {
      if (!ctx.systemDependencyInstallMgr) {
        throw {
          code: "system_dependency_install_unavailable",
          message: "System dependency install manager not configured",
        };
      }

      const ownerId = resolveOwnerId(ctx, meta);
      return ctx.systemDependencyInstallMgr.submitInput(
        args.jobId,
        ownerId,
        args.text,
        meta?.clientId
      );
    },
  }
);

registerRuntimeCommand(
  "systemDeps.install.cancel",
  z.object({
    jobId: z.string(),
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
  }),
  {
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx, meta) => {
      if (!ctx.systemDependencyInstallMgr) {
        throw {
          code: "system_dependency_install_unavailable",
          message: "System dependency install manager not configured",
        };
      }

      const ownerId = resolveOwnerId(ctx, meta);
      return ctx.systemDependencyInstallMgr.cancel(args.jobId, ownerId, meta?.clientId);
    },
  }
);

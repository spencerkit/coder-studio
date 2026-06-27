import { providerSupportsAgentInstructionsGeneration } from "@coder-studio/core";
import { toProviderListItem } from "@coder-studio/providers";
import { z } from "zod";
import { getProviderByIdOrThrow, mergeProviderConfigs } from "../provider-runtime/config.js";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { registerRuntimeCommand } from "../runtime/command-registry.js";
import { resolveOptionalRuntimeTarget } from "../runtime/targeting.js";
import { registerCommand } from "../ws/dispatch.js";

const providerRuntimeTargetSchema = z.object({
  workspaceId: z.string().optional(),
  runtimeId: z.string().optional(),
});

registerCommand("provider.list", z.object({}), async (_args, ctx) => {
  return ctx.providerRegistry.map((provider) => ({
    ...toProviderListItem(provider),
    supportsAgentInstructionsGeneration: providerSupportsAgentInstructionsGeneration(provider),
  }));
});

registerRuntimeCommand("provider.runtimeStatus", providerRuntimeTargetSchema, {
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (_args, ctx) => {
    return buildProviderRuntimeStatus(ctx.providerRegistry, ctx.providerRuntimeDeps);
  },
});

registerRuntimeCommand("provider.config.getAll", providerRuntimeTargetSchema, {
  visibility: "internal",
  resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
  handler: async (_args, ctx) => ctx.providerConfigRepo.getAll(),
});

registerRuntimeCommand(
  "provider.config.merge",
  z.object({
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
    providerId: z.string(),
    config: z.record(z.string(), z.unknown()),
  }),
  {
    visibility: "internal",
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx) => {
      const provider = getProviderByIdOrThrow(ctx.providerRegistry, args.providerId);
      const merged = mergeProviderConfigs(
        provider,
        ctx.providerConfigRepo.get(args.providerId),
        args.config
      );
      ctx.providerConfigRepo.set(args.providerId, merged);
      return merged;
    },
  }
);

registerRuntimeCommand(
  "provider.previewCommand",
  z.object({
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
    providerId: z.string(),
    config: z.record(z.string(), z.unknown()),
    workspacePath: z.string().optional(),
  }),
  {
    visibility: "internal",
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx) => {
      const provider = getProviderByIdOrThrow(ctx.providerRegistry, args.providerId);
      const command = provider.buildCommand(
        mergeProviderConfigs(provider, ctx.providerConfigRepo.get(provider.id), args.config),
        {
          sessionId: "preview-session",
          workspacePath: args.workspacePath ?? process.cwd(),
        }
      );

      return {
        argv: command.argv,
        cwd: command.cwd,
        env: command.env,
        preview: `${command.argv.join(" ")}${command.cwd ? `  # cwd=${command.cwd}` : ""}`,
      };
    },
  }
);

registerRuntimeCommand(
  "provider.install.start",
  z.object({
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
    providerId: z.string(),
  }),
  {
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx) => {
      if (!ctx.providerInstallMgr) {
        throw {
          code: "provider_install_unavailable",
          message: "Provider install manager not configured",
        };
      }

      return ctx.providerInstallMgr.start(args.providerId);
    },
  }
);

registerRuntimeCommand(
  "provider.install.get",
  z.object({
    jobId: z.string(),
    workspaceId: z.string().optional(),
    runtimeId: z.string().optional(),
  }),
  {
    resolveTarget: (args) => resolveOptionalRuntimeTarget(args),
    handler: async (args, ctx) => {
      if (!ctx.providerInstallMgr) {
        throw {
          code: "provider_install_unavailable",
          message: "Provider install manager not configured",
        };
      }

      const job = ctx.providerInstallMgr.get(args.jobId);
      if (!job) {
        throw {
          code: "provider_install_job_not_found",
          message: `Install job not found: ${args.jobId}`,
        };
      }

      return job;
    },
  }
);

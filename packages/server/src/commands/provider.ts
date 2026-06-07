import { providerSupportsAgentInstructionsGeneration } from "@coder-studio/core";
import { toProviderListItem } from "@coder-studio/providers";
import { z } from "zod";
import { buildProviderRuntimeStatus } from "../provider-runtime/runtime-status.js";
import { registerCommand } from "../ws/dispatch.js";

registerCommand("provider.list", z.object({}), async (_args, ctx) => {
  return ctx.providerRegistry.map((provider) => ({
    ...toProviderListItem(provider),
    supportsAgentInstructionsGeneration: providerSupportsAgentInstructionsGeneration(provider),
  }));
});

registerCommand("provider.runtimeStatus", z.object({}), async (_args, ctx) => {
  return buildProviderRuntimeStatus(ctx.providerRegistry, ctx.providerRuntimeDeps);
});

registerCommand(
  "provider.install.start",
  z.object({
    providerId: z.string(),
  }),
  async (args, ctx) => {
    if (!ctx.providerInstallMgr) {
      throw {
        code: "provider_install_unavailable",
        message: "Provider install manager not configured",
      };
    }

    return ctx.providerInstallMgr.start(args.providerId);
  }
);

registerCommand(
  "provider.install.get",
  z.object({
    jobId: z.string(),
  }),
  async (args, ctx) => {
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
  }
);

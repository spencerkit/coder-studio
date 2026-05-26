import type { CustomProviderConfig } from "@coder-studio/core";
import { toProviderListItem } from "@coder-studio/providers";
import { z } from "zod";
import {
  buildCustomProviderDefinition,
  removeProviderDefinition,
  upsertProviderDefinition,
} from "../provider-runtime/custom-provider.js";
import { registerCommand } from "../ws/dispatch.js";

const CapabilitySchema = z.object({
  key: z.enum([
    "interactive_session",
    "supervisor_eval",
    "idle_detection",
    "context_attach",
    "review",
  ]),
  supported: z.boolean(),
  label: z.string().min(1),
});

const BaseCustomProviderInputSchema = z.object({
  id: z
    .string()
    .trim()
    .min(1)
    .regex(/^[a-z0-9][a-z0-9-_]*$/),
  displayName: z.string().trim().min(1),
  command: z.string().trim().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  cwdMode: z.literal("workspace_root"),
  sessionMode: z.literal("interactive"),
  startupPrompt: z.string().optional(),
  capabilities: z.array(CapabilitySchema).min(1),
});

function requireCustomProviderSupport(ctx: {
  customProviderRepo?: unknown;
  setProviderRegistry?: unknown;
}): asserts ctx is {
  customProviderRepo: NonNullable<typeof ctx.customProviderRepo>;
  setProviderRegistry: NonNullable<typeof ctx.setProviderRegistry>;
} {
  if (!ctx.customProviderRepo || !ctx.setProviderRegistry) {
    throw {
      code: "custom_provider_unavailable",
      message: "Custom provider runtime is not configured",
    };
  }
}

function materializeConfig(
  input: z.infer<typeof BaseCustomProviderInputSchema>,
  previous?: CustomProviderConfig
): CustomProviderConfig {
  const now = Date.now();
  return {
    ...input,
    startupPrompt: input.startupPrompt?.trim() || undefined,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
}

registerCommand("customProvider.list", z.object({}), async (_args, ctx) => {
  requireCustomProviderSupport(ctx);
  return ctx.customProviderRepo
    .list()
    .map((config) => toProviderListItem(buildCustomProviderDefinition(config)));
});

registerCommand("customProvider.create", BaseCustomProviderInputSchema, async (args, ctx) => {
  requireCustomProviderSupport(ctx);

  if (ctx.providerRegistry.some((provider) => provider.id === args.id)) {
    throw {
      code: "custom_provider_exists",
      message: `Provider already exists: ${args.id}`,
    };
  }

  const config = materializeConfig(args);
  const saved = ctx.customProviderRepo.set(config);
  const definition = buildCustomProviderDefinition(saved);
  ctx.setProviderRegistry(upsertProviderDefinition(ctx.providerRegistry, definition));

  return toProviderListItem(definition);
});

registerCommand("customProvider.update", BaseCustomProviderInputSchema, async (args, ctx) => {
  requireCustomProviderSupport(ctx);

  const existing = ctx.customProviderRepo.get(args.id);
  if (!existing) {
    throw {
      code: "custom_provider_not_found",
      message: `Custom provider not found: ${args.id}`,
    };
  }

  const saved = ctx.customProviderRepo.set(materializeConfig(args, existing));
  const definition = buildCustomProviderDefinition(saved);
  ctx.setProviderRegistry(upsertProviderDefinition(ctx.providerRegistry, definition));

  return toProviderListItem(definition);
});

registerCommand(
  "customProvider.delete",
  z.object({
    id: z.string().trim().min(1),
  }),
  async (args, ctx) => {
    requireCustomProviderSupport(ctx);

    const existing = ctx.customProviderRepo.get(args.id);
    if (!existing) {
      throw {
        code: "custom_provider_not_found",
        message: `Custom provider not found: ${args.id}`,
      };
    }

    ctx.customProviderRepo.delete(args.id);
    ctx.setProviderRegistry(removeProviderDefinition(ctx.providerRegistry, args.id));
    return { deleted: true, id: args.id };
  }
);

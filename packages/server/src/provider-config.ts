import type { ProviderConfig, ProviderDefinition } from '@coder-studio/core';
import { z } from 'zod';

export const SUPPORTED_PROVIDER_IDS = ['claude', 'codex'] as const;

const supportedProviderIds = new Set<string>(SUPPORTED_PROVIDER_IDS);

export const ProviderLaunchConfigInputSchema = z.object({
  additionalArgs: z.array(z.string()).optional(),
}).strict();

export const ProviderSettingsSchema = z.object({
  claude: ProviderLaunchConfigInputSchema.optional(),
  codex: ProviderLaunchConfigInputSchema.optional(),
}).strict();

const ProviderLaunchConfigSchema = z.object({
  additionalArgs: z.array(z.string()).default([]),
});

export function isSupportedProviderId(providerId: string): providerId is (typeof SUPPORTED_PROVIDER_IDS)[number] {
  return supportedProviderIds.has(providerId);
}

export function sanitizeProviderLaunchConfig(config: unknown): { additionalArgs: string[] } {
  const parsed = ProviderLaunchConfigSchema.safeParse(config);
  return parsed.success ? parsed.data : { additionalArgs: [] };
}

export function mergeProviderLaunchConfig(
  provider: ProviderDefinition,
  config: unknown
): ProviderConfig {
  return {
    ...(provider.defaultConfig as Record<string, unknown>),
    ...sanitizeProviderLaunchConfig(config),
  };
}

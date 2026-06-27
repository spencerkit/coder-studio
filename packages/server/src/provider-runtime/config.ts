import type { ProviderDefinition } from "@coder-studio/core";
import { getProviderById as getBuiltInProviderById } from "@coder-studio/providers";

export function findProviderById(
  providerRegistry: ProviderDefinition[],
  providerId: string
): ProviderDefinition | undefined {
  return (
    providerRegistry.find((item) => item.id === providerId) ?? getBuiltInProviderById(providerId)
  );
}

export function getProviderByIdOrThrow(
  providerRegistry: ProviderDefinition[],
  providerId: string
): ProviderDefinition {
  const provider = findProviderById(providerRegistry, providerId);
  if (!provider) {
    throw {
      code: "unknown_provider",
      message: `Unknown provider: ${providerId}`,
    };
  }

  return provider;
}

export function sanitizeProviderConfig(
  provider: ProviderDefinition,
  config: unknown
): Record<string, unknown> {
  const parsed = provider.configSchema.safeParse(config);
  if (parsed.success) {
    return compactProviderConfig(parsed.data as Record<string, unknown>);
  }

  const defaults = provider.defaultConfig as Record<string, unknown>;
  const fallback = provider.configSchema.safeParse(defaults);
  return compactProviderConfig(
    fallback.success ? (fallback.data as Record<string, unknown>) : defaults
  );
}

export function mergeProviderConfigs(
  provider: ProviderDefinition,
  existingConfig: unknown,
  nextConfig: unknown
): Record<string, unknown> {
  const merged = {
    ...sanitizeProviderConfig(provider, provider.defaultConfig),
    ...sanitizeProviderConfig(provider, existingConfig),
    ...(nextConfig && typeof nextConfig === "object" && !Array.isArray(nextConfig)
      ? (nextConfig as Record<string, unknown>)
      : {}),
  };

  return compactProviderConfig(provider.configSchema.parse(merged) as Record<string, unknown>);
}

export function compactProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (value && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length > 0;
      }
      return true;
    })
  );
}

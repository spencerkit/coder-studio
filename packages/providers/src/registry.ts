import type { ProviderDefinition } from "@coder-studio/core";

import { claudeDefinition } from "./claude/definition.js";
import { codexDefinition } from "./codex/definition.js";

/**
 * Static registry of all available providers
 * Provider list is fixed at build time
 *
 * Adding a new provider:
 * 1. Create packages/providers/src/<name>/definition.ts
 * 2. Implement ProviderDefinition interface
 * 3. Import and add to this array
 * 4. Frontend automatically receives updated list via provider.list command
 */
export const providerRegistry: ProviderDefinition[] = [claudeDefinition, codexDefinition];

/**
 * Get provider by ID
 */
export function getProviderById(id: string): ProviderDefinition | undefined {
  return providerRegistry.find((provider) => provider.id === id);
}

/**
 * Check if provider ID is valid
 */
export function isValidProviderId(id: string): boolean {
  return providerRegistry.some((provider) => provider.id === id);
}

/**
 * Get all provider IDs
 */
export function getAllProviderIds(): string[] {
  return providerRegistry.map((provider) => provider.id);
}

/**
 * Get providers by capability level
 */
export function getProvidersByCapability(
  capability: "full" | "limited" | "unsupported"
): ProviderDefinition[] {
  return providerRegistry.filter((provider) => provider.capability === capability);
}

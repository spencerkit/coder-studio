import type {
  CustomProviderConfig,
  ProviderCapabilityDescriptor,
  ProviderDefinition,
} from "@coder-studio/core";
import { z } from "zod";

const CUSTOM_PROVIDER_CONFIG_SCHEMA = z.object({}).passthrough();

function deriveProviderCapability(
  capabilities: ProviderCapabilityDescriptor[]
): ProviderDefinition["capability"] {
  const interactive = capabilities.find((capability) => capability.key === "interactive_session");
  if (!interactive?.supported) {
    return "unsupported";
  }

  const allSupported =
    capabilities.length > 0 && capabilities.every((capability) => capability.supported);
  return allSupported ? "full" : "limited";
}

export function buildCustomProviderDefinition(config: CustomProviderConfig): ProviderDefinition {
  const command = config.command.trim();
  const requiredCommand = command.split(/\s+/)[0] ?? command;

  return {
    id: config.id,
    displayName: config.displayName,
    badge: "Custom",
    kind: "custom",
    capability: deriveProviderCapability(config.capabilities),
    capabilities: config.capabilities.map((capability) => ({ ...capability })),
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: {
        provider: "",
        prerequisites: {},
      },
      strategies: {},
    },
    buildCommand(_providerConfig, ctx) {
      return {
        argv: [command, ...config.args],
        env: {
          ...config.env,
          CODER_STUDIO_SESSION_ID: ctx.sessionId,
        },
        cwd: ctx.workspacePath,
      };
    },
    configSchema: CUSTOM_PROVIDER_CONFIG_SCHEMA,
    defaultConfig: {},
    requiredCommands: requiredCommand ? [requiredCommand] : [],
  };
}

export function upsertProviderDefinition(
  registry: ProviderDefinition[],
  provider: ProviderDefinition
): ProviderDefinition[] {
  const next = registry.filter((item) => item.id !== provider.id);
  next.push(provider);
  return next;
}

export function removeProviderDefinition(
  registry: ProviderDefinition[],
  providerId: string
): ProviderDefinition[] {
  return registry.filter((item) => item.id !== providerId);
}

import {
  type ProviderDefinition,
  type ProviderRuntimeStatusResponse,
  providerSupportsAgentInstructionsGeneration,
} from "@coder-studio/core";
import {
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
  checkCommandAvailable,
} from "./command-check.js";

export interface RuntimeStatusDeps extends CommandCheckDeps {
  commandExists?: CommandAvailabilityCheck;
}

type RuntimeStatusEntry = ProviderRuntimeStatusResponse["providers"][string];

function canAutoInstall(
  provider: ProviderDefinition,
  platform: NodeJS.Platform,
  missingCommands: string[],
  missingPrerequisites: string[],
  availableCommands: Set<string>
): boolean {
  const strategies = provider.install.strategies[platform] ?? [];
  const remainingCommands = new Set(missingCommands);
  const remainingPrerequisites = new Set(missingPrerequisites);
  const reachableCommands = new Set(availableCommands);
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const strategy of strategies) {
      const requiresMet = strategy.requiresCommands.every((command) =>
        reachableCommands.has(command)
      );

      if (
        strategy.kind === "prerequisite" &&
        remainingPrerequisites.has(strategy.targetCommand) &&
        requiresMet
      ) {
        remainingPrerequisites.delete(strategy.targetCommand);
        reachableCommands.add(strategy.targetCommand);
        progressed = true;
        continue;
      }

      if (
        strategy.kind === "provider" &&
        remainingCommands.has(strategy.targetCommand) &&
        requiresMet
      ) {
        remainingCommands.delete(strategy.targetCommand);
        reachableCommands.add(strategy.targetCommand);
        progressed = true;
      }
    }
  }

  return remainingCommands.size === 0 && strategies.length > 0;
}

export async function buildProviderRuntimeStatus(
  providers: ProviderDefinition[],
  deps: RuntimeStatusDeps = {}
): Promise<ProviderRuntimeStatusResponse> {
  const platform = deps.platform ?? process.platform;
  const commandExists =
    deps.commandExists ?? ((command: string) => checkCommandAvailable(command, deps));
  const result: ProviderRuntimeStatusResponse = { providers: {} };

  for (const provider of providers) {
    const strategies = provider.install.strategies[platform] ?? [];
    const strategyDependencyCommands = new Set<string>();
    for (const strategy of strategies) {
      for (const command of strategy.requiresCommands) {
        strategyDependencyCommands.add(command);
      }
    }

    const missingCommands: string[] = [];
    const availableCommands = new Set<string>();
    for (const command of provider.requiredCommands) {
      if (await commandExists(command)) {
        availableCommands.add(command);
      } else {
        missingCommands.push(command);
      }
    }

    const missingPrerequisites: string[] = [];
    for (const command of provider.install.prerequisites) {
      if (await commandExists(command)) {
        availableCommands.add(command);
      } else {
        missingPrerequisites.push(command);
      }
    }

    for (const command of strategyDependencyCommands) {
      if (availableCommands.has(command)) {
        continue;
      }

      if (await commandExists(command)) {
        availableCommands.add(command);
      }
    }

    const autoInstallSupported = canAutoInstall(
      provider,
      platform,
      missingCommands,
      missingPrerequisites,
      availableCommands
    );
    const available = missingCommands.length === 0;

    result.providers[provider.id] = {
      providerId: provider.id,
      displayName: provider.displayName,
      badge: provider.badge,
      kind: provider.kind ?? "built_in",
      stability: provider.stability,
      supportsAgentInstructions:
        provider.supportsAgentInstructions ?? Boolean(provider.agentInstructions?.publishTarget),
      supportsAgentInstructionsGeneration: providerSupportsAgentInstructionsGeneration(provider),
      supportsSkillsMount: provider.supportsSkillsMount ?? false,
      capability: provider.capability ?? "unsupported",
      capabilities: (provider.capabilities ?? []).map((capability) => ({ ...capability })),
      requiredCommands: [...provider.requiredCommands],
      available,
      missingCommands,
      missingPrerequisites,
      autoInstallSupported,
      installReadiness: available
        ? "ready"
        : autoInstallSupported
          ? missingPrerequisites.length === 0
            ? "ready"
            : "missing_prerequisite"
          : "unsupported_platform",
      manualGuideKeys: provider.install.manualGuideKeys,
      docUrls: provider.install.docUrls,
    } as RuntimeStatusEntry;
  }

  return result;
}

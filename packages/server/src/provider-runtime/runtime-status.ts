import type {
  ProviderDefinition,
  ProviderRuntimeStatusResponse,
} from '@coder-studio/core';
import {
  checkCommandAvailable,
  type CommandAvailabilityCheck,
  type CommandCheckDeps,
} from './command-check.js';

export interface RuntimeStatusDeps extends CommandCheckDeps {
  commandExists?: CommandAvailabilityCheck;
}

function canAutoInstall(
  provider: ProviderDefinition,
  platform: NodeJS.Platform,
  missingCommands: string[],
  missingPrerequisites: string[],
): boolean {
  const strategies = provider.install.strategies[platform] ?? [];
  const remainingCommands = new Set(missingCommands);
  const remainingPrerequisites = new Set(missingPrerequisites);
  let progressed = true;

  while (progressed) {
    progressed = false;

    for (const strategy of strategies) {
      const requiresMet = strategy.requiresCommands.every(
        (command) =>
          !remainingPrerequisites.has(command) && !remainingCommands.has(command),
      );

      if (
        strategy.kind === 'prerequisite' &&
        remainingPrerequisites.has(strategy.targetCommand) &&
        requiresMet
      ) {
        remainingPrerequisites.delete(strategy.targetCommand);
        progressed = true;
        continue;
      }

      if (
        strategy.kind === 'provider' &&
        remainingCommands.has(strategy.targetCommand) &&
        requiresMet
      ) {
        remainingCommands.delete(strategy.targetCommand);
        progressed = true;
      }
    }
  }

  return remainingCommands.size === 0 && strategies.length > 0;
}

export async function buildProviderRuntimeStatus(
  providers: ProviderDefinition[],
  deps: RuntimeStatusDeps = {},
): Promise<ProviderRuntimeStatusResponse> {
  const platform = deps.platform ?? process.platform;
  const commandExists =
    deps.commandExists ?? ((command: string) => checkCommandAvailable(command, deps));
  const result: ProviderRuntimeStatusResponse = { providers: {} };

  for (const provider of providers) {
    const missingCommands: string[] = [];
    for (const command of provider.requiredCommands) {
      if (!(await commandExists(command))) {
        missingCommands.push(command);
      }
    }

    const missingPrerequisites: string[] = [];
    for (const command of provider.install.prerequisites) {
      if (!(await commandExists(command))) {
        missingPrerequisites.push(command);
      }
    }

    const autoInstallSupported = canAutoInstall(
      provider,
      platform,
      missingCommands,
      missingPrerequisites,
    );

    result.providers[provider.id] = {
      providerId: provider.id,
      available: missingCommands.length === 0,
      missingCommands,
      missingPrerequisites,
      autoInstallSupported,
      installReadiness:
        missingPrerequisites.length === 0
          ? 'ready'
          : autoInstallSupported
            ? 'missing_prerequisite'
            : 'unsupported_platform',
      manualGuideKeys: provider.install.manualGuideKeys,
      docUrls: provider.install.docUrls,
    };
  }

  return result;
}

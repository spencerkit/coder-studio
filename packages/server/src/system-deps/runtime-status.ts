import {
  SYSTEM_DEPENDENCY_IDS,
  type SystemDependencyId,
  type SystemDependencyPackageManager,
  type SystemDependencyRuntimeEntry,
  type SystemDependencyRuntimeStatusResponse,
} from "@coder-studio/core";
import {
  type CommandAvailabilityCheck,
  checkCommandAvailable,
} from "../provider-runtime/command-check.js";
import { runCommandAsString } from "../provider-runtime/command-runner.js";
import type { RuntimeStatusDeps } from "../provider-runtime/runtime-status.js";
import { PACKAGE_MANAGER_ORDER, SYSTEM_DEPENDENCY_DEFINITIONS } from "./definitions.js";

async function readVersion(
  dependencyId: SystemDependencyId,
  deps: RuntimeStatusDeps
): Promise<string | undefined> {
  const definition = SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId];
  const runner = deps.runCommand ?? runCommandAsString;

  try {
    const { stdout } = await runner(
      definition.versionCommand.file,
      definition.versionCommand.args,
      {
        windowsHide: true,
      }
    );
    const version = stdout.trim();
    return version.length > 0 ? version : undefined;
  } catch {
    return undefined;
  }
}

function getCommandExists(deps: RuntimeStatusDeps): CommandAvailabilityCheck {
  return deps.commandExists ?? ((command: string) => checkCommandAvailable(command, deps));
}

async function detectPackageManager(
  platform: NodeJS.Platform,
  commandExists: CommandAvailabilityCheck
): Promise<SystemDependencyPackageManager | undefined> {
  const candidates = PACKAGE_MANAGER_ORDER[platform] ?? [];

  for (const candidate of candidates) {
    if (await commandExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

async function buildDependencyEntry(
  dependencyId: SystemDependencyId,
  deps: RuntimeStatusDeps,
  platform: NodeJS.Platform,
  commandExists: CommandAvailabilityCheck,
  packageManager: SystemDependencyPackageManager | undefined
): Promise<SystemDependencyRuntimeEntry> {
  const definition = SYSTEM_DEPENDENCY_DEFINITIONS[dependencyId];
  const available = await commandExists(definition.versionCommand.file);
  const version = available ? await readVersion(dependencyId, deps) : undefined;

  return {
    dependencyId,
    available,
    version,
    autoInstallSupported: !available && Boolean(packageManager),
    installReadiness: available
      ? "ready"
      : packageManager
        ? "ready"
        : platform === "darwin" || platform === "linux"
          ? "unsupported_package_manager"
          : "unsupported_platform",
    packageManager,
    manualGuideKeys: definition.manualGuideKeys,
    docUrl: definition.docsUrl,
  };
}

async function buildDependencyMap(
  ids: readonly [],
  buildEntry: (dependencyId: never) => Promise<SystemDependencyRuntimeEntry>
): Promise<Record<never, never>>;
async function buildDependencyMap<
  const T extends readonly [SystemDependencyId, ...SystemDependencyId[]],
>(
  ids: T,
  buildEntry: (dependencyId: T[number]) => Promise<SystemDependencyRuntimeEntry>
): Promise<{ [K in T[number]]: SystemDependencyRuntimeEntry }>;
async function buildDependencyMap(
  ids: readonly SystemDependencyId[],
  buildEntry: (dependencyId: SystemDependencyId) => Promise<SystemDependencyRuntimeEntry>
): Promise<Record<string, SystemDependencyRuntimeEntry>> {
  if (ids.length === 0) {
    return {};
  }

  const [head, ...tail] = ids;
  return {
    [head]: await buildEntry(head),
    ...(await buildDependencyMap(tail, buildEntry)),
  };
}

export async function buildSystemDependencyRuntimeStatus(
  deps: RuntimeStatusDeps = {}
): Promise<SystemDependencyRuntimeStatusResponse> {
  const platform = deps.platform ?? process.platform;
  const commandExists = getCommandExists(deps);
  const packageManager = await detectPackageManager(platform, commandExists);
  const dependencies = await buildDependencyMap(SYSTEM_DEPENDENCY_IDS, (dependencyId) =>
    buildDependencyEntry(dependencyId, deps, platform, commandExists, packageManager)
  );

  return { dependencies };
}

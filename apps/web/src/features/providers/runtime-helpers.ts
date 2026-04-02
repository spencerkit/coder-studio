import type { RuntimeRequirementStatus } from "../../components/RuntimeValidationOverlay/RuntimeValidationOverlay";
import type { ProviderStartupBehavior } from "./types";
import { getProviderBadgeLabel, getProviderManifest } from "./registry";

const DEFAULT_PROVIDER_STARTUP_BEHAVIOR: ProviderStartupBehavior = {
  startupQuietMs: 400,
  startupDiscoveryMs: 1200,
  firstSubmitStrategy: "immediate_newline",
};

const parseCommandBinary = (command: string) => {
  const trimmed = command.trim();
  if (!trimmed) return "";

  let token = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (const ch of trimmed) {
    if (escaped) {
      token += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\" && !inSingle) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }
    if (ch === "\"" && !inSingle) {
      inDouble = !inDouble;
      continue;
    }
    if (/\s/.test(ch) && !inSingle && !inDouble) {
      if (token) break;
      continue;
    }
    token += ch;
  }

  return token.trim();
};

const commandUsesWorkspaceRelativePath = (binary: string) => (
  binary.startsWith("./")
  || binary.startsWith("../")
  || binary.startsWith(".\\")
  || binary.startsWith("..\\")
);

export const getProviderDisplayLabel = (providerId: string) => getProviderBadgeLabel(providerId);

export const getProviderStartupBehavior = (providerId: string): ProviderStartupBehavior => (
  getProviderManifest(providerId)?.startupBehavior ?? DEFAULT_PROVIDER_STARTUP_BEHAVIOR
);

export const buildRuntimeRequirementStatusesFromManifest = (
  providerId: string,
  command: string,
  translate: (key: string, params?: Record<string, string | number>) => string,
): RuntimeRequirementStatus[] => {
  const manifest = getProviderManifest(providerId);
  const trimmedCommand = command.trim();
  const commandBinary = parseCommandBinary(trimmedCommand);
  const deferred = commandBinary.includes("{path}") || commandUsesWorkspaceRelativePath(commandBinary);

  if (!manifest) {
    return [
      {
        id: providerId,
        label: getProviderBadgeLabel(providerId),
        hint: translate("providerUnknownHint", { provider: providerId }),
        command: trimmedCommand,
        available: deferred ? true : null,
        detailText: undefined,
      },
      {
        id: "git",
        label: translate("runtimeCheckGitLabel"),
        hint: translate("runtimeCheckGitHint"),
        command: "git",
        available: null,
        detailText: undefined,
      },
    ];
  }

  return [
    {
      id: manifest.id,
      label: translate(manifest.runtimeValidation.commandLabelKey),
      hint: translate(manifest.runtimeValidation.commandHintKey),
      command: trimmedCommand,
      available: deferred ? true : null,
      detailText: deferred && manifest.runtimeValidation.deferredHintKey
        ? translate(manifest.runtimeValidation.deferredHintKey)
        : undefined,
    },
    ...manifest.runtimeValidation.requiredCommands.map((requiredCommand) => ({
      id: requiredCommand.id,
      label: translate(requiredCommand.labelKey),
      hint: translate(requiredCommand.hintKey),
      command: requiredCommand.command,
      available: null,
      detailText: undefined,
    })),
  ];
};

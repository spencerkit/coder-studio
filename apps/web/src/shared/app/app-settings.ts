import type { Locale } from "../../i18n";
import type { AppSettings, LegacyAppSettings } from "../../types/app";
export {
  applyAgentDefaultsPatch,
  applyGeneralSettingsPatch,
  applyProviderGlobalPatch,
  cloneAppSettings,
  defaultAppSettings,
  normalizeAppSettings,
  resolveProviderGlobalSettings,
  toAppSettingsPayload,
} from "./provider-settings";
import {
  applyProviderGlobalPatch,
  cloneAppSettings,
  normalizeAppSettings,
  toAppSettingsPayload,
} from "./provider-settings";

const DEFAULT_CLAUDE_EXECUTABLE = "claude";

const tokenizeLegacyCommand = (command: string): string[] => {
  const tokens: string[] = [];
  let current = "";
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < command.length; index += 1) {
    const char = command[index];

    if (quote === null) {
      if (/\s/.test(char)) {
        if (current) {
          tokens.push(current);
          current = "";
        }
        continue;
      }
      if (char === "'" || char === "\"") {
        quote = char;
        continue;
      }
      if (char === "\\") {
        const next = command[index + 1];
        if (next && (/\s/.test(next) || next === "'" || next === "\"" || next === "\\")) {
          current += next;
          index += 1;
          continue;
        }
        current += char;
        continue;
      }
      current += char;
      continue;
    }

    if (quote === "'") {
      if (char === "'") {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === "\"") {
      quote = null;
      continue;
    }
    if (char === "\\") {
      const next = command[index + 1];
      if (next === "\"" || next === "\\" || next === "$" || next === "`") {
        current += next;
        index += 1;
        continue;
      }
    }
    current += char;
  }

  if (current) {
    tokens.push(current);
  }

  return tokens;
};

const splitLegacyCommand = (command: string): { executable: string; startupArgs: string[] } => {
  const tokens = tokenizeLegacyCommand(command.trim());
  const [executable = DEFAULT_CLAUDE_EXECUTABLE, ...startupArgs] = tokens;
  return { executable, startupArgs };
};

export const getSettingsLocale = (settings: AppSettings): Locale => settings.general.locale;

export const getIdlePolicy = (settings: AppSettings) => settings.general.idlePolicy;

export const getCompletionNotifications = (settings: AppSettings) =>
  settings.general.completionNotifications;

export const getIdlePolicySyncWorkspaceIds = (
  tabs: ReadonlyArray<{ id: string; idlePolicy: AppSettings["general"]["idlePolicy"] }>,
  idlePolicy: AppSettings["general"]["idlePolicy"],
  settingsHydrated: boolean,
): string[] => {
  if (!settingsHydrated) {
    return [];
  }

  return tabs
    .filter((tab) => (
      tab.idlePolicy.enabled !== idlePolicy.enabled
      || tab.idlePolicy.idleMinutes !== idlePolicy.idleMinutes
      || tab.idlePolicy.maxActive !== idlePolicy.maxActive
      || tab.idlePolicy.pressure !== idlePolicy.pressure
    ))
    .map((tab) => tab.id);
};

export const mergeLegacySettingsIntoAppSettings = (
  base: AppSettings,
  legacy: AppSettings | LegacyAppSettings,
): AppSettings => {
  let next = cloneAppSettings(base);
  const legacyInput = legacy as LegacyAppSettings;

  if (typeof legacyInput.agentCommand === "string" && legacyInput.agentCommand.trim()) {
    const { executable, startupArgs } = splitLegacyCommand(legacyInput.agentCommand);
    next = applyProviderGlobalPatch(next, "claude", { executable, startupArgs });
  }

  const payload = toAppSettingsPayload(next);

  return normalizeAppSettings({
    ...payload,
    ...(legacy.general ? {
      general: {
        ...payload.general,
        ...legacy.general,
      },
    } : {}),
    ...(legacy.agentDefaults ? {
      agentDefaults: {
        ...payload.agentDefaults,
        ...legacy.agentDefaults,
      },
    } : {}),
    ...(legacy.providers ? { providers: legacy.providers } : {}),
    locale: legacyInput.locale,
    idlePolicy: legacyInput.idlePolicy,
    completionNotifications: legacyInput.completionNotifications,
    terminalCompatibilityMode: legacyInput.terminalCompatibilityMode,
    claude: legacyInput.claude,
    codex: legacyInput.codex,
  }, payload);
};

export const appSettingsPayloadEquals = (
  left: AppSettings,
  right: AppSettings,
): boolean => JSON.stringify(toAppSettingsPayload(left)) === JSON.stringify(toAppSettingsPayload(right));

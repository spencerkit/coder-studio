import type { Locale } from "../../i18n";
import type { ExecTarget } from "../../state/workbench";
import type {
  AppSettings,
  AppSettingsPayload,
  ClaudeRuntimeProfile,
  CodexRuntimeProfile,
  LegacyAppSettings,
} from "../../types/app";
import {
  applyAgentDefaultsPatch,
  applyGeneralSettingsPatch,
  applyProviderGlobalPatch,
  cloneAppSettings,
  defaultAppSettings,
  normalizeAppSettings,
  resolveRuntimeCommandFromSettings,
  toAppSettingsPayload,
} from "./provider-settings";

const DEFAULT_CLAUDE_EXECUTABLE = "claude";

const cloneJsonRecord = (value: Record<string, unknown>): Record<string, unknown> => (
  structuredClone(value)
);

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

const formatCodexTomlString = (value: string) => JSON.stringify(value.trim());

const buildCodexConfigOverrideArgs = (
  profile: Pick<
    CodexRuntimeProfile,
    "model" | "approvalPolicy" | "sandboxMode" | "webSearch" | "modelReasoningEffort"
  >,
): string[] => {
  const parts: string[] = [];

  const append = (key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed) {
      return;
    }
    parts.push("--config", `${key}=${formatCodexTomlString(trimmed)}`);
  };

  append("model", profile.model);
  append("approval_policy", profile.approvalPolicy);
  append("sandbox_mode", profile.sandboxMode);
  append("web_search", profile.webSearch);
  append("model_reasoning_effort", profile.modelReasoningEffort);

  return parts;
};

const buildCodexFeatureArgs = (): string[] => ["--enable", "codex_hooks"];

export const formatClaudeRuntimeCommand = (profile: ClaudeRuntimeProfile): string => (
  [profile.executable.trim(), ...profile.startupArgs.map((arg) => arg.trim()).filter(Boolean)]
    .filter(Boolean)
    .join(" ")
);

export const formatCodexRuntimeCommand = (profile: CodexRuntimeProfile): string => (
  [
    profile.executable.trim(),
    ...profile.extraArgs.map((arg) => arg.trim()).filter(Boolean),
    ...buildCodexConfigOverrideArgs(profile),
    ...buildCodexFeatureArgs(),
  ]
    .filter(Boolean)
    .join(" ")
);

export const formatClaudeLaunchPreview = (
  profile: Pick<ClaudeRuntimeProfile, "startupArgs">,
): string => (
  [DEFAULT_CLAUDE_EXECUTABLE, ...profile.startupArgs.map((arg) => arg.trim()).filter(Boolean)]
    .join(" ")
);

export const forceClaudeExecutableDefaults = (settings: AppSettings): AppSettings => (
  applyProviderGlobalPatch(settings, "claude", { executable: DEFAULT_CLAUDE_EXECUTABLE })
);

export {
  applyAgentDefaultsPatch,
  applyGeneralSettingsPatch,
  cloneAppSettings,
  defaultAppSettings,
  normalizeAppSettings,
  toAppSettingsPayload,
};

export const mergeLegacySettingsIntoAppSettings = (
  base: AppSettings,
  legacy: LegacyAppSettings,
): AppSettings => {
  let next = cloneAppSettings(base);

  if (typeof legacy.agentCommand === "string" && legacy.agentCommand.trim()) {
    const { executable, startupArgs } = splitLegacyCommand(legacy.agentCommand);
    next = applyProviderGlobalPatch(next, "claude", { executable, startupArgs });
  }

  return normalizeAppSettings({
    ...toAppSettingsPayload(next),
    locale: legacy.locale,
    idlePolicy: legacy.idlePolicy,
    completionNotifications: legacy.completionNotifications,
    terminalCompatibilityMode: legacy.terminalCompatibilityMode,
    claude: legacy.claude,
    codex: legacy.codex,
  });
};

export const resolveClaudeRuntimeProfile = (
  settings: AppSettings,
  _target: ExecTarget,
): ClaudeRuntimeProfile => cloneJsonRecord(settings.claude.global) as ClaudeRuntimeProfile;

export const resolveCodexRuntimeProfile = (
  settings: AppSettings,
  _target: ExecTarget,
): CodexRuntimeProfile => cloneJsonRecord(settings.codex.global) as CodexRuntimeProfile;

export const resolveAgentRuntimeCommand = (
  settings: AppSettings,
  _target: ExecTarget,
  provider: AppSettings["agentDefaults"]["provider"],
): string => resolveRuntimeCommandFromSettings(settings, provider);

export const resolveDefaultAgentRuntimeCommand = (
  settings: AppSettings,
  target: ExecTarget,
): string => resolveAgentRuntimeCommand(settings, target, settings.agentDefaults.provider);

export const getIdlePolicySyncWorkspaceIds = (
  tabs: ReadonlyArray<{ id: string; idlePolicy: AppSettings["idlePolicy"] }>,
  idlePolicy: AppSettings["idlePolicy"],
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

export const getSettingsDraftLocale = (settings: AppSettings): Locale => settings.general.locale;

export const appSettingsPayloadEquals = (
  left: AppSettings,
  right: AppSettings,
): boolean => JSON.stringify(toAppSettingsPayload(left)) === JSON.stringify(toAppSettingsPayload(right));

export const patchClaudeStructuredSettings = (
  settings: AppSettings,
  patch: {
    executable?: string;
    startupArgs?: string[];
    env?: Record<string, string>;
  },
): AppSettings => applyProviderGlobalPatch(settings, "claude", {
  ...(typeof patch.executable === "string" ? { executable: patch.executable.trim() || settings.claude.global.executable } : {}),
  ...(patch.startupArgs ? { startupArgs: [...patch.startupArgs] } : {}),
  ...(patch.env ? { env: { ...patch.env } } : {}),
});

export const patchCodexStructuredSettings = (
  settings: AppSettings,
  patch: {
    executable?: string;
    extraArgs?: string[];
    model?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
    webSearch?: string;
    modelReasoningEffort?: string;
    env?: Record<string, string>;
  },
): AppSettings => applyProviderGlobalPatch(settings, "codex", {
  ...(typeof patch.executable === "string" ? { executable: patch.executable.trim() || settings.codex.global.executable } : {}),
  ...(patch.extraArgs ? { extraArgs: [...patch.extraArgs] } : {}),
  ...(typeof patch.model === "string" ? { model: patch.model } : {}),
  ...(typeof patch.approvalPolicy === "string" ? { approvalPolicy: patch.approvalPolicy } : {}),
  ...(typeof patch.sandboxMode === "string" ? { sandboxMode: patch.sandboxMode } : {}),
  ...(typeof patch.webSearch === "string" ? { webSearch: patch.webSearch } : {}),
  ...(typeof patch.modelReasoningEffort === "string" ? { modelReasoningEffort: patch.modelReasoningEffort } : {}),
  ...(patch.env ? { env: { ...patch.env } } : {}),
});

export const replaceClaudeAdvancedJson = (
  settings: AppSettings,
  patch: {
    field: "settingsJson" | "globalConfigJson";
    value: Record<string, unknown>;
  },
): AppSettings => applyProviderGlobalPatch(settings, "claude", {
  [patch.field]: cloneJsonRecord(patch.value),
});

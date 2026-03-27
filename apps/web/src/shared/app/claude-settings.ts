import type { Locale } from "../../i18n.ts";
import type { ExecTarget } from "../../state/workbench.ts";
import type {
  AppSettings,
  AppSettingsPayload,
  ClaudeRuntimeProfile,
  ClaudeTargetOverride,
  CompletionNotificationSettings,
  LegacyAppSettings,
  TerminalCompatibilityMode,
} from "../../types/app.ts";

const DEFAULT_LOCALE: Locale = "en";
const DEFAULT_TERMINAL_COMPATIBILITY_MODE: TerminalCompatibilityMode = "standard";

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

const cloneJsonRecord = (value: Record<string, unknown>): Record<string, unknown> => (
  structuredClone(value)
);

const readBoolean = (value: unknown, fallback: boolean) => (
  typeof value === "boolean" ? value : fallback
);

const readLocale = (value: unknown, fallback: Locale) => (
  value === "zh" ? "zh" : value === "en" ? "en" : fallback
);

const readTerminalCompatibilityMode = (
  value: unknown,
  fallback: TerminalCompatibilityMode,
): TerminalCompatibilityMode => (
  value === "compatibility" ? "compatibility" : value === "standard" ? "standard" : fallback
);

const normalizeCompletionNotifications = (
  value: unknown,
  fallback: CompletionNotificationSettings,
): CompletionNotificationSettings => {
  const source = isRecord(value) ? value : {};
  return {
    enabled: readBoolean(source.enabled, fallback.enabled),
    onlyWhenBackground: readBoolean(
      source.onlyWhenBackground ?? source.only_when_background,
      fallback.onlyWhenBackground,
    ),
  };
};

const normalizeIdlePolicy = (
  value: unknown,
  fallback: AppSettingsPayload["general"]["idlePolicy"],
): AppSettingsPayload["general"]["idlePolicy"] => {
  const source = isRecord(value) ? value : {};
  const idleMinutes = source.idleMinutes ?? source.idle_minutes;
  const maxActive = source.maxActive ?? source.max_active;

  return {
    enabled: readBoolean(source.enabled, fallback.enabled),
    idleMinutes: Number.isFinite(idleMinutes)
      ? Math.max(1, Number(idleMinutes))
      : fallback.idleMinutes,
    maxActive: Number.isFinite(maxActive)
      ? Math.max(1, Number(maxActive))
      : fallback.maxActive,
    pressure: readBoolean(source.pressure, fallback.pressure),
  };
};

const normalizeEnv = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
};

const normalizeJsonRecord = (
  value: unknown,
  fallback: Record<string, unknown> = {},
): Record<string, unknown> => {
  if (!isRecord(value)) {
    return cloneJsonRecord(fallback);
  }
  return cloneJsonRecord(value);
};

const cloneCompletionNotifications = (
  settings: CompletionNotificationSettings,
): CompletionNotificationSettings => ({ ...settings });

const cloneIdlePolicy = (
  policy: AppSettingsPayload["general"]["idlePolicy"],
): AppSettingsPayload["general"]["idlePolicy"] => ({ ...policy });

const cloneClaudeRuntimeProfile = (
  profile: ClaudeRuntimeProfile,
): ClaudeRuntimeProfile => ({
  executable: profile.executable,
  startupArgs: [...profile.startupArgs],
  env: { ...profile.env },
  settingsJson: cloneJsonRecord(profile.settingsJson),
  globalConfigJson: cloneJsonRecord(profile.globalConfigJson),
});

const cloneClaudeTargetOverride = (
  override: ClaudeTargetOverride | null,
): ClaudeTargetOverride | null => (
  override
    ? {
        enabled: override.enabled,
        profile: cloneClaudeRuntimeProfile(override.profile),
      }
    : null
);

const cloneAppSettingsPayload = (settings: AppSettingsPayload): AppSettingsPayload => ({
  general: {
    locale: settings.general.locale,
    terminalCompatibilityMode: settings.general.terminalCompatibilityMode,
    completionNotifications: cloneCompletionNotifications(settings.general.completionNotifications),
    idlePolicy: cloneIdlePolicy(settings.general.idlePolicy),
  },
  claude: {
    global: cloneClaudeRuntimeProfile(settings.claude.global),
    overrides: {
      native: cloneClaudeTargetOverride(settings.claude.overrides.native),
      wsl: cloneClaudeTargetOverride(settings.claude.overrides.wsl),
    },
  },
});

const syncCompatibilityFields = (settings: AppSettingsPayload): AppSettings => ({
  ...cloneAppSettingsPayload(settings),
  agentProvider: "claude",
  agentCommand: formatClaudeRuntimeCommand(settings.claude.global),
  idlePolicy: cloneIdlePolicy(settings.general.idlePolicy),
  completionNotifications: cloneCompletionNotifications(settings.general.completionNotifications),
  terminalCompatibilityMode: settings.general.terminalCompatibilityMode,
});

const defaultCompletionNotifications = (): CompletionNotificationSettings => ({
  enabled: true,
  onlyWhenBackground: true,
});

const defaultClaudeRuntimeProfile = (): ClaudeRuntimeProfile => ({
  executable: "claude",
  startupArgs: [],
  env: {},
  settingsJson: {},
  globalConfigJson: {},
});

const mergeJsonObjects = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const merged = cloneJsonRecord(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = mergeJsonObjects(
        merged[key] as Record<string, unknown>,
        value,
      );
      continue;
    }
    merged[key] = structuredClone(value);
  }
  return merged;
};

const mergeClaudeRuntimeProfiles = (
  base: ClaudeRuntimeProfile,
  override: ClaudeRuntimeProfile,
): ClaudeRuntimeProfile => ({
  executable: override.executable.trim() ? override.executable : base.executable,
  startupArgs: override.startupArgs.length > 0 ? [...override.startupArgs] : [...base.startupArgs],
  env: {
    ...base.env,
    ...override.env,
  },
  settingsJson: mergeJsonObjects(base.settingsJson, override.settingsJson),
  globalConfigJson: mergeJsonObjects(base.globalConfigJson, override.globalConfigJson),
});

const normalizeClaudeRuntimeProfile = (
  value: unknown,
  fallback: ClaudeRuntimeProfile,
): ClaudeRuntimeProfile => {
  const source = isRecord(value) ? value : {};
  const executable = typeof source.executable === "string" && source.executable.trim()
    ? source.executable
    : fallback.executable;
  const startupArgsSource = source.startupArgs ?? source.startup_args;
  const startupArgs = Array.isArray(startupArgsSource)
    ? startupArgsSource.filter((entry): entry is string => typeof entry === "string")
    : [...fallback.startupArgs];

  return {
    executable,
    startupArgs,
    env: normalizeEnv(source.env ?? fallback.env),
    settingsJson: normalizeJsonRecord(
      source.settingsJson ?? source.settings_json,
      fallback.settingsJson,
    ),
    globalConfigJson: normalizeJsonRecord(
      source.globalConfigJson ?? source.global_config_json,
      fallback.globalConfigJson,
    ),
  };
};

const normalizeClaudeTargetOverride = (
  value: unknown,
  fallback: ClaudeRuntimeProfile,
): ClaudeTargetOverride | null => {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  return {
    enabled: readBoolean(value.enabled, false),
    profile: normalizeClaudeRuntimeProfile(value.profile, fallback),
  };
};

const splitLegacyCommand = (command: string): { executable: string; startupArgs: string[] } => {
  const tokens = command.trim().split(/\s+/).filter(Boolean);
  const [executable = "claude", ...startupArgs] = tokens;
  return {
    executable,
    startupArgs,
  };
};

export const formatClaudeRuntimeCommand = (profile: ClaudeRuntimeProfile): string => (
  [profile.executable.trim(), ...profile.startupArgs.map((arg) => arg.trim()).filter(Boolean)]
    .filter(Boolean)
    .join(" ")
);

export const defaultAppSettings = (): AppSettings => syncCompatibilityFields({
  general: {
    locale: DEFAULT_LOCALE,
    terminalCompatibilityMode: DEFAULT_TERMINAL_COMPATIBILITY_MODE,
    completionNotifications: defaultCompletionNotifications(),
    idlePolicy: {
      enabled: true,
      idleMinutes: 10,
      maxActive: 3,
      pressure: true,
    },
  },
  claude: {
    global: defaultClaudeRuntimeProfile(),
    overrides: {
      native: null,
      wsl: null,
    },
  },
});

export const toAppSettingsPayload = (settings: AppSettings): AppSettingsPayload => (
  cloneAppSettingsPayload({
    general: settings.general,
    claude: settings.claude,
  })
);

export const cloneAppSettings = (settings: AppSettings): AppSettings => (
  syncCompatibilityFields(toAppSettingsPayload(settings))
);

export const normalizeAppSettings = (
  value: unknown,
  fallback = defaultAppSettings(),
): AppSettings => {
  const fallbackPayload = toAppSettingsPayload(fallback);
  if (!isRecord(value)) {
    return cloneAppSettings(fallback);
  }

  if (!("general" in value) && !("claude" in value)) {
    return mergeLegacySettingsIntoAppSettings(
      fallback,
      value as LegacyAppSettings,
    );
  }

  const generalSource = isRecord(value.general) ? value.general : {};
  const claudeSource = isRecord(value.claude) ? value.claude : {};
  const globalProfile = normalizeClaudeRuntimeProfile(
    claudeSource.global,
    fallbackPayload.claude.global,
  );

  return syncCompatibilityFields({
    general: {
      locale: readLocale(generalSource.locale, fallbackPayload.general.locale),
      terminalCompatibilityMode: readTerminalCompatibilityMode(
        generalSource.terminalCompatibilityMode ?? generalSource.terminal_compatibility_mode,
        fallbackPayload.general.terminalCompatibilityMode,
      ),
      completionNotifications: normalizeCompletionNotifications(
        generalSource.completionNotifications ?? generalSource.completion_notifications,
        fallbackPayload.general.completionNotifications,
      ),
      idlePolicy: normalizeIdlePolicy(
        generalSource.idlePolicy ?? generalSource.idle_policy,
        fallbackPayload.general.idlePolicy,
      ),
    },
    claude: {
      global: globalProfile,
      overrides: {
        native: normalizeClaudeTargetOverride(
          isRecord(claudeSource.overrides) ? claudeSource.overrides.native : null,
          globalProfile,
        ),
        wsl: normalizeClaudeTargetOverride(
          isRecord(claudeSource.overrides) ? claudeSource.overrides.wsl : null,
          globalProfile,
        ),
      },
    },
  });
};

export const mergeLegacySettingsIntoAppSettings = (
  base: AppSettings,
  legacy: LegacyAppSettings,
): AppSettings => {
  const next = cloneAppSettings(base);

  if (typeof legacy.agentCommand === "string" && legacy.agentCommand.trim()) {
    const { executable, startupArgs } = splitLegacyCommand(legacy.agentCommand);
    next.claude.global.executable = executable;
    next.claude.global.startupArgs = startupArgs;
  }

  if (legacy.locale) {
    next.general.locale = readLocale(legacy.locale, next.general.locale);
  }

  next.general.terminalCompatibilityMode = readTerminalCompatibilityMode(
    legacy.terminalCompatibilityMode,
    next.general.terminalCompatibilityMode,
  );
  next.general.completionNotifications = normalizeCompletionNotifications(
    legacy.completionNotifications,
    next.general.completionNotifications,
  );
  next.general.idlePolicy = normalizeIdlePolicy(
    legacy.idlePolicy,
    next.general.idlePolicy,
  );

  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const applyGeneralSettingsPatch = (
  settings: AppSettings,
  patch: Partial<AppSettings["general"]>,
): AppSettings => {
  const next = cloneAppSettings(settings);

  if (patch.locale) {
    next.general.locale = readLocale(patch.locale, next.general.locale);
  }
  if (patch.terminalCompatibilityMode) {
    next.general.terminalCompatibilityMode = readTerminalCompatibilityMode(
      patch.terminalCompatibilityMode,
      next.general.terminalCompatibilityMode,
    );
  }
  if (patch.completionNotifications) {
    next.general.completionNotifications = {
      ...next.general.completionNotifications,
      ...patch.completionNotifications,
    };
  }
  if (patch.idlePolicy) {
    next.general.idlePolicy = {
      ...next.general.idlePolicy,
      ...patch.idlePolicy,
      idleMinutes: Number.isFinite(patch.idlePolicy.idleMinutes)
        ? Math.max(1, Number(patch.idlePolicy.idleMinutes))
        : next.general.idlePolicy.idleMinutes,
      maxActive: Number.isFinite(patch.idlePolicy.maxActive)
        ? Math.max(1, Number(patch.idlePolicy.maxActive))
        : next.general.idlePolicy.maxActive,
    };
  }

  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const resolveClaudeRuntimeProfile = (
  settings: AppSettings,
  target: ExecTarget,
): ClaudeRuntimeProfile => {
  const override = target.type === "native"
    ? settings.claude.overrides.native
    : settings.claude.overrides.wsl;

  if (!override?.enabled) {
    return cloneClaudeRuntimeProfile(settings.claude.global);
  }

  return mergeClaudeRuntimeProfiles(settings.claude.global, override.profile);
};

export const resolveClaudeCommandForTarget = (
  settings: AppSettings,
  target: ExecTarget,
): string => formatClaudeRuntimeCommand(resolveClaudeRuntimeProfile(settings, target));

export const updateClaudeCommandForTarget = (
  settings: AppSettings,
  target: ExecTarget,
  command: string,
): AppSettings => {
  const next = cloneAppSettings(settings);
  const { executable, startupArgs } = splitLegacyCommand(command);
  const targetOverride = target.type === "native"
    ? next.claude.overrides.native
    : next.claude.overrides.wsl;
  const profile = targetOverride?.enabled
    ? targetOverride.profile
    : next.claude.global;

  profile.executable = executable;
  profile.startupArgs = startupArgs;

  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const appSettingsPayloadEquals = (
  left: AppSettings,
  right: AppSettings,
): boolean => (
  JSON.stringify(toAppSettingsPayload(left)) === JSON.stringify(toAppSettingsPayload(right))
);

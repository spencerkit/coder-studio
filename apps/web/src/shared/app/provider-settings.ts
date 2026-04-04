import type { Locale } from "../../i18n";
import type {
  AppSettings,
  AppSettingsPayload,
  ClaudeRuntimeProfile,
  CodexRuntimeProfile,
  CompletionNotificationSettings,
  LegacyAppSettings,
  ProviderSettingsPayload,
  TerminalCompatibilityMode,
} from "../../types/app";

const DEFAULT_LOCALE: Locale = "en";
const DEFAULT_TERMINAL_COMPATIBILITY_MODE: TerminalCompatibilityMode = "standard";
const DEFAULT_COMPLETION_NOTIFICATIONS: CompletionNotificationSettings = {
  enabled: true,
  onlyWhenBackground: true,
};
const DEFAULT_IDLE_POLICY: AppSettingsPayload["general"]["idlePolicy"] = {
  enabled: true,
  idleMinutes: 10,
  maxActive: 3,
  pressure: true,
};
const DEFAULT_CLAUDE_EXECUTABLE = "claude";

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
    idleMinutes: Number.isFinite(idleMinutes) ? Math.max(1, Number(idleMinutes)) : fallback.idleMinutes,
    maxActive: Number.isFinite(maxActive) ? Math.max(1, Number(maxActive)) : fallback.maxActive,
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

const mergeJsonObjects = (
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> => {
  const merged = cloneJsonRecord(base);
  for (const [key, value] of Object.entries(override)) {
    if (isRecord(value) && isRecord(merged[key])) {
      merged[key] = mergeJsonObjects(merged[key] as Record<string, unknown>, value);
      continue;
    }
    merged[key] = structuredClone(value);
  }
  return merged;
};

const setJsonPath = (
  base: Record<string, unknown>,
  path: readonly string[],
  value: unknown,
): Record<string, unknown> => {
  if (path.length === 0) {
    return isRecord(value) ? cloneJsonRecord(value) : {};
  }

  const next = cloneJsonRecord(base);
  let current: Record<string, unknown> = next;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index];
    const existing = current[segment];
    const branch = isRecord(existing) ? cloneJsonRecord(existing) : {};
    current[segment] = branch;
    current = branch;
  }

  current[path[path.length - 1]] = structuredClone(value);
  return next;
};

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

const cloneProviderSettingsMap = (
  providers: Record<string, ProviderSettingsPayload>,
): Record<string, ProviderSettingsPayload> => (
  Object.fromEntries(
    Object.entries(providers).map(([providerId, providerSettings]) => [
      providerId,
      { global: cloneJsonRecord(providerSettings.global) },
    ]),
  )
);

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
    settingsJson: normalizeJsonRecord(source.settingsJson ?? source.settings_json, fallback.settingsJson),
    globalConfigJson: normalizeJsonRecord(
      source.globalConfigJson ?? source.global_config_json,
      fallback.globalConfigJson,
    ),
  };
};

const normalizeCodexRuntimeProfile = (
  value: unknown,
  fallback: CodexRuntimeProfile,
): CodexRuntimeProfile => {
  const source = isRecord(value) ? value : {};
  const executable = typeof source.executable === "string" && source.executable.trim()
    ? source.executable
    : fallback.executable;
  const extraArgsSource = source.extraArgs ?? source.extra_args;
  const extraArgs = Array.isArray(extraArgsSource)
    ? extraArgsSource.filter((entry): entry is string => typeof entry === "string")
    : [...fallback.extraArgs];

  return {
    executable,
    extraArgs,
    model: typeof source.model === "string" ? source.model : fallback.model,
    apiKey: typeof (source.apiKey ?? source.api_key) === "string"
      ? String(source.apiKey ?? source.api_key)
      : fallback.apiKey,
    baseUrl: typeof (source.baseUrl ?? source.base_url) === "string"
      ? String(source.baseUrl ?? source.base_url)
      : fallback.baseUrl,
  };
};

const DEFAULT_CLAUDE_RUNTIME_PROFILE: ClaudeRuntimeProfile = {
  executable: "claude",
  startupArgs: [],
  env: {},
  settingsJson: {},
  globalConfigJson: {},
};

const DEFAULT_CODEX_RUNTIME_PROFILE: CodexRuntimeProfile = {
  executable: "codex",
  extraArgs: [],
  model: "",
  apiKey: "",
  baseUrl: "",
};

const getDefaultClaudeRuntimeProfile = (): ClaudeRuntimeProfile => (
  structuredClone(DEFAULT_CLAUDE_RUNTIME_PROFILE)
);

const getDefaultCodexRuntimeProfile = (): CodexRuntimeProfile => (
  structuredClone(DEFAULT_CODEX_RUNTIME_PROFILE)
);

const getDefaultProviderGlobalSettings = (providerId: string): Record<string, unknown> | null => {
  if (providerId === "claude") {
    return cloneJsonRecord(getDefaultClaudeRuntimeProfile());
  }
  if (providerId === "codex") {
    return cloneJsonRecord(getDefaultCodexRuntimeProfile());
  }
  return null;
};

const defaultProviderSettingsMap = (): Record<string, ProviderSettingsPayload> => ({
  claude: {
    global: cloneJsonRecord(getDefaultClaudeRuntimeProfile()),
  },
  codex: {
    global: cloneJsonRecord(getDefaultCodexRuntimeProfile()),
  },
});

const normalizeKnownProviderGlobalSettings = (
  providerId: string,
  value: unknown,
  fallback: Record<string, unknown>,
): Record<string, unknown> => {
  if (providerId === "claude") {
    return normalizeClaudeRuntimeProfile(
      value,
      normalizeClaudeRuntimeProfile(fallback, getDefaultClaudeRuntimeProfile()),
    );
  }
  if (providerId === "codex") {
    return normalizeCodexRuntimeProfile(
      value,
      normalizeCodexRuntimeProfile(fallback, getDefaultCodexRuntimeProfile()),
    );
  }
  return normalizeJsonRecord(value, fallback);
};

const cloneAppSettingsPayload = (settings: AppSettingsPayload): AppSettingsPayload => ({
  general: {
    locale: settings.general.locale,
    terminalCompatibilityMode: settings.general.terminalCompatibilityMode,
    completionNotifications: { ...settings.general.completionNotifications },
    idlePolicy: { ...settings.general.idlePolicy },
  },
  agentDefaults: {
    provider: settings.agentDefaults.provider,
  },
  providers: cloneProviderSettingsMap(settings.providers),
});

const normalizeProvidersMap = (
  value: unknown,
  fallback: Record<string, ProviderSettingsPayload>,
): Record<string, ProviderSettingsPayload> => {
  const next = cloneProviderSettingsMap(fallback);
  if (!isRecord(value)) {
    return next;
  }

  for (const [providerId, providerValue] of Object.entries(value)) {
    const source = isRecord(providerValue) ? providerValue : {};
    const fallbackGlobal = next[providerId]?.global ?? {};
    next[providerId] = {
      global: normalizeKnownProviderGlobalSettings(
        providerId,
        mergeJsonObjects(fallbackGlobal, isRecord(source.global) ? source.global : {}),
        fallbackGlobal,
      ),
    };
  }

  return next;
};

const withLegacyProviderSections = (
  providers: Record<string, ProviderSettingsPayload>,
  legacy: LegacyAppSettings,
): Record<string, ProviderSettingsPayload> => {
  const next = cloneProviderSettingsMap(providers);

  if (legacy.claude?.global) {
    next.claude = {
      global: normalizeKnownProviderGlobalSettings(
        "claude",
        legacy.claude.global,
        next.claude?.global ?? {},
      ),
    };
  }

  if (legacy.codex?.global) {
    next.codex = {
      global: normalizeKnownProviderGlobalSettings(
        "codex",
        legacy.codex.global,
        next.codex?.global ?? {},
      ),
    };
  }

  return next;
};

export const toAppSettingsPayload = (settings: AppSettings): AppSettingsPayload => (
  cloneAppSettingsPayload(settings)
);

export const defaultAppSettings = (): AppSettings => cloneAppSettingsPayload({
  general: {
    locale: DEFAULT_LOCALE,
    terminalCompatibilityMode: DEFAULT_TERMINAL_COMPATIBILITY_MODE,
    completionNotifications: { ...DEFAULT_COMPLETION_NOTIFICATIONS },
    idlePolicy: { ...DEFAULT_IDLE_POLICY },
  },
  agentDefaults: {
    provider: "claude",
  },
  providers: defaultProviderSettingsMap(),
});

export const cloneAppSettings = (settings: AppSettings): AppSettings => (
  cloneAppSettingsPayload(settings)
);

export const normalizeAppSettings = (
  value: unknown,
  fallback = defaultAppSettings(),
): AppSettings => {
  const fallbackPayload = toAppSettingsPayload(fallback);
  if (!isRecord(value)) {
    return cloneAppSettings(fallback);
  }

  const generalSource = isRecord(value.general) ? value.general : {};
  const legacy = value as LegacyAppSettings;
  const providers = withLegacyProviderSections(
    normalizeProvidersMap(legacy.providers, fallbackPayload.providers),
    legacy,
  );

  const payload: AppSettingsPayload = {
    general: {
      locale: readLocale(generalSource.locale ?? legacy.locale, fallbackPayload.general.locale),
      terminalCompatibilityMode: readTerminalCompatibilityMode(
        generalSource.terminalCompatibilityMode
          ?? generalSource.terminal_compatibility_mode
          ?? legacy.terminalCompatibilityMode,
        fallbackPayload.general.terminalCompatibilityMode,
      ),
      completionNotifications: normalizeCompletionNotifications(
        generalSource.completionNotifications
          ?? generalSource.completion_notifications
          ?? legacy.completionNotifications,
        fallbackPayload.general.completionNotifications,
      ),
      idlePolicy: normalizeIdlePolicy(
        generalSource.idlePolicy ?? generalSource.idle_policy ?? legacy.idlePolicy,
        fallbackPayload.general.idlePolicy,
      ),
    },
    agentDefaults: {
      provider: typeof (legacy.agentDefaults?.provider) === "string" && legacy.agentDefaults.provider
        ? legacy.agentDefaults.provider
        : fallbackPayload.agentDefaults.provider,
    },
    providers,
  };

  if (typeof legacy.agentCommand === "string" && legacy.agentCommand.trim()) {
    const { executable, startupArgs } = splitLegacyCommand(legacy.agentCommand);
    payload.providers.claude = {
      global: normalizeKnownProviderGlobalSettings(
        "claude",
        {
          ...(payload.providers.claude?.global ?? {}),
          executable,
          startupArgs,
        },
        payload.providers.claude?.global ?? {},
      ),
    };
  }

  return cloneAppSettingsPayload(payload);
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

  return next;
};

export const applyAgentDefaultsPatch = (
  settings: AppSettings,
  patch: Partial<AppSettings["agentDefaults"]>,
): AppSettings => {
  const next = cloneAppSettings(settings);
  next.agentDefaults = {
    ...next.agentDefaults,
    ...patch,
    provider: typeof patch.provider === "string" && patch.provider ? patch.provider : next.agentDefaults.provider,
  };
  return next;
};

export const resolveProviderGlobalSettings = (
  settings: AppSettings,
  providerId: string,
): Record<string, unknown> => {
  const fallbackProviders = defaultProviderSettingsMap();
  const globalSettings = settings.providers[providerId]?.global ?? fallbackProviders[providerId]?.global ?? {};
  return cloneJsonRecord(globalSettings);
};

export const applyProviderGlobalPatch = (
  settings: AppSettings,
  providerId: string,
  pathOrPatch: readonly string[] | Record<string, unknown>,
  value?: unknown,
): AppSettings => {
  const next = cloneAppSettings(settings);
  const currentGlobal = next.providers[providerId]?.global ?? resolveProviderGlobalSettings(next, providerId);

  const nextGlobal = Array.isArray(pathOrPatch)
    ? setJsonPath(currentGlobal, pathOrPatch, value)
    : mergeJsonObjects(currentGlobal, pathOrPatch);

  next.providers[providerId] = {
    global: normalizeKnownProviderGlobalSettings(providerId, nextGlobal, currentGlobal),
  };

  return next;
};

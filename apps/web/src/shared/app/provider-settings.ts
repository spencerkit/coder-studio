import type { Locale } from "../../i18n";
import { BUILTIN_PROVIDER_MANIFESTS } from "../../features/providers/registry";
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

const defaultProviderSettingsMap = (): Record<string, ProviderSettingsPayload> => (
  Object.fromEntries(
    BUILTIN_PROVIDER_MANIFESTS.map((manifest) => [
      manifest.id,
      { global: cloneJsonRecord(manifest.settingsDefaults) },
    ]),
  )
);

const getDefaultProviderGlobalSettings = (providerId: string): Record<string, unknown> | null => {
  const defaults = defaultProviderSettingsMap()[providerId]?.global;
  return defaults ? cloneJsonRecord(defaults) : null;
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

const cloneClaudeRuntimeProfile = (
  profile: ClaudeRuntimeProfile,
): ClaudeRuntimeProfile => ({
  executable: profile.executable,
  startupArgs: [...profile.startupArgs],
  env: { ...profile.env },
  settingsJson: cloneJsonRecord(profile.settingsJson),
  globalConfigJson: cloneJsonRecord(profile.globalConfigJson),
});

const cloneCodexRuntimeProfile = (
  profile: CodexRuntimeProfile,
): CodexRuntimeProfile => ({
  executable: profile.executable,
  extraArgs: [...profile.extraArgs],
  model: profile.model,
  approvalPolicy: profile.approvalPolicy,
  sandboxMode: profile.sandboxMode,
  webSearch: profile.webSearch,
  modelReasoningEffort: profile.modelReasoningEffort,
  env: { ...profile.env },
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
    approvalPolicy: typeof (source.approvalPolicy ?? source.approval_policy) === "string"
      ? String(source.approvalPolicy ?? source.approval_policy)
      : fallback.approvalPolicy,
    sandboxMode: typeof (source.sandboxMode ?? source.sandbox_mode) === "string"
      ? String(source.sandboxMode ?? source.sandbox_mode)
      : fallback.sandboxMode,
    webSearch: typeof (source.webSearch ?? source.web_search) === "string"
      ? String(source.webSearch ?? source.web_search)
      : fallback.webSearch,
    modelReasoningEffort: typeof (
      source.modelReasoningEffort ?? source.model_reasoning_effort
    ) === "string"
      ? String(source.modelReasoningEffort ?? source.model_reasoning_effort)
      : fallback.modelReasoningEffort,
    env: normalizeEnv(source.env ?? fallback.env),
  };
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

const formatClaudeRuntimeCommand = (profile: ClaudeRuntimeProfile): string => (
  [profile.executable.trim(), ...profile.startupArgs.map((arg) => arg.trim()).filter(Boolean)]
    .filter(Boolean)
    .join(" ")
);

const formatCodexRuntimeCommand = (profile: CodexRuntimeProfile): string => (
  [
    profile.executable.trim(),
    ...profile.extraArgs.map((arg) => arg.trim()).filter(Boolean),
    ...buildCodexConfigOverrideArgs(profile),
  ]
    .filter(Boolean)
    .join(" ")
);

const formatGenericRuntimeCommand = (globalSettings: Record<string, unknown>): string => {
  const executable = typeof globalSettings.executable === "string"
    ? globalSettings.executable.trim()
    : "";
  const argsSource = Array.isArray(globalSettings.startupArgs)
    ? globalSettings.startupArgs
    : Array.isArray(globalSettings.extraArgs)
      ? globalSettings.extraArgs
      : Array.isArray(globalSettings.args)
        ? globalSettings.args
        : [];
  const args = argsSource.filter((entry): entry is string => typeof entry === "string")
    .map((arg) => arg.trim())
    .filter(Boolean);

  return [executable, ...args].filter(Boolean).join(" ");
};

const resolveClaudeCompatibilityProfile = (payload: AppSettingsPayload): ClaudeRuntimeProfile => {
  const fallbackProviders = defaultProviderSettingsMap();
  return normalizeClaudeRuntimeProfile(
    payload.providers.claude?.global,
    normalizeClaudeRuntimeProfile(fallbackProviders.claude?.global, {
      executable: "claude",
      startupArgs: [],
      env: {},
      settingsJson: {},
      globalConfigJson: {},
    }),
  );
};

const resolveCodexCompatibilityProfile = (payload: AppSettingsPayload): CodexRuntimeProfile => {
  const fallbackProviders = defaultProviderSettingsMap();
  return normalizeCodexRuntimeProfile(
    payload.providers.codex?.global,
    normalizeCodexRuntimeProfile(fallbackProviders.codex?.global, {
      executable: "codex",
      extraArgs: [],
      model: "",
      approvalPolicy: "",
      sandboxMode: "",
      webSearch: "",
      modelReasoningEffort: "",
      env: {},
    }),
  );
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

export const canonicalizeProviders = (
  settings: Pick<AppSettings, "providers" | "claude" | "codex">,
): Record<string, ProviderSettingsPayload> => {
  const providers = cloneProviderSettingsMap(settings.providers);
  providers.claude = {
    global: cloneJsonRecord(settings.claude.global),
  };
  providers.codex = {
    global: cloneJsonRecord(settings.codex.global),
  };
  return providers;
};

const resolveRuntimeCommandForProvider = (
  providerId: string,
  providers: Record<string, ProviderSettingsPayload>,
): string => {
  const globalSettings = providers[providerId]?.global ?? getDefaultProviderGlobalSettings(providerId);
  if (!globalSettings) {
    return "";
  }

  if (providerId === "claude") {
    return formatClaudeRuntimeCommand(
      normalizeClaudeRuntimeProfile(globalSettings, resolveClaudeCompatibilityProfile({
        general: {
          locale: DEFAULT_LOCALE,
          terminalCompatibilityMode: DEFAULT_TERMINAL_COMPATIBILITY_MODE,
          completionNotifications: DEFAULT_COMPLETION_NOTIFICATIONS,
          idlePolicy: DEFAULT_IDLE_POLICY,
        },
        agentDefaults: { provider: "claude" },
        providers: defaultProviderSettingsMap(),
      })),
    );
  }
  if (providerId === "codex") {
    return formatCodexRuntimeCommand(
      normalizeCodexRuntimeProfile(globalSettings, resolveCodexCompatibilityProfile({
        general: {
          locale: DEFAULT_LOCALE,
          terminalCompatibilityMode: DEFAULT_TERMINAL_COMPATIBILITY_MODE,
          completionNotifications: DEFAULT_COMPLETION_NOTIFICATIONS,
          idlePolicy: DEFAULT_IDLE_POLICY,
        },
        agentDefaults: { provider: "claude" },
        providers: defaultProviderSettingsMap(),
      })),
    );
  }

  return formatGenericRuntimeCommand(globalSettings);
};

export const resolveRuntimeCommandFromPayload = (
  payload: AppSettingsPayload,
  providerId = payload.agentDefaults.provider,
): string => resolveRuntimeCommandForProvider(providerId, payload.providers);

export const resolveRuntimeCommandFromSettings = (
  settings: Pick<AppSettings, "providers" | "claude" | "codex" | "agentDefaults">,
  providerId = settings.agentDefaults.provider,
): string => resolveRuntimeCommandForProvider(
  providerId,
  canonicalizeProviders(settings as Pick<AppSettings, "providers" | "claude" | "codex">),
);

const syncCompatibilityFields = (payload: AppSettingsPayload): AppSettings => {
  const cloned = cloneAppSettingsPayload(payload);
  const claudeGlobal = resolveClaudeCompatibilityProfile(cloned);
  const codexGlobal = resolveCodexCompatibilityProfile(cloned);

  cloned.providers.claude = {
    global: claudeGlobal,
  };
  cloned.providers.codex = {
    global: codexGlobal,
  };

  return {
    ...cloned,
    claude: {
      global: claudeGlobal,
    },
    codex: {
      global: codexGlobal,
    },
    agentCommand: resolveRuntimeCommandFromPayload(cloned),
    idlePolicy: { ...cloned.general.idlePolicy },
    completionNotifications: { ...cloned.general.completionNotifications },
    terminalCompatibilityMode: cloned.general.terminalCompatibilityMode,
  };
};

const refreshDerivedCompatibilityFields = (settings: AppSettings): AppSettings => {
  const providers = canonicalizeProviders(settings);
  const payload: AppSettingsPayload = cloneAppSettingsPayload({
    general: {
      locale: settings.general.locale,
      terminalCompatibilityMode: settings.general.terminalCompatibilityMode,
      completionNotifications: { ...settings.general.completionNotifications },
      idlePolicy: { ...settings.general.idlePolicy },
    },
    agentDefaults: {
      provider: settings.agentDefaults.provider,
    },
    providers,
  });

  return syncCompatibilityFields(payload);
};

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
      global: mergeJsonObjects(
        fallbackGlobal,
        isRecord(source.global) ? source.global : {},
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
      global: normalizeClaudeRuntimeProfile(
        legacy.claude.global,
        resolveClaudeCompatibilityProfile({
          general: {
            locale: DEFAULT_LOCALE,
            terminalCompatibilityMode: DEFAULT_TERMINAL_COMPATIBILITY_MODE,
            completionNotifications: DEFAULT_COMPLETION_NOTIFICATIONS,
            idlePolicy: DEFAULT_IDLE_POLICY,
          },
          agentDefaults: { provider: "claude" },
          providers: next,
        }),
      ),
    };
  }

  if (legacy.codex?.global) {
    next.codex = {
      global: normalizeCodexRuntimeProfile(
        legacy.codex.global,
        resolveCodexCompatibilityProfile({
          general: {
            locale: DEFAULT_LOCALE,
            terminalCompatibilityMode: DEFAULT_TERMINAL_COMPATIBILITY_MODE,
            completionNotifications: DEFAULT_COMPLETION_NOTIFICATIONS,
            idlePolicy: DEFAULT_IDLE_POLICY,
          },
          agentDefaults: { provider: "claude" },
          providers: next,
        }),
      ),
    };
  }

  return next;
};

export const toAppSettingsPayload = (settings: AppSettings): AppSettingsPayload => (
  cloneAppSettingsPayload({
    general: settings.general,
    agentDefaults: settings.agentDefaults,
    providers: canonicalizeProviders(settings),
  })
);

export const defaultAppSettings = (): AppSettings => syncCompatibilityFields({
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
  refreshDerivedCompatibilityFields(settings)
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

  return syncCompatibilityFields(payload);
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

  return refreshDerivedCompatibilityFields(next);
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
  return refreshDerivedCompatibilityFields(next);
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

  next.providers[providerId] = {
    global: Array.isArray(pathOrPatch)
      ? setJsonPath(currentGlobal, pathOrPatch, value)
      : mergeJsonObjects(currentGlobal, pathOrPatch),
  };

  if (providerId === "claude") {
    next.claude = {
      global: normalizeClaudeRuntimeProfile(next.providers.claude.global, next.claude.global),
    };
  }
  if (providerId === "codex") {
    next.codex = {
      global: normalizeCodexRuntimeProfile(next.providers.codex.global, next.codex.global),
    };
  }

  return refreshDerivedCompatibilityFields(next);
};

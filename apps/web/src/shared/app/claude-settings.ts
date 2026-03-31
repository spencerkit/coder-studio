import type { Locale } from "../../i18n.ts";
import type { ExecTarget } from "../../state/workbench.ts";
import type {
  AppSettings,
  AppSettingsPayload,
  ClaudeSettingsScope,
  ClaudeRuntimeProfile,
  ClaudeTargetOverride,
  CompletionNotificationSettings,
  CodexRuntimeProfile,
  CodexTargetOverride,
  LegacyAppSettings,
  TerminalCompatibilityMode,
} from "../../types/app.ts";

const DEFAULT_LOCALE: Locale = "en";
const DEFAULT_TERMINAL_COMPATIBILITY_MODE: TerminalCompatibilityMode = "standard";
const DEFAULT_CLAUDE_EXECUTABLE = "claude";
const DEFAULT_CODEX_EXECUTABLE = "codex";

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

const cloneCodexTargetOverride = (
  override: CodexTargetOverride | null,
): CodexTargetOverride | null => (
  override
    ? {
        enabled: override.enabled,
        profile: cloneCodexRuntimeProfile(override.profile),
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
  agentDefaults: {
    provider: settings.agentDefaults.provider,
  },
  claude: {
    global: cloneClaudeRuntimeProfile(settings.claude.global),
    overrides: {
      native: cloneClaudeTargetOverride(settings.claude.overrides.native),
      wsl: cloneClaudeTargetOverride(settings.claude.overrides.wsl),
    },
  },
  codex: {
    global: cloneCodexRuntimeProfile(settings.codex.global),
    overrides: {
      native: cloneCodexTargetOverride(settings.codex.overrides.native),
      wsl: cloneCodexTargetOverride(settings.codex.overrides.wsl),
    },
  },
});

const syncCompatibilityFields = (settings: AppSettingsPayload): AppSettings => ({
  ...cloneAppSettingsPayload(settings),
  idlePolicy: cloneIdlePolicy(settings.general.idlePolicy),
  completionNotifications: cloneCompletionNotifications(settings.general.completionNotifications),
  terminalCompatibilityMode: settings.general.terminalCompatibilityMode,
});

const defaultCompletionNotifications = (): CompletionNotificationSettings => ({
  enabled: true,
  onlyWhenBackground: true,
});

const defaultClaudeRuntimeProfile = (): ClaudeRuntimeProfile => ({
  executable: DEFAULT_CLAUDE_EXECUTABLE,
  startupArgs: [],
  env: {},
  settingsJson: {},
  globalConfigJson: {},
});

const defaultCodexRuntimeProfile = (): CodexRuntimeProfile => ({
  executable: DEFAULT_CODEX_EXECUTABLE,
  extraArgs: [],
  model: "",
  approvalPolicy: "",
  sandboxMode: "",
  webSearch: "",
  modelReasoningEffort: "",
  env: {},
});

const pickCodexProfileValue = (overrideValue: string, fallbackValue: string) => (
  overrideValue.trim() || fallbackValue
);

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

const normalizeCodexTargetOverride = (
  value: unknown,
  fallback: CodexRuntimeProfile,
): CodexTargetOverride | null => {
  if (value === null) {
    return null;
  }
  if (!isRecord(value)) {
    return null;
  }

  return {
    enabled: readBoolean(value.enabled, false),
    profile: normalizeCodexRuntimeProfile(value.profile, fallback),
  };
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

export const forceClaudeExecutableDefaults = (settings: AppSettings): AppSettings => {
  const next = cloneAppSettings(settings);
  next.claude.global.executable = DEFAULT_CLAUDE_EXECUTABLE;
  if (next.claude.overrides.native) {
    next.claude.overrides.native.profile.executable = DEFAULT_CLAUDE_EXECUTABLE;
  }
  if (next.claude.overrides.wsl) {
    next.claude.overrides.wsl.profile.executable = DEFAULT_CLAUDE_EXECUTABLE;
  }
  return syncCompatibilityFields(toAppSettingsPayload(next));
};

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
  agentDefaults: {
    provider: "claude",
  },
  claude: {
    global: defaultClaudeRuntimeProfile(),
    overrides: {
      native: null,
      wsl: null,
    },
  },
  codex: {
    global: defaultCodexRuntimeProfile(),
    overrides: {
      native: null,
      wsl: null,
    },
  },
});

export const toAppSettingsPayload = (settings: AppSettings): AppSettingsPayload => (
  cloneAppSettingsPayload({
    general: settings.general,
    agentDefaults: settings.agentDefaults,
    claude: settings.claude,
    codex: settings.codex,
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

  if (!("general" in value) && !("claude" in value) && !("codex" in value)) {
    return mergeLegacySettingsIntoAppSettings(
      fallback,
      value as LegacyAppSettings,
    );
  }

  const generalSource = isRecord(value.general) ? value.general : {};
  const claudeSource = isRecord(value.claude) ? value.claude : {};
  const codexSource = isRecord(value.codex) ? value.codex : {};
  const globalProfile = normalizeClaudeRuntimeProfile(
    claudeSource.global,
    fallbackPayload.claude.global,
  );
  const globalCodexProfile = normalizeCodexRuntimeProfile(
    codexSource.global,
    fallbackPayload.codex.global,
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
    agentDefaults: {
      provider: isRecord(value.agentDefaults)
        && value.agentDefaults.provider === "codex"
        ? "codex"
        : fallbackPayload.agentDefaults.provider,
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
    codex: {
      global: globalCodexProfile,
      overrides: {
        native: normalizeCodexTargetOverride(
          isRecord(codexSource.overrides) ? codexSource.overrides.native : null,
          globalCodexProfile,
        ),
        wsl: normalizeCodexTargetOverride(
          isRecord(codexSource.overrides) ? codexSource.overrides.wsl : null,
          globalCodexProfile,
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

export const applyAgentDefaultsPatch = (
  settings: AppSettings,
  patch: Partial<AppSettings["agentDefaults"]>,
): AppSettings => {
  const next = cloneAppSettings(settings);
  next.agentDefaults = {
    ...next.agentDefaults,
    ...patch,
  };
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

export const resolveCodexRuntimeProfile = (
  settings: AppSettings,
  target: ExecTarget,
): CodexRuntimeProfile => {
  const override = target.type === "native"
    ? settings.codex.overrides.native
    : settings.codex.overrides.wsl;

  if (!override?.enabled) {
    return cloneCodexRuntimeProfile(settings.codex.global);
  }

  return {
    executable: override.profile.executable.trim() || settings.codex.global.executable,
    extraArgs: override.profile.extraArgs.length > 0
      ? [...override.profile.extraArgs]
      : [...settings.codex.global.extraArgs],
    model: pickCodexProfileValue(override.profile.model, settings.codex.global.model),
    approvalPolicy: pickCodexProfileValue(
      override.profile.approvalPolicy,
      settings.codex.global.approvalPolicy,
    ),
    sandboxMode: pickCodexProfileValue(
      override.profile.sandboxMode,
      settings.codex.global.sandboxMode,
    ),
    webSearch: pickCodexProfileValue(
      override.profile.webSearch,
      settings.codex.global.webSearch,
    ),
    modelReasoningEffort: pickCodexProfileValue(
      override.profile.modelReasoningEffort,
      settings.codex.global.modelReasoningEffort,
    ),
    env: {
      ...settings.codex.global.env,
      ...override.profile.env,
    },
  };
};

export const resolveAgentRuntimeCommand = (
  settings: AppSettings,
  target: ExecTarget,
  provider: AppSettings["agentDefaults"]["provider"],
): string => (
  provider === "codex"
    ? formatCodexRuntimeCommand(resolveCodexRuntimeProfile(settings, target))
    : formatClaudeRuntimeCommand(resolveClaudeRuntimeProfile(settings, target))
);

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
): boolean => (
  JSON.stringify(toAppSettingsPayload(left)) === JSON.stringify(toAppSettingsPayload(right))
);

const getScopeOverrideKey = (scope: Exclude<ClaudeSettingsScope, "global">) => (
  scope === "native" ? "native" : "wsl"
);

const ensureClaudeScopeOverride = (
  settings: AppSettings,
  scope: Exclude<ClaudeSettingsScope, "global">,
): ClaudeTargetOverride => {
  const key = getScopeOverrideKey(scope);
  const existing = settings.claude.overrides[key];
  if (existing) {
    return existing;
  }

  const created: ClaudeTargetOverride = {
    enabled: false,
    profile: cloneClaudeRuntimeProfile(settings.claude.global),
  };
  settings.claude.overrides[key] = created;
  return created;
};

const ensureCodexScopeOverride = (
  settings: AppSettings,
  scope: Exclude<ClaudeSettingsScope, "global">,
): CodexTargetOverride => {
  const key = getScopeOverrideKey(scope);
  const existing = settings.codex.overrides[key];
  if (existing) {
    return existing;
  }

  const created: CodexTargetOverride = {
    enabled: false,
    profile: cloneCodexRuntimeProfile(settings.codex.global),
  };
  settings.codex.overrides[key] = created;
  return created;
};

export const getClaudeScopeProfile = (
  settings: AppSettings,
  scope: ClaudeSettingsScope,
): ClaudeRuntimeProfile => (
  scope === "global"
    ? cloneClaudeRuntimeProfile(settings.claude.global)
    : cloneClaudeRuntimeProfile(
        settings.claude.overrides[getScopeOverrideKey(scope)]?.profile
        ?? settings.claude.global,
      )
);

export const getCodexScopeProfile = (
  settings: AppSettings,
  scope: ClaudeSettingsScope,
): CodexRuntimeProfile => (
  scope === "global"
    ? cloneCodexRuntimeProfile(settings.codex.global)
    : cloneCodexRuntimeProfile(
        settings.codex.overrides[getScopeOverrideKey(scope)]?.profile
        ?? settings.codex.global,
      )
);

export const isClaudeScopeOverrideEnabled = (
  settings: AppSettings,
  scope: ClaudeSettingsScope,
): boolean => (
  scope === "global"
    ? true
    : Boolean(settings.claude.overrides[getScopeOverrideKey(scope)]?.enabled)
);

export const isCodexScopeOverrideEnabled = (
  settings: AppSettings,
  scope: ClaudeSettingsScope,
): boolean => (
  scope === "global"
    ? true
    : Boolean(settings.codex.overrides[getScopeOverrideKey(scope)]?.enabled)
);

export const setClaudeScopeOverrideEnabled = (
  settings: AppSettings,
  scope: Exclude<ClaudeSettingsScope, "global">,
  enabled: boolean,
): AppSettings => {
  const next = cloneAppSettings(settings);
  const override = ensureClaudeScopeOverride(next, scope);
  override.enabled = enabled;
  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const setCodexScopeOverrideEnabled = (
  settings: AppSettings,
  scope: Exclude<ClaudeSettingsScope, "global">,
  enabled: boolean,
): AppSettings => {
  const next = cloneAppSettings(settings);
  const override = ensureCodexScopeOverride(next, scope);
  override.enabled = enabled;
  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const patchClaudeStructuredSettings = (
  settings: AppSettings,
  patch: {
    scope: ClaudeSettingsScope;
    executable?: string;
    startupArgs?: string[];
    env?: Record<string, string>;
  },
): AppSettings => {
  const next = cloneAppSettings(settings);
  const profile = patch.scope === "global"
    ? next.claude.global
    : ensureClaudeScopeOverride(next, patch.scope).profile;

  if (typeof patch.executable === "string") {
    profile.executable = patch.executable.trim() || profile.executable;
  }
  if (patch.startupArgs) {
    profile.startupArgs = [...patch.startupArgs];
  }
  if (patch.env) {
    profile.env = { ...patch.env };
  }

  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const patchCodexStructuredSettings = (
  settings: AppSettings,
  patch: {
    scope: ClaudeSettingsScope;
    executable?: string;
    extraArgs?: string[];
    model?: string;
    approvalPolicy?: string;
    sandboxMode?: string;
    webSearch?: string;
    modelReasoningEffort?: string;
    env?: Record<string, string>;
  },
): AppSettings => {
  const next = cloneAppSettings(settings);
  const profile = patch.scope === "global"
    ? next.codex.global
    : ensureCodexScopeOverride(next, patch.scope).profile;

  if (typeof patch.executable === "string") {
    profile.executable = patch.executable.trim() || profile.executable;
  }
  if (patch.extraArgs) {
    profile.extraArgs = [...patch.extraArgs];
  }
  if (typeof patch.model === "string") {
    profile.model = patch.model;
  }
  if (typeof patch.approvalPolicy === "string") {
    profile.approvalPolicy = patch.approvalPolicy;
  }
  if (typeof patch.sandboxMode === "string") {
    profile.sandboxMode = patch.sandboxMode;
  }
  if (typeof patch.webSearch === "string") {
    profile.webSearch = patch.webSearch;
  }
  if (typeof patch.modelReasoningEffort === "string") {
    profile.modelReasoningEffort = patch.modelReasoningEffort;
  }
  if (patch.env) {
    profile.env = { ...patch.env };
  }

  return syncCompatibilityFields(toAppSettingsPayload(next));
};

export const replaceClaudeAdvancedJson = (
  settings: AppSettings,
  patch: {
    scope: ClaudeSettingsScope;
    field: "settingsJson" | "globalConfigJson";
    value: Record<string, unknown>;
  },
): AppSettings => {
  const next = cloneAppSettings(settings);
  const profile = patch.scope === "global"
    ? next.claude.global
    : ensureClaudeScopeOverride(next, patch.scope).profile;
  profile[patch.field] = cloneJsonRecord(patch.value);
  return syncCompatibilityFields(toAppSettingsPayload(next));
};

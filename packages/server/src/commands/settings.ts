/**
 * Settings Commands
 */

import {
  type CustomTerminalProfile,
  DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  isMonitoringSampleIntervalMs,
  isUpdateCheckIntervalSec,
  MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC,
  MAX_SUPERVISOR_RETRY_DELAY_SEC,
  MAX_SUPERVISOR_RETRY_MAX_COUNT,
  type ProviderDefinition,
  resolveSupervisorEvaluationTimeoutSec,
  resolveSupervisorRetryDelaySec,
  resolveSupervisorRetryEnabled,
  resolveSupervisorRetryMaxCount,
  resolveSupervisorRetryOnEvaluatorError,
  resolveSupervisorRetryOnTimeout,
} from "@coder-studio/core";
import { getProviderById as getBuiltInProviderById } from "@coder-studio/providers";
import { z } from "zod";
import { type ConfigType, readConfigFile, writeConfigFile } from "../config/config-io.js";
import {
  SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY,
  SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY,
  SUPERVISOR_RETRY_ENABLED_SETTING_KEY,
  SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY,
  SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY,
  SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY,
} from "../supervisor/settings.js";
import { registerCommand } from "../ws/dispatch.js";

const PersonalizationOverridesSchema = z.object({
  backgroundAssetId: z.string().min(1).nullable().optional(),
  backgroundDimness: z.number().int().min(0).max(100).optional(),
  backgroundBlur: z.number().int().min(0).max(40).optional(),
  glassEnabled: z.boolean().optional(),
  glassIntensity: z.number().int().min(0).max(100).optional(),
  surfaceOpacity: z.number().int().min(0).max(100).optional(),
});

const PERSONALIZATION_OVERRIDE_BRANCHES = ["desktop", "mobile"] as const;
const PERSONALIZATION_OVERRIDE_FIELDS = [
  "backgroundAssetId",
  "backgroundDimness",
  "backgroundBlur",
  "glassEnabled",
  "glassIntensity",
  "surfaceOpacity",
] as const;

const TrimmedNonEmptyStringSchema = z.string().trim().min(1);
const CustomTerminalProfileIdSchema = z.custom<CustomTerminalProfile["id"]>(
  (value) => typeof value === "string" && value.startsWith("custom:"),
  {
    message: "Custom terminal profile ids must start with custom:",
  }
);
const CustomTerminalProfileSchema: z.ZodType<CustomTerminalProfile> = z.object({
  id: CustomTerminalProfileIdSchema,
  label: TrimmedNonEmptyStringSchema,
  command: TrimmedNonEmptyStringSchema,
  args: z.array(z.string()).optional(),
  icon: z.string().optional(),
});

const CustomTerminalProfilesSchema: z.ZodType<CustomTerminalProfile[]> = z
  .array(CustomTerminalProfileSchema)
  .superRefine((profiles, issueCtx) => {
    const seen = new Set<string>();

    for (const [index, profile] of profiles.entries()) {
      if (!seen.has(profile.id)) {
        seen.add(profile.id);
        continue;
      }

      issueCtx.addIssue({
        code: "custom",
        message: `Duplicate terminal profile id: ${profile.id}`,
        path: [index, "id"],
      });
    }
  });

// Settings schema
const SettingsSchema = z.object({
  defaultProviderId: z.string().optional(),
  notifications: z
    .object({
      enabled: z.boolean().optional(),
      soundEnabled: z.boolean().optional(),
      // Legacy field — accepted for backward compat with older clients but
      // no longer surfaced in the UI. The web client now picks the channel
      // automatically based on workspace focus + page visibility.
      onlyWhenBackgrounded: z.boolean().optional(),
    })
    .optional(),
  supervisor: z
    .object({
      evaluationTimeoutSec: z
        .number()
        .int()
        .min(1)
        .max(MAX_SUPERVISOR_EVALUATION_TIMEOUT_SEC)
        .default(DEFAULT_SUPERVISOR_EVALUATION_TIMEOUT_SEC)
        .optional(),
      retryEnabled: z.boolean().optional(),
      retryMaxCount: z.number().int().min(0).max(MAX_SUPERVISOR_RETRY_MAX_COUNT).optional(),
      retryDelaySec: z.number().int().min(1).max(MAX_SUPERVISOR_RETRY_DELAY_SEC).optional(),
      retryOnTimeout: z.boolean().optional(),
      retryOnEvaluatorError: z.boolean().optional(),
    })
    .optional(),
  appearance: z
    .object({
      theme: z.enum(["dark", "light"]).optional(),
      themeId: z.string().optional(),
      terminalRenderer: z.enum(["standard", "compatibility"]).optional(),
      terminalCopyOnSelect: z.boolean().optional(),
      terminalFontSize: z.number().int().min(10).max(18).optional(),
      desktopTerminalFontSize: z.number().int().min(10).max(18).optional(),
      mobileTerminalFontSize: z.number().int().min(10).max(18).optional(),
      locale: z.enum(["zh", "en"]).optional(),
      personalization: z
        .object({
          version: z.literal(1).optional(),
          common: z
            .object({
              backgroundMode: z.enum(["none", "image"]).optional(),
              backgroundAssetId: z.string().min(1).nullable().optional(),
              backgroundFit: z.enum(["cover", "contain"]).optional(),
              backgroundDimness: z.number().int().min(0).max(100).optional(),
              backgroundBlur: z.number().int().min(0).max(40).optional(),
              glassEnabled: z.boolean().optional(),
              glassIntensity: z.number().int().min(0).max(100).optional(),
              surfaceOpacity: z.number().int().min(0).max(100).optional(),
            })
            .optional(),
          desktop: PersonalizationOverridesSchema.optional(),
          mobile: PersonalizationOverridesSchema.optional(),
        })
        .optional(),
    })
    .optional(),
  lsp: z
    .object({
      mode: z.enum(["auto", "off"]).optional(),
    })
    .optional(),
  updates: z
    .object({
      autoCheckEnabled: z.boolean().optional(),
      checkIntervalSec: z.number().int().refine(isUpdateCheckIntervalSec).optional(),
    })
    .optional(),
  monitoring: z
    .object({
      enabled: z.boolean().optional(),
      hostMetricsEnabled: z.boolean().optional(),
      runtimeSummaryEnabled: z.boolean().optional(),
      workspaceAttributionEnabled: z.boolean().optional(),
      subprocessDrilldownEnabled: z.boolean().optional(),
      sampleIntervalMs: z.number().int().refine(isMonitoringSampleIntervalMs).optional(),
    })
    .optional(),
  terminal: z
    .object({
      defaultProfileId: z.string().nullable().optional(),
      profiles: CustomTerminalProfilesSchema.optional(),
    })
    .optional(),
  providers: z.record(z.string(), z.unknown()).optional(),
});

// settings.get
registerCommand("settings.get", z.object({}), async (_args, ctx) => {
  const settings: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(ctx.settingsRepo.getAll())) {
    if (key.startsWith("providers.")) {
      continue;
    }
    settings[key] = value;
  }

  const providerConfigs = ctx.providerConfigRepo.getAll();
  for (const [providerId, config] of Object.entries(providerConfigs)) {
    const provider = findProviderById(ctx.providerRegistry, providerId);
    if (!provider) {
      continue;
    }

    Object.assign(
      settings,
      flattenSettings(sanitizeProviderConfig(provider, config), `providers.${providerId}`)
    );
  }

  if (Object.prototype.hasOwnProperty.call(settings, SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY)) {
    settings[SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY] = resolveSupervisorEvaluationTimeoutSec(
      settings[SUPERVISOR_EVALUATION_TIMEOUT_SETTING_KEY]
    );
  }
  if (Object.prototype.hasOwnProperty.call(settings, SUPERVISOR_RETRY_ENABLED_SETTING_KEY)) {
    settings[SUPERVISOR_RETRY_ENABLED_SETTING_KEY] = resolveSupervisorRetryEnabled(
      settings[SUPERVISOR_RETRY_ENABLED_SETTING_KEY]
    );
  }
  if (Object.prototype.hasOwnProperty.call(settings, SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY)) {
    settings[SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY] = resolveSupervisorRetryMaxCount(
      settings[SUPERVISOR_RETRY_MAX_COUNT_SETTING_KEY]
    );
  }
  if (Object.prototype.hasOwnProperty.call(settings, SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY)) {
    settings[SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY] = resolveSupervisorRetryDelaySec(
      settings[SUPERVISOR_RETRY_DELAY_SEC_SETTING_KEY]
    );
  }
  if (Object.prototype.hasOwnProperty.call(settings, SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY)) {
    settings[SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY] = resolveSupervisorRetryOnTimeout(
      settings[SUPERVISOR_RETRY_ON_TIMEOUT_SETTING_KEY]
    );
  }
  if (
    Object.prototype.hasOwnProperty.call(settings, SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY)
  ) {
    settings[SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY] =
      resolveSupervisorRetryOnEvaluatorError(
        settings[SUPERVISOR_RETRY_ON_EVALUATOR_ERROR_SETTING_KEY]
      );
  }

  return settings;
});

// settings.update
registerCommand(
  "settings.update",
  z.object({
    settings: SettingsSchema,
  }),
  async (args, ctx) => {
    const nextSettings = args.settings as Record<string, unknown>;
    const providers =
      nextSettings.providers &&
      typeof nextSettings.providers === "object" &&
      !Array.isArray(nextSettings.providers)
        ? (nextSettings.providers as Record<string, unknown>)
        : undefined;
    const { providers: _providers, ...nonProviderSettings } = nextSettings;
    const overrideKeysToDelete = resolveAppearancePersonalizationOverrideKeysToDelete(nextSettings);

    // Flatten settings to key-value pairs
    const flatSettings = flattenSettings(nonProviderSettings);
    const nullDeleteKeys = resolveNullSettingsKeysToDelete(flatSettings);

    for (const key of [...overrideKeysToDelete, ...nullDeleteKeys]) {
      ctx.settingsRepo.delete(key);
      delete flatSettings[key];
    }

    for (const [key, value] of Object.entries(flatSettings)) {
      ctx.settingsRepo.set(key, value);
    }

    if (providers) {
      for (const [providerId, config] of Object.entries(providers)) {
        const provider = getProviderByIdOrThrow(ctx.providerRegistry, providerId);
        const existingConfig = ctx.providerConfigRepo.get(providerId);
        ctx.providerConfigRepo.set(
          providerId,
          mergeProviderConfigs(provider, existingConfig, config)
        );
      }
    }

    if (
      flatSettings["updates.autoCheckEnabled"] !== undefined ||
      flatSettings["updates.checkIntervalSec"] !== undefined
    ) {
      ctx.updateService?.reloadScheduleFromSettings();
    }

    if (
      flatSettings["monitoring.enabled"] !== undefined ||
      flatSettings["monitoring.hostMetricsEnabled"] !== undefined ||
      flatSettings["monitoring.runtimeSummaryEnabled"] !== undefined ||
      flatSettings["monitoring.workspaceAttributionEnabled"] !== undefined ||
      flatSettings["monitoring.subprocessDrilldownEnabled"] !== undefined ||
      flatSettings["monitoring.sampleIntervalMs"] !== undefined
    ) {
      ctx.monitoringService?.reloadFromSettings();
    }

    return {
      updated: [
        ...Object.keys(flatSettings),
        ...Object.keys(providers ?? {}).map((providerId) => `providers.${providerId}`),
      ],
    };
  }
);

// settings.previewCommand
registerCommand(
  "settings.previewCommand",
  z.object({
    providerId: z.string(),
    config: z.record(z.string(), z.unknown()),
    workspacePath: z.string().optional(),
  }),
  async (args, ctx) => {
    const provider = getProviderByIdOrThrow(ctx.providerRegistry, args.providerId);
    const command = provider.buildCommand(
      mergeProviderConfigs(provider, ctx.providerConfigRepo.get(provider.id), args.config),
      {
        sessionId: "preview-session",
        workspacePath: args.workspacePath ?? process.cwd(),
      }
    );

    return {
      argv: command.argv,
      cwd: command.cwd,
      env: command.env,
      preview: `${command.argv.join(" ")}${command.cwd ? `  # cwd=${command.cwd}` : ""}`,
    };
  }
);

/**
 * Flatten nested settings object to dot-notation keys
 */
function flattenSettings(obj: Record<string, unknown>, prefix = ""): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(result, flattenSettings(value as Record<string, unknown>, fullKey));
    } else if (value !== undefined) {
      result[fullKey] = value;
    }
  }

  return result;
}

function getProviderByIdOrThrow(
  providerRegistry: ProviderDefinition[],
  providerId: string
): ProviderDefinition {
  const provider = findProviderById(providerRegistry, providerId);
  if (!provider) {
    throw {
      code: "unknown_provider",
      message: `Unknown provider: ${providerId}`,
    };
  }

  return provider;
}

function findProviderById(
  providerRegistry: ProviderDefinition[],
  providerId: string
): ProviderDefinition | undefined {
  return (
    providerRegistry.find((item) => item.id === providerId) ?? getBuiltInProviderById(providerId)
  );
}

function sanitizeProviderConfig(
  provider: ProviderDefinition,
  config: unknown
): Record<string, unknown> {
  const parsed = provider.configSchema.safeParse(config);
  if (parsed.success) {
    return compactProviderConfig(parsed.data as Record<string, unknown>);
  }

  const defaults = provider.defaultConfig as Record<string, unknown>;
  const fallback = provider.configSchema.safeParse(defaults);
  return compactProviderConfig(
    fallback.success ? (fallback.data as Record<string, unknown>) : defaults
  );
}

function mergeProviderConfigs(
  provider: ProviderDefinition,
  existingConfig: unknown,
  nextConfig: unknown
): Record<string, unknown> {
  const merged = {
    ...sanitizeProviderConfig(provider, provider.defaultConfig),
    ...sanitizeProviderConfig(provider, existingConfig),
    ...(nextConfig && typeof nextConfig === "object" && !Array.isArray(nextConfig)
      ? (nextConfig as Record<string, unknown>)
      : {}),
  };

  return compactProviderConfig(provider.configSchema.parse(merged) as Record<string, unknown>);
}

function compactProviderConfig(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => {
      if (value === undefined) {
        return false;
      }
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      if (value && typeof value === "object") {
        return Object.keys(value as Record<string, unknown>).length > 0;
      }
      return true;
    })
  );
}

function resolveNullSettingsKeysToDelete(settings: Record<string, unknown>): string[] {
  return settings["terminal.defaultProfileId"] === null ? ["terminal.defaultProfileId"] : [];
}

function resolveAppearancePersonalizationOverrideKeysToDelete(
  settings: Record<string, unknown>
): string[] {
  const appearance = settings.appearance;
  if (!appearance || typeof appearance !== "object" || Array.isArray(appearance)) {
    return [];
  }

  const personalization = (appearance as Record<string, unknown>).personalization;
  if (!personalization || typeof personalization !== "object" || Array.isArray(personalization)) {
    return [];
  }

  if (!isFullAppearancePersonalizationSnapshot(personalization as Record<string, unknown>)) {
    return [];
  }

  const keysToDelete: string[] = [];

  for (const branch of PERSONALIZATION_OVERRIDE_BRANCHES) {
    const overrides = (personalization as Record<string, unknown>)[branch];
    if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
      continue;
    }

    for (const field of PERSONALIZATION_OVERRIDE_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(overrides, field)) {
        keysToDelete.push(`appearance.personalization.${branch}.${field}`);
      }
    }
  }

  return keysToDelete;
}

function isFullAppearancePersonalizationSnapshot(
  personalization: Record<string, unknown>
): boolean {
  return (
    Object.prototype.hasOwnProperty.call(personalization, "version") &&
    Object.prototype.hasOwnProperty.call(personalization, "common") &&
    Object.prototype.hasOwnProperty.call(personalization, "desktop") &&
    Object.prototype.hasOwnProperty.call(personalization, "mobile")
  );
}

// settings.readConfigFile — read Codex or Claude config file content
registerCommand(
  "settings.readConfigFile",
  z.object({
    configType: z.enum(["codex", "claude"]),
  }),
  async (args) => {
    const result = readConfigFile(args.configType as ConfigType);
    return result;
  }
);

// settings.writeConfigFile — write Codex or Claude config file with backup
registerCommand(
  "settings.writeConfigFile",
  z.object({
    configType: z.enum(["codex", "claude"]),
    content: z.string(),
  }),
  async (args) => {
    const result = writeConfigFile(args.configType as ConfigType, args.content);
    return result;
  }
);

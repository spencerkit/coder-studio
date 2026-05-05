/**
 * Settings Commands
 */

import { z } from "zod";
import { type ConfigType, readConfigFile, writeConfigFile } from "../config/config-io.js";
import {
  isSupportedProviderId,
  mergeProviderLaunchConfig,
  ProviderLaunchConfigInputSchema,
  ProviderSettingsSchema,
  sanitizeProviderLaunchConfig,
} from "../provider-config.js";
import { ProviderConfigRepo } from "../storage/repositories/provider-config-repo.js";
import { registerCommand } from "../ws/dispatch.js";

const EMPTY_CODEX_AUDIT = {
  codex: {
    configPath: "",
    exists: false,
    findings: [],
  },
};

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
  appearance: z
    .object({
      theme: z.enum(["dark"]).optional(),
      terminalRenderer: z.enum(["standard", "compatibility"]).optional(),
      locale: z.enum(["zh", "en"]).optional(),
    })
    .optional(),
  providers: ProviderSettingsSchema.optional(),
});

// settings.get
registerCommand("settings.get", z.object({}), async (_args, ctx) => {
  const row = ctx.db.prepare("SELECT key, value FROM user_settings").all() as Array<{
    key: string;
    value: string;
  }>;

  const settings: Record<string, unknown> = {};
  for (const { key, value } of row) {
    if (key.startsWith("providers.")) {
      continue;
    }

    try {
      settings[key] = JSON.parse(value);
    } catch {
      settings[key] = value;
    }
  }

  const providerConfigRepo = new ProviderConfigRepo(ctx.db);
  const providerConfigs = providerConfigRepo.getAll();
  for (const [providerId, config] of Object.entries(providerConfigs)) {
    if (!isSupportedProviderId(providerId)) {
      continue;
    }

    Object.assign(
      settings,
      flattenSettings(sanitizeProviderLaunchConfig(config), `providers.${providerId}`)
    );
  }

  // Surface config drift (Codex config.toml interfering settings) so the
  // web UI can show a banner + cleanup action. Cheap to compute on every
  // settings.get — it's a single file read + a couple regex passes.
  try {
    settings.externalConfigAudit = ctx.codexConfigAudit?.audit() ?? EMPTY_CODEX_AUDIT;
  } catch {
    // Never let a broken audit take down settings fetch.
    settings.externalConfigAudit = null;
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
    const providerConfigRepo = new ProviderConfigRepo(ctx.db);
    const nextSettings = args.settings as Record<string, unknown>;
    const providers =
      nextSettings.providers &&
      typeof nextSettings.providers === "object" &&
      !Array.isArray(nextSettings.providers)
        ? (nextSettings.providers as Record<string, unknown>)
        : undefined;
    const { providers: _providers, ...nonProviderSettings } = nextSettings;

    // Flatten settings to key-value pairs
    const flatSettings = flattenSettings(nonProviderSettings);

    // Update each setting
    const stmt = ctx.db.prepare(`
      INSERT INTO user_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    for (const [key, value] of Object.entries(flatSettings)) {
      stmt.run(key, JSON.stringify(value));
    }

    if (providers) {
      for (const [providerId, config] of Object.entries(providers)) {
        providerConfigRepo.set(providerId, sanitizeProviderLaunchConfig(config));
      }
    }

    return {
      updated: [
        ...Object.keys(flatSettings),
        ...Object.keys(providers ?? {}).map((providerId) => `providers.${providerId}`),
      ],
    };
  }
);

// settings.cleanupCodexConfig — user opts in to removing interfering entries
// from `~/.codex/config.toml`. A backup is written next to the file before
// any mutation; the backup path is returned so the UI can show it.
registerCommand(
  "settings.cleanupCodexConfig",
  z.object({
    removeIds: z.array(z.enum(["toml_notify", "toml_codex_hooks"])).min(1),
  }),
  async (args, ctx) => {
    const result = ctx.codexConfigAudit?.cleanup(args.removeIds) ?? {
      removed: [],
      backupPath: null,
      noop: true,
    };
    return {
      removed: result.removed,
      backupPath: result.backupPath,
      noop: result.noop,
      audit: ctx.codexConfigAudit?.audit() ?? EMPTY_CODEX_AUDIT,
    };
  }
);

// settings.previewCommand
registerCommand(
  "settings.previewCommand",
  z.object({
    providerId: z.string(),
    config: ProviderLaunchConfigInputSchema,
    workspacePath: z.string().optional(),
  }),
  async (args, ctx) => {
    const provider = ctx.providerRegistry.find((item) => item.id === args.providerId);

    if (!provider) {
      throw new Error(`Unknown provider: ${args.providerId}`);
    }

    const command = provider.buildCommand(mergeProviderLaunchConfig(provider, args.config), {
      sessionId: "preview-session",
      workspacePath: args.workspacePath ?? process.cwd(),
    });

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

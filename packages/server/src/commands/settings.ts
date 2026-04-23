/**
 * Settings Commands
 */

import { z } from 'zod';
import { registerCommand } from '../ws/dispatch.js';

// Settings schema
const SettingsSchema = z.object({
  defaultProviderId: z.string().optional(),
  notifications: z.object({
    enabled: z.boolean().optional(),
    soundEnabled: z.boolean().optional(),
    // Legacy field — accepted for backward compat with older clients but
    // no longer surfaced in the UI. The web client now picks the channel
    // automatically based on workspace focus + page visibility.
    onlyWhenBackgrounded: z.boolean().optional(),
  }).optional(),
  appearance: z.object({
    theme: z.enum(['dark']).optional(),
    terminalRenderer: z.enum(['standard', 'compatibility']).optional(),
    locale: z.enum(['zh', 'en']).optional(),
  }).optional(),
  providers: z.object({
    apiKey: z.string().optional(),
    model: z.string().optional(),
  }).optional(),
});

// settings.get
registerCommand(
  'settings.get',
  z.object({}),
  async (_args, ctx) => {
    const row = ctx.db
      .prepare('SELECT key, value FROM user_settings')
      .all() as Array<{ key: string; value: string }>;

    const settings: Record<string, unknown> = {};
    for (const { key, value } of row) {
      try {
        settings[key] = JSON.parse(value);
      } catch {
        settings[key] = value;
      }
    }

    const hookRegistrations = ctx.hooksMgr.listRegistrations();
    settings.hookRegistrations = hookRegistrations;

    // Surface config drift (Codex config.toml interfering settings) so the
    // web UI can show a banner + cleanup action. Cheap to compute on every
    // settings.get — it's a single file read + a couple regex passes.
    try {
      settings.externalConfigAudit = ctx.hooksMgr.auditExternalConfigs();
    } catch {
      // Never let a broken audit take down settings fetch.
      settings.externalConfigAudit = null;
    }

    return settings;
  }
);

// settings.update
registerCommand(
  'settings.update',
  z.object({
    settings: SettingsSchema,
  }),
  async (args, ctx) => {
    // Flatten settings to key-value pairs
    const flatSettings = flattenSettings(args.settings);

    // Update each setting
    const stmt = ctx.db.prepare(`
      INSERT INTO user_settings (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `);

    for (const [key, value] of Object.entries(flatSettings)) {
      stmt.run(key, JSON.stringify(value));
    }

    return { updated: Object.keys(flatSettings) };
  }
);

// settings.cleanupCodexConfig — user opts in to removing interfering entries
// from `~/.codex/config.toml`. A backup is written next to the file before
// any mutation; the backup path is returned so the UI can show it.
registerCommand(
  'settings.cleanupCodexConfig',
  z.object({
    removeIds: z
      .array(z.enum(['toml_notify', 'toml_codex_hooks']))
      .min(1),
  }),
  async (args, ctx) => {
    const result = ctx.hooksMgr.cleanupCodexConfig(args.removeIds);
    return {
      removed: result.removed,
      backupPath: result.backupPath,
      noop: result.noop,
      audit: ctx.hooksMgr.auditExternalConfigs(),
    };
  }
);

// settings.previewCommand
registerCommand(
  'settings.previewCommand',
  z.object({
    providerId: z.string(),
    config: z.object({}).passthrough(),
    workspacePath: z.string().optional(),
  }),
  async (args, ctx) => {
    const provider = ctx.providerRegistry.find((item) => item.id === args.providerId);

    if (!provider) {
      throw new Error(`Unknown provider: ${args.providerId}`);
    }

    const command = provider.buildCommand(args.config, {
      sessionId: 'preview-session',
      workspacePath: args.workspacePath ?? process.cwd(),
    });

    return {
      argv: command.argv,
      cwd: command.cwd,
      env: command.env,
      preview: `${command.argv.join(' ')}${command.cwd ? `  # cwd=${command.cwd}` : ''}`,
    };
  }
);

/**
 * Flatten nested settings object to dot-notation keys
 */
function flattenSettings(obj: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (value && typeof value === 'object' && !Array.isArray(value)) {
      Object.assign(result, flattenSettings(value as Record<string, unknown>, fullKey));
    } else if (value !== undefined) {
      result[fullKey] = value;
    }
  }

  return result;
}

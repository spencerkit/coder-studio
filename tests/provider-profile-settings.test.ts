import test from "node:test";
import assert from "node:assert/strict";
import { createTranslator } from "../apps/web/src/i18n";
import {
  applyProviderGlobalPatch,
  defaultAppSettings,
  getCompletionNotifications,
  getIdlePolicy,
  getIdlePolicySyncWorkspaceIds,
  getSettingsLocale,
  mergeLegacySettingsIntoAppSettings,
  normalizeAppSettings,
  resolveProviderGlobalSettings,
} from "../apps/web/src/shared/app/app-settings";
import type {
  AppSettings,
  ClaudeRuntimeProfile,
  CodexRuntimeProfile,
} from "../apps/web/src/types/app";

const resolveClaudeRuntimeProfile = (settings: AppSettings): ClaudeRuntimeProfile => (
  resolveProviderGlobalSettings(settings, "claude")
) as ClaudeRuntimeProfile;

const resolveCodexRuntimeProfile = (settings: AppSettings): CodexRuntimeProfile => (
  resolveProviderGlobalSettings(settings, "codex")
) as CodexRuntimeProfile;

test("mergeLegacySettingsIntoAppSettings migrates launch command into claude provider globals", () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: "claude-nightly --verbose",
    completionNotifications: { enabled: true, onlyWhenBackground: true },
  });

  assert.equal(merged.providers.claude.global.executable, "claude-nightly");
  assert.deepEqual(merged.providers.claude.global.startupArgs, ["--verbose"]);
  assert.equal(Reflect.has(merged, "claude"), false);
});

test("mergeLegacySettingsIntoAppSettings preserves quoted executable paths and args", () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: "\"C:\\Program Files\\Claude\\claude.exe\" --model \"claude 3.7 sonnet\" --append 'nightly build'",
  });

  assert.equal(merged.providers.claude.global.executable, "C:\\Program Files\\Claude\\claude.exe");
  assert.deepEqual(merged.providers.claude.global.startupArgs, [
    "--model",
    "claude 3.7 sonnet",
    "--append",
    "nightly build",
  ]);
});

test("mergeLegacySettingsIntoAppSettings preserves unquoted windows paths with backslashes", () => {
  const merged = mergeLegacySettingsIntoAppSettings(defaultAppSettings(), {
    agentCommand: "C:\\tools\\claude.exe --verbose",
  });

  assert.equal(merged.providers.claude.global.executable, "C:\\tools\\claude.exe");
  assert.deepEqual(merged.providers.claude.global.startupArgs, ["--verbose"]);
});

test("normalizeAppSettings drops incoming Claude target overrides and keeps one runtime profile", () => {
  const settings = normalizeAppSettings({
    ...defaultAppSettings(),
    claude: {
      global: {
        executable: "claude-global",
        startupArgs: ["--verbose"],
        env: {},
        settingsJson: {
          model: "sonnet",
        },
      },
      overrides: {
        native: {
          enabled: true,
          profile: {
            executable: "claude-native",
            startupArgs: ["--dangerously-skip-permissions"],
            env: {},
            settingsJson: {
              model: "opus",
            },
          },
        },
        wsl: {
          enabled: true,
          profile: {
            executable: "claude-wsl",
            startupArgs: ["--print"],
            env: {},
            settingsJson: {
              model: "haiku",
            },
          },
        },
      },
    },
  });

  const profile = resolveClaudeRuntimeProfile(settings);

  assert.equal(profile.executable, "claude-global");
  assert.deepEqual(profile.startupArgs, ["--verbose"]);
  assert.equal(profile.settingsJson.model, "sonnet");
  assert.equal(Reflect.has(settings, "claude"), false);
});

test("normalizeAppSettings drops incoming Codex target overrides and keeps one runtime profile", () => {
  const settings = normalizeAppSettings({
    ...defaultAppSettings(),
    codex: {
      global: {
        executable: "codex-global",
        extraArgs: ["--full-auto"],
        model: "gpt-5.4",
        apiKey: "codex-key",
        baseUrl: "https://codex.example/v1",
      },
      overrides: {
        native: {
          enabled: true,
          profile: {
            executable: "codex-native",
            extraArgs: ["--search"],
            model: "gpt-5.3",
            apiKey: "other-key",
            baseUrl: "https://override.example/v1",
          },
        },
        wsl: null,
      },
    },
  });

  const profile = resolveCodexRuntimeProfile(settings);

  assert.equal(profile.executable, "codex-global");
  assert.deepEqual(profile.extraArgs, ["--full-auto"]);
  assert.equal(profile.model, "gpt-5.4");
  assert.equal(profile.apiKey, "codex-key");
  assert.equal(profile.baseUrl, "https://codex.example/v1");
  assert.equal(Reflect.has(settings, "codex"), false);
});

test("getIdlePolicySyncWorkspaceIds waits for confirmed settings hydration", () => {
  const settings = defaultAppSettings();
  settings.general.idlePolicy.idleMinutes = 25;

  const tabs = [
    {
      id: "ws-1",
      idlePolicy: defaultAppSettings().general.idlePolicy,
    },
  ];

  assert.deepEqual(getIdlePolicySyncWorkspaceIds(tabs, settings.general.idlePolicy, false), []);
  assert.deepEqual(getIdlePolicySyncWorkspaceIds(tabs, settings.general.idlePolicy, true), ["ws-1"]);
});

test("canonical settings selectors read shared general settings", () => {
  const settings = defaultAppSettings();
  settings.general.locale = "zh";
  settings.general.idlePolicy.idleMinutes = 18;
  settings.general.completionNotifications.onlyWhenBackground = false;

  assert.equal(getSettingsLocale(settings), "zh");
  assert.equal(getIdlePolicy(settings).idleMinutes, 18);
  assert.equal(getCompletionNotifications(settings).onlyWhenBackground, false);
});

test("applyProviderGlobalPatch can reset only Claude executable defaults without touching Codex", () => {
  const configured = applyProviderGlobalPatch(defaultAppSettings(), "claude", {
    executable: "claude-nightly",
  });
  const settings = applyProviderGlobalPatch(configured, "codex", {
    executable: "codex-nightly",
  });

  const next = applyProviderGlobalPatch(settings, "claude", {
    executable: "claude",
  });

  assert.equal(next.providers.claude.global.executable, "claude");
  assert.equal(next.providers.codex.global.executable, "codex-nightly");
});

test("applyProviderGlobalPatch updates the single Claude profile directly", () => {
  const next = applyProviderGlobalPatch(defaultAppSettings(), "claude", {
    executable: "claude-nightly",
    startupArgs: ["--dangerously-skip-permissions"],
    env: { ANTHROPIC_API_KEY: "secret" },
  });

  assert.equal(next.providers.claude.global.executable, "claude-nightly");
  assert.deepEqual(next.providers.claude.global.startupArgs, ["--dangerously-skip-permissions"]);
  assert.deepEqual(next.providers.claude.global.env, { ANTHROPIC_API_KEY: "secret" });
});

test("applyProviderGlobalPatch updates the single Codex profile directly", () => {
  const next = applyProviderGlobalPatch(defaultAppSettings(), "codex", {
    executable: "codex-nightly",
    extraArgs: ["--full-auto"],
    model: "gpt-5.4",
    apiKey: "codex-key",
    baseUrl: "https://codex.example/v1",
  });

  assert.equal(next.providers.codex.global.executable, "codex-nightly");
  assert.deepEqual(next.providers.codex.global.extraArgs, ["--full-auto"]);
  assert.equal(next.providers.codex.global.model, "gpt-5.4");
  assert.equal(next.providers.codex.global.apiKey, "codex-key");
  assert.equal(next.providers.codex.global.baseUrl, "https://codex.example/v1");
});

test("applyProviderGlobalPatch replaces nested advanced Claude json directly on provider globals", () => {
  const next = applyProviderGlobalPatch(defaultAppSettings(), "claude", {
    settingsJson: {
      model: "claude-opus",
      sandbox: {
        enabled: true,
      },
    },
  });

  assert.deepEqual(next.providers.claude.global.settingsJson, {
    model: "claude-opus",
    sandbox: {
      enabled: true,
    },
  });
});

test("translator exposes provider settings keys", () => {
  const en = createTranslator("en") as (key: string, params?: Record<string, string | number>) => string;
  const zh = createTranslator("zh") as (key: string, params?: Record<string, string | number>) => string;

  assert.equal(en("draftModeNew"), "draftModeNew");
  assert.equal(en("claudeSettingsTitle"), "claudeSettingsTitle");
  assert.equal(zh("claudeStartupSection"), "claudeStartupSection");
  assert.equal(en("claudeAuthSection"), "claudeAuthSection");
  assert.equal(en("claudePermissionModeHelp"), "claudePermissionModeHelp");
  assert.equal(en("claudeAuthTokenHelp"), "claudeAuthTokenHelp");
  assert.equal(en("claudeAuthTokenMeta"), "claudeAuthTokenMeta");
  assert.equal(en("claudeModelPlaceholder"), "claudeModelPlaceholder");
  assert.equal(en("codexApiKey"), "codexApiKey");
  assert.equal(en("codexApiKeyHint"), "codexApiKeyHint");
  assert.equal(zh("codexBaseUrl"), "codexBaseUrl");
  assert.equal(en("claudeSelectUnsetOption"), "claudeSelectUnsetOption");
  assert.equal(en("claudeEditorModeVimOption"), "claudeEditorModeVimOption");
  assert.equal(en("claudeShowSecret"), "claudeShowSecret");
  assert.equal(zh("claudeHideSecret"), "claudeHideSecret");
  assert.equal(en("claudeApiKeyHelperHelp"), "claudeApiKeyHelperHelp");
  assert.equal(zh("claudeAuthSectionHint"), "claudeAuthSectionHint");
  assert.equal(zh("claudeCleanupDaysMeta"), "claudeCleanupDaysMeta");
  assert.equal(zh("claudeExtraStartupArgsPlaceholder"), "claudeExtraStartupArgsPlaceholder");
  assert.equal(zh("claudeVerbose"), "claudeVerbose");
  assert.equal(en("claudeJsonInvalid"), "claudeJsonInvalid");
});

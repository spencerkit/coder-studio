import test from "node:test";
import assert from "node:assert/strict";
import {
  applyGeneralSettingsPatch,
  applyAgentDefaultsPatch,
  applyProviderGlobalPatch,
  cloneAppSettings,
  defaultAppSettings,
  getCompletionNotifications,
  getIdlePolicy,
  getSettingsLocale,
  normalizeAppSettings,
  resolveProviderGlobalSettings,
  toAppSettingsPayload,
} from "../apps/web/src/shared/app/app-settings";

test("normalizeAppSettings migrates legacy top-level provider globals into providers map", () => {
  const settings = normalizeAppSettings({
    claude: {
      global: {
        executable: "claude-nightly",
        startupArgs: ["--verbose"],
        env: {},
        settingsJson: { model: "sonnet" },
      },
    },
    codex: {
      global: {
        executable: "codex-nightly",
        extraArgs: ["--full-auto"],
        model: "gpt-5.4",
        apiKey: "codex-key",
        baseUrl: "https://codex.example/v1",
      },
    },
  });

  assert.equal(settings.providers.claude.global.executable, "claude-nightly");
  assert.deepEqual(settings.providers.claude.global.startupArgs, ["--verbose"]);
  assert.equal(settings.providers.codex.global.executable, "codex-nightly");
  assert.deepEqual(settings.providers.codex.global.extraArgs, ["--full-auto"]);
  assert.equal(settings.providers.codex.global.apiKey, "codex-key");
  assert.equal(settings.providers.codex.global.baseUrl, "https://codex.example/v1");
  assert.equal(Reflect.has(settings, "claude"), false);
  assert.equal(Reflect.has(settings, "codex"), false);
});

test("normalizeAppSettings migrates legacy agentCommand into claude provider settings", () => {
  const settings = normalizeAppSettings({
    agentCommand: "custom-claude --verbose",
  });

  assert.equal(settings.providers.claude.global.executable, "custom-claude");
  assert.deepEqual(settings.providers.claude.global.startupArgs, ["--verbose"]);
});

test("applyProviderGlobalPatch updates one provider without mutating other provider settings", () => {
  const settings = defaultAppSettings();
  const withExecutable = applyProviderGlobalPatch(settings, "claude", ["executable"], "claude-nightly");
  const next = applyProviderGlobalPatch(withExecutable, "claude", ["startupArgs"], ["--verbose"]);

  assert.equal(next.providers.claude.global.executable, "claude-nightly");
  assert.deepEqual(next.providers.claude.global.startupArgs, ["--verbose"]);
  assert.equal(next.providers.codex.global.executable, settings.providers.codex.global.executable);
  assert.deepEqual(next.providers.codex.global, settings.providers.codex.global);
});

test("applyProviderGlobalPatch supports path-based nested updates without touching sibling providers", () => {
  const settings = defaultAppSettings();
  assert.deepEqual(Object.keys(settings.providers).sort(), ["claude", "codex"]);

  const next = applyProviderGlobalPatch(settings, "custom-agent", ["env", "CUSTOM_TOKEN"], "secret-token");

  assert.equal(
    ((next.providers["custom-agent"]?.global.env) as Record<string, unknown>).CUSTOM_TOKEN,
    "secret-token",
  );
  assert.deepEqual(next.providers.claude.global, settings.providers.claude.global);
});

test("agentDefaults.provider accepts custom provider ids without reintroducing legacy fields", () => {
  const configured = applyProviderGlobalPatch(defaultAppSettings(), "custom-agent", {
    executable: "custom-agent",
    args: ["--serve"],
  });
  const settings = applyAgentDefaultsPatch(configured, {
    provider: "custom-agent",
  });

  assert.equal(settings.agentDefaults.provider, "custom-agent");
  assert.equal(typeof settings.agentDefaults.provider, "string");
  assert.deepEqual(resolveProviderGlobalSettings(settings, "custom-agent"), {
    executable: "custom-agent",
    args: ["--serve"],
  });
  assert.equal(Reflect.has(settings, "agentCommand"), false);
});

test("custom provider globals stay stable across normalize clone and patch flows", () => {
  const configured = applyProviderGlobalPatch(defaultAppSettings(), "custom-agent", {
    executable: "custom-agent",
    args: ["--serve"],
  });
  const settings = applyAgentDefaultsPatch(configured, {
    provider: "custom-agent",
  });
  const normalized = normalizeAppSettings(settings);
  const cloned = cloneAppSettings(settings);
  const patched = applyGeneralSettingsPatch(settings, {
    terminalCompatibilityMode: "compatibility",
  });
  const baseGlobal = resolveProviderGlobalSettings(settings, "custom-agent");

  assert.deepEqual(resolveProviderGlobalSettings(normalized, "custom-agent"), baseGlobal);
  assert.deepEqual(resolveProviderGlobalSettings(cloned, "custom-agent"), baseGlobal);
  assert.deepEqual(resolveProviderGlobalSettings(patched, "custom-agent"), baseGlobal);
});

test("cloneAppSettings keeps the canonical payload shape", () => {
  const settings = applyProviderGlobalPatch(defaultAppSettings(), "claude", {
    env: { ANTHROPIC_AUTH_TOKEN: "token-1" },
  });
  const updated = applyProviderGlobalPatch(settings, "codex", {
    model: "gpt-5.4",
  });

  const cloned = cloneAppSettings(updated);
  const payload = toAppSettingsPayload(updated);

  assert.equal((payload.providers.claude.global.env as Record<string, unknown>).ANTHROPIC_AUTH_TOKEN, "token-1");
  assert.equal(payload.providers.codex.global.model, "gpt-5.4");
  assert.deepEqual(cloned, payload);
});

test("app-settings exposes canonical general settings selectors", () => {
  const settings = defaultAppSettings();
  settings.general.locale = "zh";
  settings.general.idlePolicy.idleMinutes = 25;
  settings.general.completionNotifications.enabled = false;

  assert.equal(getSettingsLocale(settings), "zh");
  assert.equal(getIdlePolicy(settings).idleMinutes, 25);
  assert.equal(getCompletionNotifications(settings).enabled, false);
});

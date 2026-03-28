import { useEffect, useMemo, useState } from "react";
import type { Locale, Translator } from "../../i18n.ts";
import type {
  AppSettings,
  ClaudeRuntimeProfile,
  ClaudeSettingsScope,
} from "../../types/app.ts";
import {
  formatClaudeRuntimeCommand,
  getClaudeScopeProfile,
  isClaudeScopeOverrideEnabled,
  patchClaudeStructuredSettings,
  replaceClaudeAdvancedJson,
  setClaudeScopeOverrideEnabled,
} from "../../shared/app/claude-settings.ts";

const RESERVED_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_CUSTOM_HEADERS",
] as const;

const readJsonPath = (source: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const cloneJson = (value: Record<string, unknown>) => structuredClone(value);

const removeJsonPath = (source: Record<string, unknown>, path: string[]): Record<string, unknown> => {
  const next = cloneJson(source);
  let current: Record<string, unknown> = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      return next;
    }
    current = child as Record<string, unknown>;
  }
  delete current[path[path.length - 1]];
  return next;
};

const setJsonPath = (
  source: Record<string, unknown>,
  path: string[],
  value: unknown,
): Record<string, unknown> => {
  if (
    value === undefined
    || value === null
    || value === ""
    || (Array.isArray(value) && value.length === 0)
  ) {
    return removeJsonPath(source, path);
  }

  const next = cloneJson(source);
  let current: Record<string, unknown> = next;
  for (let index = 0; index < path.length - 1; index += 1) {
    const key = path[index];
    const child = current[key];
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[path[path.length - 1]] = value as never;
  return next;
};

const readString = (value: unknown) => (typeof value === "string" ? value : "");
const readBoolean = (value: unknown) => value === true;
const readNumber = (value: unknown) => (typeof value === "number" ? value : "");
const readStringList = (value: unknown) => (
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : []
);

const linesToList = (value: string) => value
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

const listToLines = (value: string[]) => value.join("\n");

const envToText = (env: Record<string, string>) => Object.entries(env)
  .filter(([key]) => !RESERVED_ENV_KEYS.includes(key as typeof RESERVED_ENV_KEYS[number]))
  .map(([key, value]) => `${key}=${value}`)
  .join("\n");

const textToEnv = (value: string) => Object.fromEntries(
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const splitIndex = entry.indexOf("=");
      if (splitIndex === -1) {
        return [entry, ""] as const;
      }
      return [entry.slice(0, splitIndex).trim(), entry.slice(splitIndex + 1)] as const;
    })
    .filter(([key]) => Boolean(key)),
);

const stripFlags = (
  startupArgs: string[],
  flags: string[],
): string[] => {
  const next: string[] = [];
  for (let index = 0; index < startupArgs.length; index += 1) {
    const current = startupArgs[index];
    if (!flags.includes(current)) {
      next.push(current);
      continue;
    }
    const takesValue = ![
      "--dangerously-skip-permissions",
      "--allow-dangerously-skip-permissions",
      "--strict-mcp-config",
    ].includes(current);
    if (takesValue) {
      index += 1;
    }
  }
  return next;
};

const readStandaloneFlag = (startupArgs: string[], flag: string) => startupArgs.includes(flag);

const setStandaloneFlag = (startupArgs: string[], flag: string, enabled: boolean) => {
  const next = startupArgs.filter((entry) => entry !== flag);
  return enabled ? [...next, flag] : next;
};

const readFlagValues = (startupArgs: string[], flag: string) => {
  const values: string[] = [];
  for (let index = 0; index < startupArgs.length; index += 1) {
    if (startupArgs[index] !== flag) continue;
    const next = startupArgs[index + 1];
    if (typeof next === "string" && !next.startsWith("--")) {
      values.push(next);
      index += 1;
    }
  }
  return values;
};

const setFlagValues = (startupArgs: string[], flag: string, values: string[]) => {
  const next = stripFlags(startupArgs, [flag]);
  return [
    ...next,
    ...values.flatMap((value) => [flag, value]),
  ];
};

const readSingleFlagValue = (startupArgs: string[], flag: string) => readFlagValues(startupArgs, flag)[0] ?? "";

const setSingleFlagValue = (startupArgs: string[], flag: string, value: string) => (
  setFlagValues(startupArgs, flag, value.trim() ? [value.trim()] : [])
);

const formatJson = (value: Record<string, unknown>) => JSON.stringify(value, null, 2);

const parseJsonObject = (value: string): { data?: Record<string, unknown>; error?: string } => {
  try {
    const parsed = JSON.parse(value || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { error: "JSON must be an object." };
    }
    return { data: parsed as Record<string, unknown> };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

type ClaudeSettingsPanelProps = {
  locale: Locale;
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  t: Translator;
};

export const ClaudeSettingsPanel = ({
  locale,
  settings,
  onChange,
  t,
}: ClaudeSettingsPanelProps) => {
  const [activeScope, setActiveScope] = useState<ClaudeSettingsScope>("global");
  const [settingsJsonDraft, setSettingsJsonDraft] = useState("");
  const [globalConfigJsonDraft, setGlobalConfigJsonDraft] = useState("");
  const [settingsJsonError, setSettingsJsonError] = useState("");
  const [globalConfigJsonError, setGlobalConfigJsonError] = useState("");

  const scopeProfile = useMemo(
    () => getClaudeScopeProfile(settings, activeScope),
    [activeScope, settings],
  );
  const scopeOverrideEnabled = activeScope === "global"
    ? true
    : isClaudeScopeOverrideEnabled(settings, activeScope);
  const settingsJson = scopeProfile.settingsJson;
  const globalConfigJson = scopeProfile.globalConfigJson;

  useEffect(() => {
    setSettingsJsonDraft(formatJson(settingsJson));
    setGlobalConfigJsonDraft(formatJson(globalConfigJson));
    setSettingsJsonError("");
    setGlobalConfigJsonError("");
  }, [activeScope, settingsJson, globalConfigJson]);

  const updateEnv = (updater: (env: Record<string, string>) => Record<string, string>) => {
    onChange(patchClaudeStructuredSettings(settings, {
      scope: activeScope,
      env: updater(scopeProfile.env),
    }));
  };

  const updateStartupArgs = (updater: (startupArgs: string[]) => string[]) => {
    onChange(patchClaudeStructuredSettings(settings, {
      scope: activeScope,
      startupArgs: updater(scopeProfile.startupArgs),
    }));
  };

  const updateSettingsJson = (path: string[], value: unknown) => {
    onChange(replaceClaudeAdvancedJson(settings, {
      scope: activeScope,
      field: "settingsJson",
      value: setJsonPath(settingsJson, path, value),
    }));
  };

  const updateGlobalConfigJson = (path: string[], value: unknown) => {
    onChange(replaceClaudeAdvancedJson(settings, {
      scope: activeScope,
      field: "globalConfigJson",
      value: setJsonPath(globalConfigJson, path, value),
    }));
  };

  const commitSettingsJsonDraft = () => {
    const parsed = parseJsonObject(settingsJsonDraft);
    if (!parsed.data) {
      setSettingsJsonError(parsed.error ?? t("claudeJsonInvalid"));
      return;
    }
    setSettingsJsonError("");
    onChange(replaceClaudeAdvancedJson(settings, {
      scope: activeScope,
      field: "settingsJson",
      value: parsed.data,
    }));
  };

  const commitGlobalConfigJsonDraft = () => {
    const parsed = parseJsonObject(globalConfigJsonDraft);
    if (!parsed.data) {
      setGlobalConfigJsonError(parsed.error ?? t("claudeJsonInvalid"));
      return;
    }
    setGlobalConfigJsonError("");
    onChange(replaceClaudeAdvancedJson(settings, {
      scope: activeScope,
      field: "globalConfigJson",
      value: parsed.data,
    }));
  };

  const extraEnvText = envToText(scopeProfile.env);
  const commandPreview = formatClaudeRuntimeCommand(scopeProfile);

  return (
    <div className="claude-settings-panel">
      <div className="settings-group-card claude-settings-hero">
        <div className="claude-settings-hero-copy">
          <span className="section-kicker">{t("claudeSettingsTitle")}</span>
          <strong>{activeScope === "global" ? t("claudeScopeGlobal") : activeScope === "native" ? t("claudeScopeNative") : t("claudeScopeWsl")}</strong>
          <span>{t("claudeSettingsHint")}</span>
        </div>
        <div className="claude-scope-switcher">
          {(["global", "native", "wsl"] as ClaudeSettingsScope[]).map((scope) => (
            <button
              key={scope}
              type="button"
              className={`settings-pill-option ${activeScope === scope ? "active" : ""}`}
              onClick={() => setActiveScope(scope)}
              data-testid={`claude-scope-${scope}`}
            >
              {scope === "global" ? t("claudeScopeGlobal") : scope === "native" ? t("claudeScopeNative") : t("claudeScopeWsl")}
            </button>
          ))}
        </div>
        {activeScope !== "global" && (
          <div className="claude-override-toggle">
            <label className="toggle">
              <input
                type="checkbox"
                checked={scopeOverrideEnabled}
                onChange={(event) => onChange(setClaudeScopeOverrideEnabled(settings, activeScope, event.target.checked))}
              />
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </label>
            <span>{scopeOverrideEnabled ? t("claudeOverrideEnabled") : t("claudeOverrideInherited")}</span>
          </div>
        )}
        <div className="claude-command-preview">
          <span>{t("claudeCommandPreview")}</span>
          <code>{commandPreview || "claude"}</code>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudeLaunchSection")}</strong>
          <span>{t("claudeLaunchSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-field">
            <span>{t("claudeExecutable")}</span>
            <input
              className="settings-command-field"
              value={scopeProfile.executable}
              onChange={(event) => onChange(patchClaudeStructuredSettings(settings, {
                scope: activeScope,
                executable: event.target.value,
              }))}
              placeholder="claude"
              data-testid="claude-executable-input"
            />
          </label>
          <label className="claude-field">
            <span>{t("claudeStartupArgs")}</span>
            <textarea
              className="claude-textarea"
              value={listToLines(scopeProfile.startupArgs)}
              onChange={(event) => onChange(patchClaudeStructuredSettings(settings, {
                scope: activeScope,
                startupArgs: linesToList(event.target.value),
              }))}
              placeholder="--dangerously-skip-permissions"
              rows={4}
              data-testid="claude-startup-args"
            />
          </label>
          <label className="claude-field">
            <span>{t("claudeApiKey")}</span>
            <input
              className="settings-command-field"
              value={scopeProfile.env.ANTHROPIC_API_KEY ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_API_KEY: event.target.value,
              }))}
            />
          </label>
          <label className="claude-field">
            <span>{t("claudeAuthToken")}</span>
            <input
              className="settings-command-field"
              value={scopeProfile.env.ANTHROPIC_AUTH_TOKEN ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_AUTH_TOKEN: event.target.value,
              }))}
            />
          </label>
          <label className="claude-field">
            <span>{t("claudeBaseUrl")}</span>
            <input
              className="settings-command-field"
              value={scopeProfile.env.ANTHROPIC_BASE_URL ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_BASE_URL: event.target.value,
              }))}
            />
          </label>
          <label className="claude-field">
            <span>{t("claudeCustomHeaders")}</span>
            <textarea
              className="claude-textarea"
              value={scopeProfile.env.ANTHROPIC_CUSTOM_HEADERS ?? ""}
              onChange={(event) => updateEnv((env) => ({
                ...env,
                ANTHROPIC_CUSTOM_HEADERS: event.target.value,
              }))}
              rows={3}
            />
          </label>
          <label className="claude-field">
            <span>{t("claudeApiKeyHelper")}</span>
            <input
              className="settings-command-field"
              value={readString(readJsonPath(settingsJson, ["apiKeyHelper"]))}
              onChange={(event) => updateSettingsJson(["apiKeyHelper"], event.target.value.trim())}
            />
          </label>
          <label className="claude-field claude-field-wide">
            <span>{t("claudeExtraEnv")}</span>
            <textarea
              className="claude-textarea"
              value={extraEnvText}
              onChange={(event) => updateEnv((env) => {
                const next = { ...env };
                for (const key of Object.keys(next)) {
                  if (!RESERVED_ENV_KEYS.includes(key as typeof RESERVED_ENV_KEYS[number])) {
                    delete next[key];
                  }
                }
                return {
                  ...next,
                  ...textToEnv(event.target.value),
                };
              })}
              rows={5}
            />
          </label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudeBehaviorSection")}</strong>
          <span>{t("claudeBehaviorSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-field"><span>{t("claudeModel")}</span><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["model"]))} onChange={(event) => updateSettingsJson(["model"], event.target.value.trim())} data-testid="claude-model-input" /></label>
          <label className="claude-field"><span>{t("claudeFallbackModel")}</span><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["fallbackModel"]))} onChange={(event) => updateSettingsJson(["fallbackModel"], event.target.value.trim())} /></label>
          <label className="claude-field"><span>{t("claudePermissionMode")}</span><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["permissionMode"]))} onChange={(event) => updateSettingsJson(["permissionMode"], event.target.value.trim())} /></label>
          <label className="claude-field"><span>{t("claudeEffort")}</span><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["effort"]))} onChange={(event) => updateSettingsJson(["effort"], event.target.value.trim())} /></label>
          <label className="claude-field"><span>{t("languageLabel")}</span><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["language"]))} onChange={(event) => updateSettingsJson(["language"], event.target.value.trim())} /></label>
          <label className="claude-field"><span>{t("claudeCleanupDays")}</span><input className="settings-command-field" type="number" value={readNumber(readJsonPath(settingsJson, ["cleanupPeriodDays"]))} onChange={(event) => updateSettingsJson(["cleanupPeriodDays"], event.target.value ? Number(event.target.value) : undefined)} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeIncludeGitInstructions")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["includeGitInstructions"]))} onChange={(event) => updateSettingsJson(["includeGitInstructions"], event.target.checked ? true : undefined)} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudePermissionsSection")}</strong>
          <span>{t("claudePermissionsSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-field"><span>{t("claudePermissionsAllow")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["permissions", "allow"])))} onChange={(event) => updateSettingsJson(["permissions", "allow"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudePermissionsAsk")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["permissions", "ask"])))} onChange={(event) => updateSettingsJson(["permissions", "ask"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudePermissionsDeny")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["permissions", "deny"])))} onChange={(event) => updateSettingsJson(["permissions", "deny"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeAdditionalDirectories")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["additionalDirectories"])))} onChange={(event) => updateSettingsJson(["additionalDirectories"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeDefaultMode")}</span><input className="settings-command-field" value={readString(readJsonPath(settingsJson, ["defaultMode"]))} onChange={(event) => updateSettingsJson(["defaultMode"], event.target.value.trim())} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeDisableBypassPermissionsMode")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["disableBypassPermissionsMode"]))} onChange={(event) => updateSettingsJson(["disableBypassPermissionsMode"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-field"><span>{t("claudeAllowedToolsFlag")}</span><textarea className="claude-textarea" rows={3} value={listToLines(readFlagValues(scopeProfile.startupArgs, "--allowedTools"))} onChange={(event) => updateStartupArgs((current) => setFlagValues(current, "--allowedTools", linesToList(event.target.value)))} /></label>
          <label className="claude-field"><span>{t("claudeDisallowedToolsFlag")}</span><textarea className="claude-textarea" rows={3} value={listToLines(readFlagValues(scopeProfile.startupArgs, "--disallowedTools"))} onChange={(event) => updateStartupArgs((current) => setFlagValues(current, "--disallowedTools", linesToList(event.target.value)))} /></label>
          <label className="claude-field"><span>{t("claudeToolsFlag")}</span><textarea className="claude-textarea" rows={3} value={listToLines(readFlagValues(scopeProfile.startupArgs, "--tools"))} onChange={(event) => updateStartupArgs((current) => setFlagValues(current, "--tools", linesToList(event.target.value)))} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeDangerouslySkipPermissions")}</span><input type="checkbox" checked={readStandaloneFlag(scopeProfile.startupArgs, "--dangerously-skip-permissions")} onChange={(event) => updateStartupArgs((current) => setStandaloneFlag(current, "--dangerously-skip-permissions", event.target.checked))} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeAllowDangerouslySkipPermissions")}</span><input type="checkbox" checked={readStandaloneFlag(scopeProfile.startupArgs, "--allow-dangerously-skip-permissions")} onChange={(event) => updateStartupArgs((current) => setStandaloneFlag(current, "--allow-dangerously-skip-permissions", event.target.checked))} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudeSandboxSection")}</strong>
          <span>{t("claudeSandboxSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-inline-toggle"><span>{t("claudeSandboxEnabled")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["sandbox", "enabled"]))} onChange={(event) => updateSettingsJson(["sandbox", "enabled"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeSandboxFailIfUnavailable")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["sandbox", "failIfUnavailable"]))} onChange={(event) => updateSettingsJson(["sandbox", "failIfUnavailable"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeSandboxAutoAllowBash")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["sandbox", "autoAllowBashIfSandboxed"]))} onChange={(event) => updateSettingsJson(["sandbox", "autoAllowBashIfSandboxed"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-field"><span>{t("claudeSandboxExcludedCommands")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["sandbox", "excludedCommands"])))} onChange={(event) => updateSettingsJson(["sandbox", "excludedCommands"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeSandboxAllowUnsandboxed")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["sandbox", "allowUnsandboxedCommands"])))} onChange={(event) => updateSettingsJson(["sandbox", "allowUnsandboxedCommands"], linesToList(event.target.value))} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudeHooksSection")}</strong>
          <span>{t("claudeHooksSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-inline-toggle"><span>{t("claudeDisableAllHooks")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["disableAllHooks"]))} onChange={(event) => updateSettingsJson(["disableAllHooks"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeDisableDeepLinks")}</span><input type="checkbox" checked={readBoolean(readJsonPath(settingsJson, ["disableDeepLinkRegistration"]))} onChange={(event) => updateSettingsJson(["disableDeepLinkRegistration"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-field"><span>{t("claudeAllowedHttpHookUrls")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["allowedHttpHookUrls"])))} onChange={(event) => updateSettingsJson(["allowedHttpHookUrls"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeHttpHookEnvVars")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["httpHookAllowedEnvVars"])))} onChange={(event) => updateSettingsJson(["httpHookAllowedEnvVars"], linesToList(event.target.value))} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudeWorktreeSection")}</strong>
          <span>{t("claudeWorktreeSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-field"><span>{t("claudeWorktreeSymlinkDirs")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["worktree", "symlinkDirectories"])))} onChange={(event) => updateSettingsJson(["worktree", "symlinkDirectories"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeWorktreeSparsePaths")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["worktree", "sparsePaths"])))} onChange={(event) => updateSettingsJson(["worktree", "sparsePaths"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeAddDirFlag")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readFlagValues(scopeProfile.startupArgs, "--add-dir"))} onChange={(event) => updateStartupArgs((current) => setFlagValues(current, "--add-dir", linesToList(event.target.value)))} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudePluginsSection")}</strong>
          <span>{t("claudePluginsSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-field"><span>{t("claudeEnabledPlugins")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["enabledPlugins"])))} onChange={(event) => updateSettingsJson(["enabledPlugins"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeExtraKnownMarketplaces")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readStringList(readJsonPath(settingsJson, ["extraKnownMarketplaces"])))} onChange={(event) => updateSettingsJson(["extraKnownMarketplaces"], linesToList(event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudePluginDir")}</span><input className="settings-command-field" value={readSingleFlagValue(scopeProfile.startupArgs, "--plugin-dir")} onChange={(event) => updateStartupArgs((current) => setSingleFlagValue(current, "--plugin-dir", event.target.value))} /></label>
          <label className="claude-field"><span>{t("claudeMcpConfig")}</span><input className="settings-command-field" value={readSingleFlagValue(scopeProfile.startupArgs, "--mcp-config")} onChange={(event) => updateStartupArgs((current) => setSingleFlagValue(current, "--mcp-config", event.target.value))} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeStrictMcpConfig")}</span><input type="checkbox" checked={readStandaloneFlag(scopeProfile.startupArgs, "--strict-mcp-config")} onChange={(event) => updateStartupArgs((current) => setStandaloneFlag(current, "--strict-mcp-config", event.target.checked))} /></label>
          <label className="claude-field"><span>{t("claudeSettingSources")}</span><textarea className="claude-textarea" rows={4} value={listToLines(readFlagValues(scopeProfile.startupArgs, "--setting-sources"))} onChange={(event) => updateStartupArgs((current) => setFlagValues(current, "--setting-sources", linesToList(event.target.value)))} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudePreferencesSection")}</strong>
          <span>{t("claudePreferencesSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-inline-toggle"><span>{t("claudeAutoConnectIde")}</span><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["autoConnectIde"]))} onChange={(event) => updateGlobalConfigJson(["autoConnectIde"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeAutoInstallIdeExtension")}</span><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["autoInstallIdeExtension"]))} onChange={(event) => updateGlobalConfigJson(["autoInstallIdeExtension"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-field"><span>{t("claudeEditorMode")}</span><input className="settings-command-field" value={readString(readJsonPath(globalConfigJson, ["editorMode"]))} onChange={(event) => updateGlobalConfigJson(["editorMode"], event.target.value.trim())} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeShowTurnDuration")}</span><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["showTurnDuration"]))} onChange={(event) => updateGlobalConfigJson(["showTurnDuration"], event.target.checked ? true : undefined)} /></label>
          <label className="claude-inline-toggle"><span>{t("claudeTerminalProgressBarEnabled")}</span><input type="checkbox" checked={readBoolean(readJsonPath(globalConfigJson, ["terminalProgressBarEnabled"]))} onChange={(event) => updateGlobalConfigJson(["terminalProgressBarEnabled"], event.target.checked ? true : undefined)} /></label>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-section-heading">
          <strong>{t("claudeAdvancedSection")}</strong>
          <span>{t("claudeAdvancedSectionHint")}</span>
        </div>
        <div className="claude-settings-grid">
          <label className="claude-field claude-field-wide">
            <span>{t("claudeSettingsJsonAdvanced")}</span>
            <textarea
              className="claude-json-editor"
              rows={12}
              value={settingsJsonDraft}
              onChange={(event) => setSettingsJsonDraft(event.target.value)}
              onBlur={commitSettingsJsonDraft}
            />
            {settingsJsonError && <span className="claude-json-error">{settingsJsonError}</span>}
          </label>
          <label className="claude-field claude-field-wide">
            <span>{t("claudeGlobalConfigAdvanced")}</span>
            <textarea
              className="claude-json-editor"
              rows={12}
              value={globalConfigJsonDraft}
              onChange={(event) => setGlobalConfigJsonDraft(event.target.value)}
              onBlur={commitGlobalConfigJsonDraft}
            />
            {globalConfigJsonError && <span className="claude-json-error">{globalConfigJsonError}</span>}
          </label>
        </div>
      </div>
    </div>
  );
};

export default ClaudeSettingsPanel;

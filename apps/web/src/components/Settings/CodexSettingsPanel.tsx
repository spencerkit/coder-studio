import { useMemo } from "react";
import type { Locale, Translator } from "../../i18n.ts";
import type { AppSettings } from "../../types/app.ts";
import {
  formatCodexRuntimeCommand,
  patchCodexStructuredSettings,
} from "../../shared/app/claude-settings.ts";

type CodexSettingsPanelProps = {
  locale: Locale;
  settings: AppSettings;
  onChange: (settings: AppSettings) => void;
  t: Translator;
};

const APPROVAL_POLICY_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "untrusted", labelKey: "codexApprovalPolicyUntrustedOption" },
  { value: "on-request", labelKey: "codexApprovalPolicyOnRequestOption" },
  { value: "never", labelKey: "codexApprovalPolicyNeverOption" },
] as const;

const SANDBOX_MODE_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "read-only", labelKey: "codexSandboxReadOnlyOption" },
  { value: "workspace-write", labelKey: "codexSandboxWorkspaceWriteOption" },
  { value: "danger-full-access", labelKey: "codexSandboxDangerFullAccessOption" },
] as const;

const WEB_SEARCH_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "disabled", labelKey: "codexWebSearchDisabledOption" },
  { value: "cached", labelKey: "codexWebSearchCachedOption" },
  { value: "live", labelKey: "codexWebSearchLiveOption" },
] as const;

const REASONING_EFFORT_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "minimal", labelKey: "codexReasoningMinimalOption" },
  { value: "low", labelKey: "codexReasoningLowOption" },
  { value: "medium", labelKey: "codexReasoningMediumOption" },
  { value: "high", labelKey: "codexReasoningHighOption" },
  { value: "xhigh", labelKey: "codexReasoningXhighOption" },
] as const;

const linesToList = (value: string) => value
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

const listToLines = (value: string[]) => value.join("\n");

const envToText = (env: Record<string, string>) => Object.entries(env)
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

const FieldCopy = ({
  label,
  meta,
}: {
  label: string;
  meta?: string;
}) => (
  <div className="claude-field-copy">
    <span className="claude-field-label">
      <span>{label}</span>
    </span>
    {meta ? <span className="claude-field-meta">{meta}</span> : null}
  </div>
);

const TextField = ({
  label,
  meta,
  value,
  onChange,
  placeholder,
  testId,
  className = "",
}: {
  label: string;
  meta?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  testId?: string;
  className?: string;
}) => (
  <label className={`claude-field ${className}`.trim()}>
    <FieldCopy label={label} meta={meta} />
    <input
      className="settings-command-field"
      type="text"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      data-testid={testId}
    />
  </label>
);

const TextareaField = ({
  label,
  meta,
  hint,
  value,
  onChange,
  placeholder,
  rows,
  testId,
}: {
  label: string;
  meta?: string;
  hint?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows: number;
  testId?: string;
}) => (
  <label className="claude-field claude-field-wide">
    <FieldCopy label={label} meta={meta} />
    <textarea
      className="claude-textarea"
      rows={rows}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={placeholder}
      data-testid={testId}
    />
    {hint ? <small>{hint}</small> : null}
  </label>
);

const SelectField = ({
  label,
  meta,
  value,
  onChange,
  options,
  t,
  testId,
}: {
  label: string;
  meta?: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; labelKey: string }>;
  t: Translator;
  testId?: string;
}) => (
  <label className="claude-field claude-field-compact">
    <FieldCopy label={label} meta={meta} />
    <select
      className="settings-command-field"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      data-testid={testId}
    >
      {options.map((option) => (
        <option key={option.value || "unset"} value={option.value}>
          {t(option.labelKey)}
        </option>
      ))}
    </select>
  </label>
);

export const CodexSettingsPanel = ({
  locale: _locale,
  settings,
  onChange,
  t,
}: CodexSettingsPanelProps) => {
  const scopeProfile = useMemo(
    () => settings.codex.global,
    [settings],
  );
  const commandPreview = formatCodexRuntimeCommand(scopeProfile);

  const commitSettings = (nextSettings: AppSettings) => {
    onChange(nextSettings);
  };

  const updateProfile = (
    patch: Parameters<typeof patchCodexStructuredSettings>[1],
  ) => {
    commitSettings(patchCodexStructuredSettings(settings, patch));
  };

  return (
    <div className="claude-settings-panel">
      <div className="settings-group-card">
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{t("codexCommandPreview")}</strong>
            <span>{t("codexCommandPreviewHint")}</span>
          </div>
          <div className="settings-row-control">
            <code className="claude-command-preview-code" data-testid="codex-command-preview">
              {commandPreview || "codex"}
            </code>
          </div>
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid claude-settings-grid--startup">
          <TextField
            className="claude-field-wide"
            label={t("codexExecutable")}
            meta={t("codexExecutableHint")}
            value={scopeProfile.executable}
            onChange={(value) => updateProfile({
              executable: value,
            })}
            placeholder="codex"
            testId="codex-executable"
          />

          <TextareaField
            label={t("codexExtraArgs")}
            meta={t("codexExtraArgsMeta")}
            hint={t("codexExtraArgsHint")}
            value={listToLines(scopeProfile.extraArgs)}
            onChange={(value) => updateProfile({
              extraArgs: linesToList(value),
            })}
            placeholder={t("codexExtraArgsPlaceholder")}
            rows={5}
            testId="codex-extra-args"
          />
        </div>
      </div>

      <div className="settings-group-card">
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{t("codexConfigSection")}</strong>
            <span>{t("codexConfigSectionHint")}</span>
          </div>
        </div>
        <div className="claude-settings-grid">
          <TextField
            label={t("codexModel")}
            meta={t("codexModelHint")}
            value={scopeProfile.model}
            onChange={(value) => updateProfile({
              model: value,
            })}
            placeholder={t("codexModelPlaceholder")}
            testId="codex-model"
          />
          <SelectField
            label={t("codexApprovalPolicy")}
            meta={t("codexApprovalPolicyHint")}
            value={scopeProfile.approvalPolicy}
            onChange={(value) => updateProfile({
              approvalPolicy: value,
            })}
            options={APPROVAL_POLICY_OPTIONS}
            t={t}
            testId="codex-approval-policy"
          />
          <SelectField
            label={t("codexSandboxMode")}
            meta={t("codexSandboxModeHint")}
            value={scopeProfile.sandboxMode}
            onChange={(value) => updateProfile({
              sandboxMode: value,
            })}
            options={SANDBOX_MODE_OPTIONS}
            t={t}
            testId="codex-sandbox-mode"
          />
          <SelectField
            label={t("codexWebSearch")}
            meta={t("codexWebSearchHint")}
            value={scopeProfile.webSearch}
            onChange={(value) => updateProfile({
              webSearch: value,
            })}
            options={WEB_SEARCH_OPTIONS}
            t={t}
            testId="codex-web-search"
          />
          <SelectField
            label={t("codexReasoningEffort")}
            meta={t("codexReasoningEffortHint")}
            value={scopeProfile.modelReasoningEffort}
            onChange={(value) => updateProfile({
              modelReasoningEffort: value,
            })}
            options={REASONING_EFFORT_OPTIONS}
            t={t}
            testId="codex-reasoning-effort"
          />
        </div>
      </div>

      <div className="settings-group-card">
        <div className="claude-settings-grid">
          <TextareaField
            label={t("codexExtraEnv")}
            meta={t("codexExtraEnvMeta")}
            hint={t("codexExtraEnvHint")}
            value={envToText(scopeProfile.env)}
            onChange={(value) => updateProfile({
              env: textToEnv(value),
            })}
            placeholder={t("codexExtraEnvPlaceholder")}
            rows={6}
            testId="codex-extra-env"
          />
        </div>
      </div>
    </div>
  );
};

export default CodexSettingsPanel;

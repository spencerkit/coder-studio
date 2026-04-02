import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import type { Translator } from "../../i18n";
import { getProviderManifest } from "../../features/providers/registry";
import type { ProviderSettingsField } from "../../features/providers/types";
import {
  applyProviderGlobalPatch,
  resolveProviderGlobalSettings,
} from "../../shared/app/provider-settings";
import type { AppSettings, AppSettingsUpdater } from "../../types/app";

type ProviderSettingsPanelProps = {
  providerId: string;
  settings: AppSettings;
  onChange: (updater: AppSettingsUpdater) => void;
  t: Translator;
};

const readPathValue = (source: Record<string, unknown>, path: readonly string[]): unknown => {
  let current: unknown = source;
  for (const segment of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
};

const listToText = (value: unknown): string => (
  Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string").join("\n")
    : ""
);

const textToList = (value: string): string[] => value
  .split("\n")
  .map((entry) => entry.trim())
  .filter(Boolean);

const envMapToText = (value: unknown): string => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "";
  }

  return Object.entries(value)
    .filter((entry): entry is [string, string] => typeof entry[1] === "string")
    .map(([key, envValue]) => `${key}=${envValue}`)
    .join("\n");
};

const textToEnvMap = (value: string): Record<string, string> => Object.fromEntries(
  value
    .split("\n")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      if (separatorIndex === -1) {
        return [entry, ""] as const;
      }
      return [
        entry.slice(0, separatorIndex).trim(),
        entry.slice(separatorIndex + 1),
      ] as const;
    })
    .filter(([key]) => Boolean(key)),
);

const formatJson = (value: unknown): string => (
  JSON.stringify(value ?? {}, null, 2)
);

const parseJson = (value: string): { parsed?: unknown; error?: string } => {
  try {
    return { parsed: JSON.parse(value.trim() || "{}") };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

const FieldCopy = ({
  label,
  hint,
}: {
  label: string;
  hint?: string;
}) => (
  <div className="settings-row-copy">
    <strong>{label}</strong>
    {hint ? <span>{hint}</span> : null}
  </div>
);

export const ProviderSettingsPanel = ({
  providerId,
  settings,
  onChange,
  t,
}: ProviderSettingsPanelProps) => {
  const manifest = getProviderManifest(providerId);
  const providerSettings = resolveProviderGlobalSettings(settings, providerId);
  const [fieldDrafts, setFieldDrafts] = useState<Record<string, string>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    setFieldDrafts({});
    setFieldErrors({});
  }, [providerId]);

  const commitValue = (path: readonly string[], value: unknown) => {
    onChange((current) => applyProviderGlobalPatch(current, providerId, path, value));
  };

  const updateFieldDraft = (fieldId: string, value: string) => {
    setFieldDrafts((current) => ({ ...current, [fieldId]: value }));
  };

  const clearFieldError = (fieldId: string) => {
    setFieldErrors((current) => {
      const next = { ...current };
      delete next[fieldId];
      return next;
    });
  };

  const onTextAreaChange = (
    field: ProviderSettingsField,
    nextDraft: string,
    parse: (value: string) => unknown,
  ) => {
    updateFieldDraft(field.id, nextDraft);
    clearFieldError(field.id);
    commitValue(field.path, parse(nextDraft));
  };

  const onJsonChange = (
    field: ProviderSettingsField,
    event: ChangeEvent<HTMLTextAreaElement>,
  ) => {
    const nextDraft = event.target.value;
    const draftKey = field.id;
    updateFieldDraft(draftKey, nextDraft);

    const parsed = parseJson(nextDraft);
    if (parsed.error) {
      setFieldErrors((current) => ({ ...current, [draftKey]: parsed.error ?? "" }));
      return;
    }

    clearFieldError(draftKey);
    commitValue(field.path, parsed.parsed);
  };

  const renderField = (field: ProviderSettingsField) => {
    const value = readPathValue(providerSettings, field.path);
    const hint = fieldErrors[field.id] || (field.hintKey ? t(field.hintKey) : undefined);
    const placeholder = field.placeholderKey ? t(field.placeholderKey) : field.placeholder;

    if (field.kind === "command" || field.kind === "text") {
      return (
        <div className="settings-row" key={field.id}>
          <FieldCopy label={t(field.labelKey)} hint={hint} />
          <div className="settings-row-control">
            <input
              className="settings-command-field"
              type="text"
              value={typeof value === "string" ? value : ""}
              onChange={(event) => commitValue(field.path, event.target.value)}
              placeholder={placeholder}
              data-testid={`provider-settings-${providerId}-${field.id}`}
            />
          </div>
        </div>
      );
    }

    if (field.kind === "string_list") {
      return (
        <div className="settings-row" key={field.id}>
          <FieldCopy label={t(field.labelKey)} hint={hint} />
          <div className="settings-row-control">
            <textarea
              className="settings-command-field claude-textarea"
              rows={5}
              value={fieldDrafts[field.id] ?? listToText(value)}
              onChange={(event) => onTextAreaChange(field, event.target.value, textToList)}
              placeholder={placeholder}
              data-testid={`provider-settings-${providerId}-${field.id}`}
            />
          </div>
        </div>
      );
    }

    if (field.kind === "env_map") {
      return (
        <div className="settings-row" key={field.id}>
          <FieldCopy label={t(field.labelKey)} hint={hint} />
          <div className="settings-row-control">
            <textarea
              className="settings-command-field claude-textarea"
              rows={6}
              value={fieldDrafts[field.id] ?? envMapToText(value)}
              onChange={(event) => onTextAreaChange(field, event.target.value, textToEnvMap)}
              placeholder={placeholder}
              data-testid={`provider-settings-${providerId}-${field.id}`}
            />
          </div>
        </div>
      );
    }

    if (field.kind === "json") {
      return (
        <div className="settings-row" key={field.id}>
          <FieldCopy label={t(field.labelKey)} hint={hint} />
          <div className="settings-row-control">
            <textarea
              className="settings-command-field claude-textarea"
              rows={8}
              value={fieldDrafts[field.id] ?? formatJson(value)}
              onChange={(event) => onJsonChange(field, event)}
              placeholder={placeholder}
              data-testid={`provider-settings-${providerId}-${field.id}`}
            />
          </div>
        </div>
      );
    }

    if (field.kind === "select") {
      return (
        <div className="settings-row" key={field.id}>
          <FieldCopy label={t(field.labelKey)} hint={hint} />
          <div className="settings-row-control">
            <select
              className="settings-command-field"
              value={typeof value === "string" ? value : ""}
              onChange={(event) => commitValue(field.path, event.target.value)}
              data-testid={`provider-settings-${providerId}-${field.id}`}
            >
              {(field.options ?? []).map((option) => (
                <option key={option.value || "unset"} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </div>
        </div>
      );
    }

    return null;
  };

  if (!manifest) {
    return (
      <div className="settings-group-card settings-group-card--document">
        <div className="settings-row">
          <div className="settings-row-copy">
            <strong>{providerId}</strong>
            <span>{t("providerUnknownHint", { provider: providerId })}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="provider-settings-panel">
      {manifest.settingsSections.map((section) => (
        <div className="settings-group-card settings-group-card--document" key={section.id}>
          <div className="settings-row">
            <div className="settings-row-copy">
              <strong>{t(section.titleKey)}</strong>
              {section.descriptionKey ? <span>{t(section.descriptionKey)}</span> : null}
            </div>
          </div>
          {section.fields.map((field) => renderField(field))}
        </div>
      ))}
    </div>
  );
};

export default ProviderSettingsPanel;

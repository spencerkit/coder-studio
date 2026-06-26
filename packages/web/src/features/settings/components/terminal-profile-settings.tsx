import type { CustomTerminalProfile, TerminalProfile } from "@coder-studio/core";
import { useState } from "react";
import { Button, Input, Select } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";

const SYSTEM_DEFAULT_PROFILE_VALUE = "__system__";

export interface TerminalProfileSettingsChange {
  customProfiles: CustomTerminalProfile[];
  defaultProfileId?: string | null;
}

interface TerminalProfileSettingsProps {
  readonly configuredDefaultProfileId?: string;
  readonly customProfiles: CustomTerminalProfile[];
  readonly profiles: TerminalProfile[];
  readonly resolvedDefaultProfileId: string | null;
  readonly onChange: (next: TerminalProfileSettingsChange) => Promise<boolean>;
}

interface DraftState {
  label: string;
  command: string;
  args: string;
}

const EMPTY_DRAFT: DraftState = {
  label: "",
  command: "",
  args: "",
};

function parseArgs(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function formatArgs(args: readonly string[] | undefined): string {
  return args?.join("\n") ?? "";
}

function formatCommand(profile: CustomTerminalProfile): string {
  return [profile.command, ...(profile.args ?? [])].filter(Boolean).join(" ");
}

function slugifyProfileLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "profile";
}

function createCustomProfileId(
  label: string,
  existingProfiles: readonly CustomTerminalProfile[]
): CustomTerminalProfile["id"] {
  const base = `custom:${slugifyProfileLabel(label)}` as CustomTerminalProfile["id"];
  const existingIds = new Set(existingProfiles.map((profile) => profile.id));
  if (!existingIds.has(base)) {
    return base;
  }

  let suffix = 2;
  while (existingIds.has(`custom:${slugifyProfileLabel(label)}-${suffix}`)) {
    suffix += 1;
  }

  return `custom:${slugifyProfileLabel(label)}-${suffix}` as CustomTerminalProfile["id"];
}

function normalizeCustomProfiles(profiles: readonly CustomTerminalProfile[]) {
  return profiles.map((profile) => ({
    id: profile.id,
    label: profile.label.trim(),
    command: profile.command.trim(),
    args: profile.args ?? [],
    icon: profile.icon,
  }));
}

export function TerminalProfileSettings({
  configuredDefaultProfileId,
  customProfiles,
  profiles,
  resolvedDefaultProfileId,
  onChange,
}: TerminalProfileSettingsProps) {
  const t = useTranslation();
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftState>(EMPTY_DRAFT);
  const detectedProfiles = profiles.filter((profile) => profile.source === "detected");
  const customProfileIds = new Set(customProfiles.map((profile) => profile.id));
  const listedCustomProfileIds = new Set(
    profiles.filter((profile) => profile.source === "custom").map((profile) => profile.id)
  );
  const customProfilesForDefault = [
    ...customProfiles,
    ...profiles
      .filter((profile) => profile.source === "custom" && !customProfileIds.has(profile.id))
      .map(
        (profile): CustomTerminalProfile => ({
          id: profile.id as CustomTerminalProfile["id"],
          label: profile.label,
          command: "",
          args: [],
        })
      ),
  ];
  const normalizedCustomProfiles = normalizeCustomProfiles(customProfiles);
  const defaultProfileOptions = [
    {
      value: SYSTEM_DEFAULT_PROFILE_VALUE,
      label: t("settings.terminal_profiles.system_default"),
    },
    ...detectedProfiles.map((profile) => ({
      value: profile.id,
      label: profile.label,
    })),
    ...customProfilesForDefault.map((profile) => ({
      value: profile.id,
      label: profile.label,
    })),
  ];
  const defaultProfileValue = configuredDefaultProfileId ?? SYSTEM_DEFAULT_PROFILE_VALUE;
  const isDraftValid = draft.label.trim().length > 0 && draft.command.trim().length > 0;
  const effectiveDefaultProfileLabel =
    [
      ...profiles,
      ...customProfiles.map(
        (profile): TerminalProfile => ({
          id: profile.id,
          label: profile.label,
          source: "custom",
          runtime: "native",
          icon: profile.icon ?? "terminal",
        })
      ),
    ].find((profile) => profile.id === resolvedDefaultProfileId)?.label ??
    t("settings.terminal_profiles.none_detected");

  const resetDraft = () => {
    setEditingProfileId(null);
    setDraft(EMPTY_DRAFT);
  };

  const handleDefaultChange = async (value: string) => {
    const nextDefaultProfileId = value === SYSTEM_DEFAULT_PROFILE_VALUE ? null : value;
    await onChange({
      customProfiles: normalizedCustomProfiles,
      defaultProfileId: nextDefaultProfileId,
    });
  };

  const handleSaveDraft = async () => {
    if (!isDraftValid) {
      return;
    }

    const existingProfile = editingProfileId
      ? customProfiles.find((profile) => profile.id === editingProfileId)
      : undefined;
    const nextProfile: CustomTerminalProfile = {
      id:
        existingProfile?.id ??
        createCustomProfileId(
          draft.label,
          customProfiles.filter(() => !editingProfileId)
        ),
      label: draft.label.trim(),
      command: draft.command.trim(),
      args: parseArgs(draft.args),
      icon: existingProfile?.icon,
    };
    const nextCustomProfiles = existingProfile
      ? customProfiles.map((profile) => (profile.id === existingProfile.id ? nextProfile : profile))
      : [...customProfiles, nextProfile];
    const nextDefaultProfileId = existingProfile ? configuredDefaultProfileId : nextProfile.id;
    const saved = await onChange({
      customProfiles: normalizeCustomProfiles(nextCustomProfiles),
      defaultProfileId: nextDefaultProfileId,
    });

    if (saved) {
      resetDraft();
    }
  };

  const handleEdit = (profile: CustomTerminalProfile) => {
    setEditingProfileId(profile.id);
    setDraft({
      label: profile.label,
      command: profile.command,
      args: formatArgs(profile.args),
    });
  };

  const handleDelete = async (profile: CustomTerminalProfile) => {
    const nextCustomProfiles = customProfiles.filter((item) => item.id !== profile.id);
    const saved = await onChange({
      customProfiles: normalizeCustomProfiles(nextCustomProfiles),
      defaultProfileId:
        configuredDefaultProfileId === profile.id ? null : configuredDefaultProfileId,
    });

    if (saved && editingProfileId === profile.id) {
      resetDraft();
    }
  };

  return (
    <div
      className="settings-group"
      id="terminal-profiles"
      style={{ scrollMarginTop: "var(--space-lg)" }}
    >
      <h3 className="settings-group-title">{t("settings.terminal_profiles.title")}</h3>
      <p className="settings-group-desc">{t("settings.terminal_profiles.hint")}</p>

      <div className="settings-config-field settings-config-field--inline">
        <label className="settings-config-label" htmlFor="terminal-default-profile">
          {t("settings.terminal_profiles.default_label")}
        </label>
        <div className="settings-config-control">
          <div style={{ width: "220px", maxWidth: "100%" }}>
            <Select
              desktopMode="listbox"
              id="terminal-default-profile"
              aria-label={t("settings.terminal_profiles.default_label")}
              mobileSheetTitle={t("settings.terminal_profiles.default_label")}
              options={defaultProfileOptions}
              value={defaultProfileValue}
              onValueChange={(value) => {
                void handleDefaultChange(value);
              }}
            />
          </div>
        </div>
      </div>

      <div className="settings-info-row">
        <span className="settings-info-label">
          {t("settings.terminal_profiles.current_default")}
        </span>
        <span className="settings-info-value">{effectiveDefaultProfileLabel}</span>
      </div>

      <div className="settings-info-row">
        <span className="settings-info-label">
          {t("settings.terminal_profiles.detected_profiles")}
        </span>
        <span className="settings-info-value">
          {detectedProfiles.length > 0
            ? detectedProfiles.map((profile) => profile.label).join(", ")
            : t("settings.terminal_profiles.none_detected")}
          {detectedProfiles.length > 0 ? (
            <span className="settings-status-hint">
              {t("settings.terminal_profiles.detected_badge")}
            </span>
          ) : null}
        </span>
      </div>

      {customProfiles.length > 0 ? (
        customProfiles.map((profile) => (
          <div className="settings-toggle-row settings-toggle-row--action" key={profile.id}>
            <div className="settings-toggle-info">
              <span className="settings-toggle-label">{profile.label}</span>
              <span className="settings-toggle-desc">{formatCommand(profile)}</span>
              {!listedCustomProfileIds.has(profile.id) ? (
                <span className="settings-toggle-desc">
                  {t("settings.terminal_profiles.pending_refresh")}
                </span>
              ) : null}
            </div>
            <div className="settings-pills">
              <Button
                size="sm"
                variant="secondary"
                aria-label={t("settings.terminal_profiles.edit_profile", {
                  label: profile.label,
                })}
                onClick={() => handleEdit(profile)}
              >
                {t("common.edit")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={t("settings.terminal_profiles.delete_profile", {
                  label: profile.label,
                })}
                onClick={() => {
                  void handleDelete(profile);
                }}
              >
                {t("common.delete")}
              </Button>
            </div>
          </div>
        ))
      ) : (
        <div className="settings-info-row">
          <span className="settings-info-label">
            {t("settings.terminal_profiles.custom_profiles")}
          </span>
          <span className="settings-info-value">
            {t("settings.terminal_profiles.no_custom_profiles")}
          </span>
        </div>
      )}

      <div className="settings-config-field">
        <label className="settings-config-label" htmlFor="terminal-profile-label">
          {t("settings.terminal_profiles.profile_label")}
        </label>
        <Input
          id="terminal-profile-label"
          value={draft.label}
          onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value }))}
        />
      </div>
      <div className="settings-config-field">
        <label className="settings-config-label" htmlFor="terminal-profile-command">
          {t("settings.terminal_profiles.command")}
        </label>
        <Input
          id="terminal-profile-command"
          value={draft.command}
          onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
        />
      </div>
      <div className="settings-config-field">
        <label className="settings-config-label" htmlFor="terminal-profile-args">
          {t("settings.terminal_profiles.args")}
        </label>
        <textarea
          id="terminal-profile-args"
          className="input"
          rows={3}
          value={draft.args}
          onChange={(event) => setDraft((current) => ({ ...current, args: event.target.value }))}
        />
        <span className="settings-toggle-desc">{t("settings.terminal_profiles.args_hint")}</span>
      </div>
      <div className="settings-pills">
        <Button
          size="sm"
          variant="primary"
          disabled={!isDraftValid}
          onClick={() => {
            void handleSaveDraft();
          }}
        >
          {t("settings.terminal_profiles.save_custom")}
        </Button>
        {editingProfileId ? (
          <Button size="sm" variant="ghost" onClick={resetDraft}>
            {t("common.cancel")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

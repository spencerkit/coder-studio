import type { CustomTerminalProfile, TerminalProfile } from "@coder-studio/core";
import { Check } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Input, Pill, Switch } from "../../../components/ui";
import { useTranslation } from "../../../lib/i18n";
import { MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE } from "../../terminal-panel/preferences";
import {
  TerminalProfileSettings,
  type TerminalProfileSettingsChange,
} from "./terminal-profile-settings";
import { useSessionGateDispatch } from "./use-session-gate-dispatch";

const TERMINAL_FONT_SIZE_SAVE_THROTTLE_MS = 500;

interface TerminalSettingsSectionProps {
  terminalRenderer: "standard" | "compatibility";
  setTerminalRenderer: (value: "standard" | "compatibility") => void;
  terminalCopyOnSelect: boolean;
  setTerminalCopyOnSelect: (value: boolean) => void;
  terminalProfiles: TerminalProfile[];
  customTerminalProfiles: CustomTerminalProfile[];
  configuredTerminalDefaultProfileId?: string;
  resolvedTerminalDefaultProfileId: string | null;
  onTerminalProfileSettingsChange: (change: TerminalProfileSettingsChange) => Promise<boolean>;
  desktopTerminalFontSize: number;
  mobileTerminalFontSize: number;
  setDesktopTerminalFontSize: (value: number) => void;
  setMobileTerminalFontSize: (value: number) => void;
}

function parseTerminalFontSizeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TERMINAL_FONT_SIZE ||
    parsed > MAX_TERMINAL_FONT_SIZE
  ) {
    return null;
  }

  return parsed;
}

export function TerminalSettingsSection({
  terminalRenderer,
  setTerminalRenderer,
  terminalCopyOnSelect,
  setTerminalCopyOnSelect,
  terminalProfiles,
  customTerminalProfiles,
  configuredTerminalDefaultProfileId,
  resolvedTerminalDefaultProfileId,
  onTerminalProfileSettingsChange,
  desktopTerminalFontSize,
  mobileTerminalFontSize,
  setDesktopTerminalFontSize,
  setMobileTerminalFontSize,
}: TerminalSettingsSectionProps) {
  const t = useTranslation();
  const dispatch = useSessionGateDispatch();
  const terminalRendererTitleId = useId();
  const terminalRendererDescId = useId();
  const copyOnSelectLabelId = useId();
  const copyOnSelectDescId = useId();
  const desktopTerminalFontSizeLabelId = useId();
  const desktopTerminalFontSizeDescId = useId();
  const mobileTerminalFontSizeLabelId = useId();
  const mobileTerminalFontSizeDescId = useId();
  const [desktopTerminalFontSizeDraft, setDesktopTerminalFontSizeDraft] = useState(
    String(desktopTerminalFontSize)
  );
  const [desktopTerminalFontSizeError, setDesktopTerminalFontSizeError] = useState<string | null>(
    null
  );
  const [mobileTerminalFontSizeDraft, setMobileTerminalFontSizeDraft] = useState(
    String(mobileTerminalFontSize)
  );
  const [mobileTerminalFontSizeError, setMobileTerminalFontSizeError] = useState<string | null>(
    null
  );
  const lastTerminalFontSizeCommitAtRef = useRef<
    Record<"desktopTerminalFontSize" | "mobileTerminalFontSize", number>
  >({
    desktopTerminalFontSize: 0,
    mobileTerminalFontSize: 0,
  });

  useEffect(() => {
    setDesktopTerminalFontSizeDraft(String(desktopTerminalFontSize));
  }, [desktopTerminalFontSize]);

  useEffect(() => {
    setMobileTerminalFontSizeDraft(String(mobileTerminalFontSize));
  }, [mobileTerminalFontSize]);

  useEffect(() => {
    setDesktopTerminalFontSizeError(null);
  }, [desktopTerminalFontSize]);

  useEffect(() => {
    setMobileTerminalFontSizeError(null);
  }, [mobileTerminalFontSize]);

  const commitTerminalFontSize = async (
    draft: string,
    currentValue: number,
    settingKey: "desktopTerminalFontSize" | "mobileTerminalFontSize",
    setValue: (value: number) => void,
    setDraft: (value: string) => void,
    setError: (value: string | null) => void
  ) => {
    const parsed = parseTerminalFontSizeInput(draft);
    if (parsed === null) {
      setDraft(String(currentValue));
      setError(
        t("settings.terminal_font_size_validation_error", {
          min: MIN_TERMINAL_FONT_SIZE,
          max: MAX_TERMINAL_FONT_SIZE,
        })
      );
      return;
    }

    if (parsed === currentValue) {
      setDraft(String(parsed));
      setError(null);
      return;
    }

    const now = Date.now();
    if (
      now - lastTerminalFontSizeCommitAtRef.current[settingKey] <
      TERMINAL_FONT_SIZE_SAVE_THROTTLE_MS
    ) {
      return;
    }
    lastTerminalFontSizeCommitAtRef.current[settingKey] = now;

    const result = await dispatch("settings.update", {
      settings: {
        appearance: {
          [settingKey]: parsed,
        },
      },
    });

    if (result === null) {
      return;
    }

    if (!result.ok) {
      setDraft(String(currentValue));
      setError(result.error?.message || t("settings.config_files.save_failed"));
      return;
    }

    setValue(parsed);
    setDraft(String(parsed));
    setError(null);
  };

  return (
    <div className="settings-section">
      <div className="settings-group">
        <h3 className="settings-group-title" id={terminalRendererTitleId}>
          {t("settings.terminal_renderer")}
        </h3>
        <p className="settings-group-desc" id={terminalRendererDescId}>
          {t("settings.terminal_renderer_hint")}
        </p>

        <div
          aria-describedby={terminalRendererDescId}
          aria-labelledby={terminalRendererTitleId}
          className="settings-pills"
          role="group"
        >
          <Pill
            leadingIcon={terminalRenderer === "standard" ? <Check size={12} /> : undefined}
            onClick={() => {
              setTerminalRenderer("standard");
              void dispatch("settings.update", {
                settings: {
                  appearance: {
                    terminalRenderer: "standard",
                  },
                },
              });
            }}
            active={terminalRenderer === "standard"}
          >
            {t("settings.terminal_standard")}
          </Pill>
          <Pill
            leadingIcon={terminalRenderer === "compatibility" ? <Check size={12} /> : undefined}
            onClick={() => {
              setTerminalRenderer("compatibility");
              void dispatch("settings.update", {
                settings: {
                  appearance: {
                    terminalRenderer: "compatibility",
                  },
                },
              });
            }}
            active={terminalRenderer === "compatibility"}
          >
            {t("settings.terminal_compatibility")}
          </Pill>
        </div>

        <div className="settings-toggle-row">
          <div className="settings-toggle-info">
            <span className="settings-toggle-label" id={copyOnSelectLabelId}>
              {t("settings.copy_on_select")}
            </span>
            <span className="settings-toggle-desc" id={copyOnSelectDescId}>
              {t("settings.copy_on_select_hint")}
            </span>
          </div>
          <Switch
            aria-describedby={copyOnSelectDescId}
            aria-labelledby={copyOnSelectLabelId}
            checked={terminalCopyOnSelect}
            className="settings-toggle"
            onCheckedChange={(nextValue) => {
              setTerminalCopyOnSelect(nextValue);
              void dispatch("settings.update", {
                settings: {
                  appearance: {
                    terminalCopyOnSelect: nextValue,
                  },
                },
              });
            }}
          />
        </div>
      </div>

      <TerminalProfileSettings
        configuredDefaultProfileId={configuredTerminalDefaultProfileId}
        customProfiles={customTerminalProfiles}
        profiles={terminalProfiles}
        resolvedDefaultProfileId={resolvedTerminalDefaultProfileId}
        onChange={onTerminalProfileSettingsChange}
      />

      <div className="settings-group">
        <h3 className="settings-group-title">{t("settings.terminal_appearance")}</h3>
        <p className="settings-group-desc">{t("settings.terminal_font_size_hint")}</p>

        <div className="settings-config-field settings-config-field--inline">
          <label
            className="settings-config-label"
            htmlFor="desktop-terminal-font-size"
            id={desktopTerminalFontSizeLabelId}
          >
            {t("settings.desktop_terminal_font_size")}
          </label>
          <div className="settings-config-control">
            <Input
              id="desktop-terminal-font-size"
              aria-describedby={desktopTerminalFontSizeDescId}
              aria-labelledby={desktopTerminalFontSizeLabelId}
              className="settings-input-compact"
              type="number"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              inputMode="numeric"
              invalid={Boolean(desktopTerminalFontSizeError)}
              value={desktopTerminalFontSizeDraft}
              onChange={(event) => {
                setDesktopTerminalFontSizeDraft(event.target.value);
                if (desktopTerminalFontSizeError) {
                  setDesktopTerminalFontSizeError(null);
                }
              }}
              onBlur={() => {
                void commitTerminalFontSize(
                  desktopTerminalFontSizeDraft,
                  desktopTerminalFontSize,
                  "desktopTerminalFontSize",
                  setDesktopTerminalFontSize,
                  setDesktopTerminalFontSizeDraft,
                  setDesktopTerminalFontSizeError
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTerminalFontSize(
                    desktopTerminalFontSizeDraft,
                    desktopTerminalFontSize,
                    "desktopTerminalFontSize",
                    setDesktopTerminalFontSize,
                    setDesktopTerminalFontSizeDraft,
                    setDesktopTerminalFontSizeError
                  );
                }
              }}
            />
          </div>
          <span className="settings-toggle-desc" id={desktopTerminalFontSizeDescId}>
            {t("settings.desktop_terminal_font_size_hint")}
          </span>
          {desktopTerminalFontSizeError ? (
            <span className="form-error" role="alert">
              {desktopTerminalFontSizeError}
            </span>
          ) : null}
        </div>

        <div className="settings-config-field settings-config-field--inline">
          <label
            className="settings-config-label"
            htmlFor="mobile-terminal-font-size"
            id={mobileTerminalFontSizeLabelId}
          >
            {t("settings.mobile_terminal_font_size")}
          </label>
          <div className="settings-config-control">
            <Input
              id="mobile-terminal-font-size"
              aria-describedby={mobileTerminalFontSizeDescId}
              aria-labelledby={mobileTerminalFontSizeLabelId}
              className="settings-input-compact"
              type="number"
              min={MIN_TERMINAL_FONT_SIZE}
              max={MAX_TERMINAL_FONT_SIZE}
              step={1}
              inputMode="numeric"
              invalid={Boolean(mobileTerminalFontSizeError)}
              value={mobileTerminalFontSizeDraft}
              onChange={(event) => {
                setMobileTerminalFontSizeDraft(event.target.value);
                if (mobileTerminalFontSizeError) {
                  setMobileTerminalFontSizeError(null);
                }
              }}
              onBlur={() => {
                void commitTerminalFontSize(
                  mobileTerminalFontSizeDraft,
                  mobileTerminalFontSize,
                  "mobileTerminalFontSize",
                  setMobileTerminalFontSize,
                  setMobileTerminalFontSizeDraft,
                  setMobileTerminalFontSizeError
                );
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void commitTerminalFontSize(
                    mobileTerminalFontSizeDraft,
                    mobileTerminalFontSize,
                    "mobileTerminalFontSize",
                    setMobileTerminalFontSize,
                    setMobileTerminalFontSizeDraft,
                    setMobileTerminalFontSizeError
                  );
                }
              }}
            />
          </div>
          <span className="settings-toggle-desc" id={mobileTerminalFontSizeDescId}>
            {t("settings.mobile_terminal_font_size_hint")}
          </span>
          {mobileTerminalFontSizeError ? (
            <span className="form-error" role="alert">
              {mobileTerminalFontSizeError}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

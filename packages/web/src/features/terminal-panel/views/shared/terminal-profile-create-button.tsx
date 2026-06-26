import type { TerminalProfile } from "@coder-studio/core";
import { ChevronDown } from "lucide-react";
import { useMemo, useState } from "react";
import { Button, IconButton, Popover, ThemedIcon, Tooltip } from "../../../../components/ui";
import { useTranslation } from "../../../../lib/i18n";
import { MobileSelectSheet } from "../../../mobile-select";

interface TerminalProfileCreateButtonProps {
  profiles: TerminalProfile[];
  defaultProfile: TerminalProfile | null;
  loading: boolean;
  mobile?: boolean;
  variant?: "toolbar" | "empty-state";
  onCreateTerminal: (profileId?: string) => Promise<void> | void;
}

function getOrderedProfiles(
  profiles: TerminalProfile[],
  defaultProfileId: string | null | undefined
): TerminalProfile[] {
  if (!defaultProfileId) {
    return profiles;
  }

  const defaultProfile = profiles.find((profile) => profile.id === defaultProfileId);
  if (!defaultProfile) {
    return profiles;
  }

  return [defaultProfile, ...profiles.filter((profile) => profile.id !== defaultProfileId)];
}

export function TerminalProfileCreateButton({
  profiles,
  defaultProfile,
  loading,
  mobile = false,
  variant = "toolbar",
  onCreateTerminal,
}: TerminalProfileCreateButtonProps) {
  const t = useTranslation();
  const [desktopChooserOpen, setDesktopChooserOpen] = useState(false);
  const [mobileChooserOpen, setMobileChooserOpen] = useState(false);
  const chooserLabel = t("terminal.profile_chooser_label");
  const configureProfilesLabel = t("terminal.profile_configure");
  const orderedProfiles = useMemo(
    () => getOrderedProfiles(profiles, defaultProfile?.id),
    [defaultProfile?.id, profiles]
  );
  const mobileProfiles = useMemo(() => {
    if (!defaultProfile) {
      return orderedProfiles.map((profile) => ({
        id: profile.id,
        label: profile.label,
      }));
    }

    return [
      {
        id: defaultProfile.id,
        label: t("terminal.open_default_profile", { label: defaultProfile.label }),
      },
      ...profiles
        .filter((profile) => profile.id !== defaultProfile.id)
        .map((profile) => ({
          id: profile.id,
          label: profile.label,
        })),
    ];
  }, [defaultProfile, orderedProfiles, profiles, t]);

  const profileSections = useMemo(() => {
    const customProfiles = orderedProfiles.filter((profile) => profile.source === "custom");
    const detectedProfiles = orderedProfiles.filter((profile) => profile.source === "detected");
    const orderedSources =
      defaultProfile?.source === "custom"
        ? [
            ["custom", customProfiles],
            ["detected", detectedProfiles],
          ]
        : [
            ["detected", detectedProfiles],
            ["custom", customProfiles],
          ];

    return orderedSources
      .filter(([, items]) => items.length > 0)
      .map(([source, items]) => ({
        source,
        items,
      }));
  }, [defaultProfile?.source, orderedProfiles]);

  const runCreate = async (profileId?: string) => {
    await onCreateTerminal(profileId);
    setDesktopChooserOpen(false);
    setMobileChooserOpen(false);
  };

  if (mobile) {
    return (
      <>
        {variant === "toolbar" ? (
          <Tooltip content={t("action.open")}>
            <IconButton
              className="panel-toolbar-btn"
              aria-label={t("terminal.new_terminal")}
              icon={<ThemedIcon semantic="terminal.action.new" size={14} />}
              onClick={() => setMobileChooserOpen(true)}
              size="sm"
            />
          </Tooltip>
        ) : (
          <Button
            variant="primary"
            size="sm"
            onClick={() => setMobileChooserOpen(true)}
            leadingIcon={<ThemedIcon semantic="terminal.action.new" size={14} />}
          >
            {t("terminal.new_terminal")}
          </Button>
        )}
        {mobileChooserOpen ? (
          <MobileSelectSheet
            title={t("terminal.new_terminal")}
            loading={loading}
            sections={[
              {
                kind: "options",
                id: "terminal-profiles",
                items: mobileProfiles,
              },
            ]}
            onClose={() => setMobileChooserOpen(false)}
            onSelect={(profileId) => runCreate(profileId)}
          />
        ) : null}
      </>
    );
  }

  const primaryButton =
    variant === "empty-state" ? (
      <Button
        variant="primary"
        size="sm"
        onClick={() => void runCreate(defaultProfile?.id)}
        leadingIcon={<ThemedIcon semantic="terminal.action.new" size={14} />}
      >
        {t("terminal.new_terminal")}
      </Button>
    ) : (
      <Tooltip content={t("action.open")}>
        <IconButton
          className="panel-toolbar-btn"
          aria-label={t("terminal.new_terminal")}
          icon={<ThemedIcon semantic="terminal.action.new" size={14} />}
          onClick={() => void runCreate(defaultProfile?.id)}
          size="sm"
        />
      </Tooltip>
    );

  return (
    <div
      className={`terminal-profile-create-button terminal-profile-create-button--${variant}`}
      style={{ display: "flex", alignItems: "center", gap: "2px" }}
    >
      {primaryButton}
      <Popover
        content={
          <div className="terminal-profile-create-button__menu">
            {profileSections.map((section) => (
              <div
                key={section.source}
                className="terminal-profile-create-button__group"
                style={{ display: "grid", gap: "0.375rem", paddingBottom: "0.75rem" }}
              >
                <p
                  className="terminal-profile-create-button__group-label"
                  style={{
                    margin: 0,
                    color: "var(--text-tertiary)",
                    fontSize: "0.75rem",
                    textTransform: "uppercase",
                  }}
                >
                  {t(
                    section.source === "custom"
                      ? "terminal.profile_source_custom"
                      : "terminal.profile_source_detected"
                  )}
                </p>
                {section.items.map((profile) => (
                  <button
                    key={profile.id}
                    type="button"
                    className="terminal-profile-create-button__item"
                    onClick={() => void runCreate(profile.id)}
                    style={{
                      border: "none",
                      background: "transparent",
                      color: "inherit",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      padding: 0,
                      textAlign: "left",
                    }}
                  >
                    <span>{profile.label}</span>
                    {profile.id === defaultProfile?.id ? (
                      <span style={{ color: "var(--text-tertiary)", fontSize: "0.75rem" }}>
                        {t("terminal.default_badge")}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            ))}
            <div
              className="terminal-profile-create-button__footer"
              style={{
                borderTop: "1px solid var(--border-subtle)",
                display: "flex",
                justifyContent: "flex-end",
                paddingTop: "0.75rem",
              }}
            >
              <Button
                as="a"
                href="/more/settings/terminal#terminal-profiles"
                variant="ghost"
                size="sm"
              >
                {configureProfilesLabel}
              </Button>
            </div>
          </div>
        }
        contentClassName="terminal-profile-create-button__popover"
        forceMode="desktop"
        open={desktopChooserOpen}
        placement="bottom-end"
        title={t("terminal.new_terminal")}
        onOpenChange={setDesktopChooserOpen}
      >
        <IconButton
          aria-label={chooserLabel}
          className="panel-toolbar-btn terminal-profile-create-button__toggle"
          icon={<ChevronDown size={14} />}
          size="sm"
        />
      </Popover>
    </div>
  );
}

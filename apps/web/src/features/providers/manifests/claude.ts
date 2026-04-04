import type { ProviderManifest } from "../types";

export const claudeProviderManifest: ProviderManifest = {
  id: "claude",
  label: "Claude Code",
  badgeLabel: "Claude",
  description: "Claude Code runtime with structured startup flags, auth, and settings.json-backed behavior.",
  settingsTitleKey: "claudeSettingsTitle",
  settingsHintKey: "claudeSettingsHint",
  settingsSections: [
    {
      id: "startup",
      titleKey: "claudeStartupSection",
      descriptionKey: "claudeStartupSectionHint",
      fields: [
        {
          id: "startup-args",
          kind: "string_list",
          path: ["startupArgs"],
          labelKey: "claudeExtraStartupArgs",
          hintKey: "claudeExtraStartupArgsHint",
          placeholderKey: "claudeExtraStartupArgsPlaceholder",
        },
      ],
    },
    {
      id: "launch-auth",
      titleKey: "claudeLaunchSection",
      descriptionKey: "claudeLaunchSectionHint",
      fields: [
        {
          id: "auth-token",
          kind: "text",
          path: ["env", "ANTHROPIC_AUTH_TOKEN"],
          labelKey: "claudeAuthToken",
          hintKey: "claudeAuthTokenHelp",
          placeholderKey: "claudeAuthTokenPlaceholder",
        },
        {
          id: "base-url",
          kind: "text",
          path: ["env", "ANTHROPIC_BASE_URL"],
          labelKey: "claudeBaseUrl",
          hintKey: "claudeBaseUrlHelp",
          placeholderKey: "claudeBaseUrlPlaceholder",
        },
      ],
    },
    {
      id: "behavior",
      titleKey: "claudeBehaviorSection",
      descriptionKey: "claudeBehaviorSectionHint",
      fields: [
        {
          id: "model",
          kind: "text",
          path: ["settingsJson", "model"],
          labelKey: "claudeModel",
          placeholderKey: "claudeModelPlaceholder",
        },
      ],
    },
  ],
};

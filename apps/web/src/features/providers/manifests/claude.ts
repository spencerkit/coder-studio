import type { ProviderManifest } from "../types.ts";

export const claudeProviderManifest: ProviderManifest = {
  id: "claude",
  label: "Claude Code",
  badgeLabel: "Claude",
  description: "Claude Code runtime with structured startup flags, auth, and settings.json-backed behavior.",
  settingsTitleKey: "claudeSettingsTitle",
  capabilities: {
    supportsResume: true,
    supportsHooks: "required",
    emitsApprovalEvents: true,
  },
  startupBehavior: {
    startupQuietMs: 400,
    startupDiscoveryMs: 1200,
    firstSubmitStrategy: "immediate_newline",
  },
  runtimeValidation: {
    commandFieldPath: ["executable"],
    commandLabelKey: "runtimeCheckClaudeLabel",
    commandHintKey: "runtimeCheckClaudeHint",
    deferredHintKey: "runtimeCheckClaudeDeferredHint",
    requiredCommands: [
      {
        id: "git",
        command: "git",
        labelKey: "runtimeCheckGitLabel",
        hintKey: "runtimeCheckGitHint",
      },
    ],
  },
  settingsDefaults: {
    executable: "claude",
    startupArgs: [],
    env: {},
    settingsJson: {},
    globalConfigJson: {},
  },
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
          id: "api-key",
          kind: "text",
          path: ["env", "ANTHROPIC_API_KEY"],
          labelKey: "claudeApiKey",
          hintKey: "claudeApiKeyHelp",
          placeholderKey: "claudeApiKeyPlaceholder",
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

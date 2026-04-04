import type { ProviderManifest } from "../types";

export const codexProviderManifest: ProviderManifest = {
  id: "codex",
  label: "Codex",
  badgeLabel: "Codex",
  description: "Codex CLI runtime with startup args plus real config-backed model and auth settings.",
  settingsTitleKey: "codexSettingsTitle",
  settingsSections: [
    {
      id: "startup",
      titleKey: "codexCommandPreview",
      descriptionKey: "codexCommandPreviewHint",
      fields: [
        {
          id: "executable",
          kind: "command",
          path: ["executable"],
          labelKey: "codexExecutable",
          hintKey: "codexExecutableHint",
          placeholder: "codex",
        },
        {
          id: "extra-args",
          kind: "string_list",
          path: ["extraArgs"],
          labelKey: "codexExtraArgs",
          hintKey: "codexExtraArgsHint",
          placeholderKey: "codexExtraArgsPlaceholder",
        },
      ],
    },
    {
      id: "config",
      titleKey: "codexConfigSection",
      descriptionKey: "codexConfigSectionHint",
      fields: [
        {
          id: "model",
          kind: "text",
          path: ["model"],
          labelKey: "codexModel",
          hintKey: "codexModelHint",
          placeholderKey: "codexModelPlaceholder",
        },
        {
          id: "api-key",
          kind: "text",
          path: ["apiKey"],
          labelKey: "codexApiKey",
          hintKey: "codexApiKeyHint",
          placeholderKey: "codexApiKeyPlaceholder",
        },
        {
          id: "base-url",
          kind: "text",
          path: ["baseUrl"],
          labelKey: "codexBaseUrl",
          hintKey: "codexBaseUrlHint",
          placeholderKey: "codexBaseUrlPlaceholder",
        },
      ],
    },
  ],
};

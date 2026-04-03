export type ProviderId = string;

export type ProviderSettingsFieldOption = {
  value: string;
  labelKey: string;
};

export type ProviderSettingsField = {
  id: string;
  kind: "command" | "string_list" | "env_map" | "json" | "text" | "select";
  path: readonly string[];
  labelKey: string;
  hintKey?: string;
  placeholder?: string;
  placeholderKey?: string;
  options?: readonly ProviderSettingsFieldOption[];
};

export type ProviderSettingsSection = {
  id: string;
  titleKey: string;
  descriptionKey?: string;
  fields: readonly ProviderSettingsField[];
};

export type ProviderRequiredCommand = {
  id: string;
  command: string;
  labelKey: string;
  hintKey: string;
};

export type ProviderRuntimeValidation = {
  commandFieldPath: readonly string[];
  commandLabelKey: string;
  commandHintKey: string;
  deferredHintKey?: string;
  requiredCommands: readonly ProviderRequiredCommand[];
};

export type ProviderCapabilities = {
  supportsResume: boolean;
  supportsHooks: "required" | "optional" | "none";
  emitsApprovalEvents: boolean;
};

export type ProviderStartupBehavior = {
  startupQuietMs: number;
  startupDiscoveryMs: number;
  firstSubmitStrategy: "immediate_newline" | "flush_then_newline";
};

export type ProviderManifest = {
  id: ProviderId;
  label: string;
  badgeLabel: string;
  description: string;
  settingsTitleKey: string;
  capabilities: ProviderCapabilities;
  startupBehavior: ProviderStartupBehavior;
  runtimeValidation: ProviderRuntimeValidation;
  settingsDefaults: Record<string, unknown>;
  settingsSections: readonly ProviderSettingsSection[];
};

import type { ProviderManifest } from "../types";

const CODEX_APPROVAL_POLICY_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "untrusted", labelKey: "codexApprovalPolicyUntrustedOption" },
  { value: "on-request", labelKey: "codexApprovalPolicyOnRequestOption" },
  { value: "never", labelKey: "codexApprovalPolicyNeverOption" },
] as const;

const CODEX_SANDBOX_MODE_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "read-only", labelKey: "codexSandboxReadOnlyOption" },
  { value: "workspace-write", labelKey: "codexSandboxWorkspaceWriteOption" },
  { value: "danger-full-access", labelKey: "codexSandboxDangerFullAccessOption" },
] as const;

const CODEX_WEB_SEARCH_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "disabled", labelKey: "codexWebSearchDisabledOption" },
  { value: "cached", labelKey: "codexWebSearchCachedOption" },
  { value: "live", labelKey: "codexWebSearchLiveOption" },
] as const;

const CODEX_REASONING_EFFORT_OPTIONS = [
  { value: "", labelKey: "codexSelectUnsetOption" },
  { value: "minimal", labelKey: "codexReasoningMinimalOption" },
  { value: "low", labelKey: "codexReasoningLowOption" },
  { value: "medium", labelKey: "codexReasoningMediumOption" },
  { value: "high", labelKey: "codexReasoningHighOption" },
  { value: "xhigh", labelKey: "codexReasoningXhighOption" },
] as const;

export const codexProviderManifest: ProviderManifest = {
  id: "codex",
  label: "Codex",
  badgeLabel: "Codex",
  description: "Codex CLI runtime with launch-time config overrides and environment settings.",
  settingsTitleKey: "codexSettingsTitle",
  capabilities: {
    supportsResume: true,
    supportsHooks: "required",
    emitsApprovalEvents: false,
  },
  startupBehavior: {
    startupQuietMs: 1200,
    startupDiscoveryMs: 3000,
    firstSubmitStrategy: "flush_then_newline",
  },
  runtimeValidation: {
    commandFieldPath: ["executable"],
    commandLabelKey: "runtimeCheckCodexLabel",
    commandHintKey: "runtimeCheckCodexHint",
    deferredHintKey: "runtimeCheckCodexDeferredHint",
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
    executable: "codex",
    extraArgs: [],
    model: "",
    approvalPolicy: "",
    sandboxMode: "",
    webSearch: "",
    modelReasoningEffort: "",
    env: {},
  },
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
          id: "approval-policy",
          kind: "select",
          path: ["approvalPolicy"],
          labelKey: "codexApprovalPolicy",
          hintKey: "codexApprovalPolicyHint",
          options: CODEX_APPROVAL_POLICY_OPTIONS,
        },
        {
          id: "sandbox-mode",
          kind: "select",
          path: ["sandboxMode"],
          labelKey: "codexSandboxMode",
          hintKey: "codexSandboxModeHint",
          options: CODEX_SANDBOX_MODE_OPTIONS,
        },
        {
          id: "web-search",
          kind: "select",
          path: ["webSearch"],
          labelKey: "codexWebSearch",
          hintKey: "codexWebSearchHint",
          options: CODEX_WEB_SEARCH_OPTIONS,
        },
        {
          id: "reasoning-effort",
          kind: "select",
          path: ["modelReasoningEffort"],
          labelKey: "codexReasoningEffort",
          hintKey: "codexReasoningEffortHint",
          options: CODEX_REASONING_EFFORT_OPTIONS,
        },
        {
          id: "env",
          kind: "env_map",
          path: ["env"],
          labelKey: "codexExtraEnv",
          hintKey: "codexExtraEnvHint",
        },
      ],
    },
  ],
};

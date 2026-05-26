import type { ProviderCapabilityDescriptor } from "@coder-studio/core";

export interface ProviderPresetMetadata {
  id: string;
  displayName: string;
  kind: "preset";
  description: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwdMode: "workspace_root";
  sessionMode: "interactive";
  startupPrompt?: string;
  capabilities: ProviderCapabilityDescriptor[];
  requiredCommands: string[];
}

function cloneCapabilities(
  capabilities: ProviderCapabilityDescriptor[]
): ProviderCapabilityDescriptor[] {
  return capabilities.map((capability) => ({ ...capability }));
}

const defaultCapabilities: ProviderCapabilityDescriptor[] = [
  { key: "interactive_session", supported: true, label: "Interactive session" },
  { key: "context_attach", supported: true, label: "Context attach" },
  { key: "review", supported: true, label: "Review" },
];

export const providerPresets: ProviderPresetMetadata[] = [
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    kind: "preset",
    description:
      "Preset metadata for launching Google's Gemini CLI through the custom provider flow.",
    command: "gemini",
    args: [],
    env: {},
    cwdMode: "workspace_root",
    sessionMode: "interactive",
    startupPrompt: "Follow the workspace instructions and explain important tradeoffs.",
    capabilities: cloneCapabilities(defaultCapabilities),
    requiredCommands: ["gemini"],
  },
  {
    id: "aider",
    displayName: "Aider",
    kind: "preset",
    description:
      "Preset metadata for launching Aider as a workspace-root interactive coding agent.",
    command: "aider",
    args: [],
    env: {},
    cwdMode: "workspace_root",
    sessionMode: "interactive",
    startupPrompt: "Review the current workspace state before making edits.",
    capabilities: cloneCapabilities(defaultCapabilities),
    requiredCommands: ["aider"],
  },
  {
    id: "opencode",
    displayName: "OpenCode",
    kind: "preset",
    description: "Preset metadata for launching OpenCode from the workspace root.",
    command: "opencode",
    args: [],
    env: {},
    cwdMode: "workspace_root",
    sessionMode: "interactive",
    startupPrompt: "Use the repository instructions and verify changes before finishing.",
    capabilities: cloneCapabilities(defaultCapabilities),
    requiredCommands: ["opencode"],
  },
];

export function getProviderPresets(): ProviderPresetMetadata[] {
  return providerPresets.map((preset) => ({
    ...preset,
    args: [...preset.args],
    env: { ...preset.env },
    capabilities: cloneCapabilities(preset.capabilities),
    requiredCommands: [...preset.requiredCommands],
  }));
}

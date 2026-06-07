import type { ZodSchema } from "zod";
import type { ProviderConfig, ProviderInstallDocUrls } from "../domain/types";
import type { IdleHeuristics } from "./idle-heuristics";

export interface ProviderInstallStrategy {
  id: string;
  kind: "prerequisite" | "provider";
  targetCommand: string;
  requiresCommands: string[];
  command: string;
  args: string[];
}

export interface ProviderInstallMetadata {
  prerequisites: string[];
  manualGuideKeys: string[];
  docUrls: ProviderInstallDocUrls;
  strategies: Partial<Record<NodeJS.Platform, ProviderInstallStrategy[]>>;
}

export type ProviderHeadlessScenario =
  | "supervisor_eval"
  | "agent_instructions_generate"
  | "session_analysis";

export interface ProviderHeadlessCommandRequest {
  prompt: string;
  sessionId: string;
  workspacePath: string;
  apiKey?: string;
  model?: string;
  outputFile?: string;
}

export type SupervisorEvalCommandRequest = ProviderHeadlessCommandRequest;

export type ProviderKind = "built_in" | "preset" | "custom";

export type ProviderStability = "stable" | "experimental";

export type ProviderCapabilityKey =
  | "interactive_session"
  | "supervisor_eval"
  | "idle_detection"
  | "context_attach"
  | "review";

export interface ProviderCapabilityDescriptor {
  key: ProviderCapabilityKey;
  supported: boolean;
  label: string;
}

export interface ProviderHeadlessCommand {
  argv: string[];
  outputFile?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ProviderHeadlessDefinition {
  supportedScenarios: ProviderHeadlessScenario[];
  buildCommand: (
    config: ProviderConfig,
    scenario: ProviderHeadlessScenario,
    req: ProviderHeadlessCommandRequest
  ) => ProviderHeadlessCommand | null;
}

export interface ProviderListItem {
  id: string;
  displayName: string;
  badge: string;
  kind: ProviderKind;
  stability?: ProviderStability;
  supportsAgentInstructions?: boolean;
  supportsAgentInstructionsGeneration?: boolean;
  supportsSkillsMount?: boolean;
  capability: "full" | "limited" | "unsupported";
  capabilities: ProviderCapabilityDescriptor[];
  requiredCommands: string[];
}

export interface ProviderDefinition {
  // Metadata
  id: string;
  displayName: string;
  badge: string;
  kind: ProviderKind;
  stability?: ProviderStability;
  supportsAgentInstructions?: boolean;
  supportsAgentInstructionsGeneration?: boolean;
  supportsSkillsMount?: boolean;
  /**
   * Declarative label for UI badges and docs only.
   * Runtime behavior must read hooks/events directly.
   */
  capability: "full" | "limited" | "unsupported";
  capabilities: ProviderCapabilityDescriptor[];
  install: ProviderInstallMetadata;
  /**
   * Directories the provider actually loads skills from. The first entry is the
   * canonical write/display target; later entries are discovery aliases.
   */
  skillMountDirectories?: string[];

  // Command construction
  buildCommand(
    config: ProviderConfig,
    ctx: LaunchContext
  ): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };

  // Configuration
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;

  // Runtime requirements
  requiredCommands: string[];

  // Optional agent instructions publishing target for providers that read
  // workspace-local instruction files from a fixed path.
  agentInstructions?: {
    publishTarget?: {
      path: string;
    };
  };

  headless?: ProviderHeadlessDefinition;

  /** PTY-output-based idle detection used by the session manager. */
  idleHeuristics?: IdleHeuristics;
}

export interface LaunchContext {
  sessionId: string;
  workspacePath: string;
}

export function providerSupportsHeadlessScenario(
  provider: Pick<ProviderDefinition, "headless">,
  scenario: ProviderHeadlessScenario
): boolean {
  return provider.headless?.supportedScenarios.includes(scenario) ?? false;
}

export function providerSupportsAgentInstructionsGeneration(
  provider: Pick<ProviderDefinition, "headless">
): boolean {
  return providerSupportsHeadlessScenario(provider, "agent_instructions_generate");
}

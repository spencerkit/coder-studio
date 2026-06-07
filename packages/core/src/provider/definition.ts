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

export interface SupervisorEvalCommandRequest {
  prompt: string;
  sessionId: string;
  workspacePath: string;
  apiKey?: string;
  model?: string;
  outputFile?: string;
}

export type ProviderKind = "built_in" | "preset" | "custom";

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

export interface ProviderListItem {
  id: string;
  displayName: string;
  badge: string;
  kind: ProviderKind;
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
  /**
   * Declarative label for UI badges and docs only.
   * Runtime behavior must read hooks/events directly.
   */
  capability: "full" | "limited" | "unsupported";
  capabilities: ProviderCapabilityDescriptor[];
  install: ProviderInstallMetadata;

  // Command construction
  buildCommand(
    config: ProviderConfig,
    ctx: LaunchContext
  ): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };

  buildSupervisorEvalCommand?(
    config: ProviderConfig,
    req: SupervisorEvalCommandRequest
  ): {
    argv: string[];
    outputFile?: string;
    cwd?: string;
    env?: Record<string, string>;
  } | null;

  // Configuration
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;

  // Runtime requirements
  requiredCommands: string[];

  /** PTY-output-based idle detection used by the session manager. */
  idleHeuristics?: IdleHeuristics;
}

export interface LaunchContext {
  sessionId: string;
  workspacePath: string;
}

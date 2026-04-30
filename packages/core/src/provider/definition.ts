import type { ZodSchema } from 'zod';
import type {
  ProviderConfig,
  ProviderInstallDocUrls,
  Session,
} from '../domain/types';

export interface ProviderInstallStrategy {
  id: string;
  kind: 'prerequisite' | 'provider';
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

export interface TranscriptExcerptRequest {
  transcriptPath: string;
  maxChars: number;
  maxTurns: number;
}

export interface ProviderDefinition {
  // Metadata
  id: string;
  displayName: string;
  badge: string;
  /**
   * Declarative label for UI badges and docs only.
   * Runtime behavior must read hooks/events directly.
   */
  capability: 'full' | 'limited' | 'unsupported';
  install: ProviderInstallMetadata;

  // Command construction
  buildCommand(config: ProviderConfig, ctx: LaunchContext): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  };

  buildResumeCommand?(
    resumeId: string,
    config: ProviderConfig,
    ctx: LaunchContext
  ): {
    argv: string[];
    env: Record<string, string>;
    cwd: string;
  } | null;

  buildSupervisorEvalCommand?(
    config: ProviderConfig,
    req: SupervisorEvalCommandRequest
  ): {
    argv: string[];
    outputFile?: string;
    cwd?: string;
    env?: Record<string, string>;
  } | null;

  readTranscriptExcerpt?(
    req: TranscriptExcerptRequest
  ): Promise<
    | {
        excerpt: string;
        lastTurnId?: string;
      }
    | null
  >;

  // Configuration
  configSchema: ZodSchema<ProviderConfig>;
  defaultConfig: ProviderConfig;

  // Runtime requirements
  requiredCommands: string[];

  // Hooks integration
  hooks: HooksDescriptor;

  // Optional transcript path resolver.
  // Returns absolute path or null if not yet discoverable.
  // Must not throw.
  resolveTranscriptPath?(session: Session): Promise<string | null>;
}

export interface LaunchContext {
  sessionId: string;
  workspacePath: string;
  bridgeScriptPath?: string;
}

export interface HooksDescriptor {
  resolveGlobalConfigPath(): string;
  mergeInto(existing: unknown, managed: ManagedHooks): unknown;
  extractManaged(config: unknown): ManagedHooks | null;
  markerVersion: string;
  bridgeCommand(bridgeScriptPath: string, event: string): string[];
  parseEvent(event: string, payload: unknown): ProviderEvent | null;
  events: {
    sessionStart: boolean;
    completion: boolean;
    progress: boolean;
  };
  stdoutHeuristics?: {
    sessionIdPatterns: RegExp[];
    idlePromptPatterns: RegExp[];
    idleDebounceMs: number;
  };
}

export interface ManagedHooks {
  commands: Record<string, string>;
}

export interface ProviderEvent {
  type: 'session_start' | 'stop' | 'turn_completed' | 'progress' | 'error';
  sessionId: string;
  payload: Record<string, unknown>;
}

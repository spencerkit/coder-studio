import type { ZodSchema } from 'zod';
import type { ProviderConfig, Session } from '../domain/types';

export interface ProviderDefinition {
  // Metadata
  id: string;
  displayName: string;
  badge: string;
  capability: 'full' | 'limited' | 'unsupported';

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
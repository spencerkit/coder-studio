import type {
  HooksDescriptor,
  LaunchContext,
  ManagedHooks,
  ProviderDefinition,
  ProviderEvent,
  ProviderConfig,
  Session,
} from '@coder-studio/core';

import { codexConfigSchema, type CodexConfig } from './config-schema.js';
import {
  idleDebounceMs,
  idlePromptPatterns,
  sessionIdPatterns,
} from './stdout-heuristics.js';
import { resolveCodexTranscriptPath } from './resolve-transcript.js';
import { buildCodexSupervisorEvalCommand } from './supervisor-eval.js';
import { readCodexTranscriptExcerpt } from './transcript-excerpt.js';

/**
 * Codex hooks descriptor for full-capability mode.
 * Parses `agent-turn-complete` events from the notify hook.
 */
const codexHooksDescriptor: HooksDescriptor = {
  markerVersion: 'cs-v1',

  resolveGlobalConfigPath(): string {
    return '';
  },

  mergeInto(existing: unknown, managed: ManagedHooks): unknown {
    const config =
      existing && typeof existing === 'object' && !Array.isArray(existing)
        ? (existing as Record<string, unknown>)
        : {};
    const existingHooks = (config.hooks as Record<string, unknown>) ?? {};
    const newConfig = { ...config, hooks: { ...existingHooks } };

    // For Codex, the notify command is set via `-c notify=...` in argv,
    // not via the hooks config object. We still track managed state here.
    if (managed.commands['agent-turn-complete']) {
      newConfig.hooks['agent-turn-complete'] = {
        _cs_managed: true,
        _cs_version: 'cs-v1',
        command: managed.commands['agent-turn-complete'],
      };
    }

    return newConfig;
  },

  extractManaged(config: unknown): ManagedHooks | null {
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
      return null;
    }
    const hooks = (config as Record<string, unknown>).hooks;
    if (!hooks || typeof hooks !== 'object') {
      return null;
    }
    const atc = (hooks as Record<string, unknown>)['agent-turn-complete'];
    if (!atc || typeof atc !== 'object') {
      return null;
    }
    const h = atc as Record<string, unknown>;
    if (h._cs_managed && typeof h.command === 'string') {
      return { commands: { 'agent-turn-complete': h.command } };
    }
    return null;
  },

  /**
   * Build bridge command.
   * For Codex the bridge is invoked via argv payload, not stdin.
   * The actual notify command is injected as `-c notify=["node","<bridge>"]`
   * in `buildCommand`. This method returns the argv form.
   */
  bridgeCommand(bridgeScriptPath: string, _event: string): string[] {
    // Codex notify passes the event payload as the last argv argument.
    return ['node', bridgeScriptPath];
  },

  /**
   * Parse Codex agent-turn-complete event into ProviderEvent.
   * Codex passes a JSON string as the last argv argument to the notify command.
   */
  parseEvent(event: string, payload: unknown): ProviderEvent | null {
    if (!payload || typeof payload !== 'object') {
      return null;
    }
    const data = payload as Record<string, unknown>;

    if (event === 'agent-turn-complete') {
      return {
        type: 'turn_completed',
        sessionId: (data['thread-id'] as string) ?? '',
        payload: {
          resumeId: data['thread-id'] as string,
          turnId: data['turn-id'] as string,
        },
      };
    }

    return null;
  },

  events: {
    sessionStart: false,
    completion: true,
    progress: false,
  },

  // Keep stdout heuristics as fallback
  stdoutHeuristics: {
    sessionIdPatterns,
    idlePromptPatterns,
    idleDebounceMs,
  },
};

/**
 * Codex provider definition — full capability with notify hook integration.
 */
export const codexDefinition: ProviderDefinition = {
  // ===== Metadata =====
  id: 'codex',
  displayName: 'Codex',
  badge: 'Codex',
  capability: 'full',

  // ===== Command construction =====
  buildCommand(config: ProviderConfig, ctx: LaunchContext) {
    const cfg = config as CodexConfig;
    const extraArgs = [...cfg.additionalArgs];

    // Inject -c notify=[...] when bridge script is available
    if (ctx.bridgeScriptPath) {
      extraArgs.push('-c', `notify=["node","${ctx.bridgeScriptPath}"]`);
    }

    return {
      argv: ['codex', ...extraArgs],
      env: {
        ...cfg.envVars,
        CODER_STUDIO_SESSION_ID: ctx.sessionId,
      },
      cwd: cfg.cwd ?? ctx.workspacePath,
    };
  },

  // Full mode: no resume support yet (Codex CLI may support it later)
  buildResumeCommand: undefined,
  buildSupervisorEvalCommand: buildCodexSupervisorEvalCommand,
  readTranscriptExcerpt: readCodexTranscriptExcerpt,

  // ===== Configuration =====
  configSchema: codexConfigSchema,
  defaultConfig: {
    additionalArgs: [],
    envVars: {},
  } satisfies CodexConfig,

  // ===== Runtime requirements =====
  requiredCommands: ['codex'],

  // ===== Hooks integration =====
  hooks: codexHooksDescriptor,

  // ===== Transcript resolution =====
  async resolveTranscriptPath(session: Session): Promise<string | null> {
    return resolveCodexTranscriptPath(session);
  },
};

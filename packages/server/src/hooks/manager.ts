import { join } from 'path';
import { homedir } from 'os';
import type { ProviderDefinition, ProviderEvent } from '@coder-studio/core';
import { HookRegistrationRepo, type NewHookRegistration } from '../storage/repositories/hook-registration-repo';
import { deployBridgeScript, getBridgeScriptPath } from './bridge';
import type { RuntimeConfig } from './runtime-json.js';
import { mergeWriteConfig } from './merge-writer';
import type { ProviderHookEvent } from '../session/manager.js';
import type { HookEventContext } from './endpoint.js';

export interface HookRouteDeps {
  sessionMgr: { onHookEvent(sessionId: string, event: ProviderHookEvent): void };
  providerRegistry: ProviderDefinition[];
  sessionDb: { findByResumeId(resumeId: string): { id: string } | null | undefined };
}

/**
 * Hooks Manager
 * Responsible for:
 * - Deploying bridge scripts for all providers
 * - Managing provider global configs (merge-write)
 * - Tracking hook injection status
 * - Handling hook events from bridge scripts
 */
export class HooksManager {
  private readonly backupDir = join(homedir(), '.coder-studio', 'backups');

  constructor(
    private readonly hookRegistrationRepo: HookRegistrationRepo,
    _runtime: RuntimeConfig,
    private readonly routeDeps?: HookRouteDeps
  ) {}

  /**
   * Deploys bridge scripts for all registered providers
   */
  async deployBridgeScripts(): Promise<void> {
    // Will be implemented with provider registry access
    throw new Error('deployBridgeScripts requires provider registry - implement in server initialization');
  }

  /**
   * Deploys bridge script and ensures global config for a single provider
   */
  async ensureGlobalConfig(provider: ProviderDefinition): Promise<void> {
    try {
      // 1. Deploy bridge script
      deployBridgeScript(provider.id);

      // 2. Build managed hooks configuration
      const managedHooks = this.buildManagedHooks(provider);

      // 3. Get provider's global config path
      const configPath = provider.hooks.resolveGlobalConfigPath();

      // 4. Merge-write global config
      const result = mergeWriteConfig(
        configPath,
        provider.hooks,
        managedHooks,
        this.backupDir
      );

      // 5. Update tracking in database
      if (result.success) {
        const now = Date.now();
        const existing = this.hookRegistrationRepo.get(provider.id);

        if (existing) {
          this.hookRegistrationRepo.updateInjection(
            provider.id,
            provider.hooks.markerVersion,
            now
          );
          this.hookRegistrationRepo.updateCheckStatus(provider.id, now, 'ok');
        } else {
          const registration: NewHookRegistration = {
            providerId: provider.id,
            markerVersion: provider.hooks.markerVersion,
            injectedAt: now,
            globalConfigPath: configPath,
            lastCheckAt: now,
            lastStatus: 'ok',
          };
          this.hookRegistrationRepo.create(registration);
        }
      } else {
        const now = Date.now();
        const existing = this.hookRegistrationRepo.get(provider.id);

        if (existing) {
          this.hookRegistrationRepo.updateCheckStatus(
            provider.id,
            now,
            'error',
            result.error
          );
        } else {
          const registration: NewHookRegistration = {
            providerId: provider.id,
            markerVersion: provider.hooks.markerVersion,
            injectedAt: now,
            globalConfigPath: configPath,
            lastCheckAt: now,
            lastStatus: 'error',
            lastError: result.error,
          };
          this.hookRegistrationRepo.create(registration);
        }

        console.error(`Failed to ensure global config for ${provider.id}:`, result.error);
      }
    } catch (error) {
      console.error(`Unexpected error ensuring global config for ${provider.id}:`, error);
    }
  }

  /**
   * Handles hook event received from bridge script.
   * Routes event to SessionManager via provider parsing.
   */
  handleHookEvent(event: string, payload: unknown, ctx: HookEventContext = {}): void {
    if (!this.routeDeps) {
      console.warn('Hook event received before router wiring:', event);
      return;
    }

    // 1. Find a provider that parses this event.
    let match: { provider: ProviderDefinition; providerEvent: ProviderEvent } | null = null;
    for (const provider of this.routeDeps.providerRegistry) {
      const parsed = provider.hooks.parseEvent(event, payload);
      if (parsed) {
        match = { provider, providerEvent: parsed };
        break;
      }
    }
    if (!match) return;

    // 2. Resolve coder-studio sessionId.
    const sessionId =
      ctx.coderStudioSessionId ??
      this.resolveSessionIdFromProviderEvent(match.providerEvent);
    if (!sessionId) return;

    // 3. Convert to internal ProviderHookEvent.
    const hookEvent = toHookEvent(match.providerEvent);
    if (!hookEvent) return;

    // 4. Route.
    this.routeDeps.sessionMgr.onHookEvent(sessionId, hookEvent);
  }

  private resolveSessionIdFromProviderEvent(ev: ProviderEvent): string | null {
    if (!this.routeDeps) return null;
    // Claude-style: sessionId carries the provider's own resume id; reverse lookup.
    const candidate = ev.sessionId || (ev.payload?.resumeId as string | undefined);
    if (!candidate) return null;
    const row = this.routeDeps.sessionDb.findByResumeId(candidate);
    return row?.id ?? null;
  }

  listRegistrations() {
    return this.hookRegistrationRepo.listAll();
  }

  /**
   * Builds managed hooks configuration for a provider
   */
  private buildManagedHooks(provider: ProviderDefinition): { commands: Record<string, string> } {
    const commands: Record<string, string> = {};
    const bridgePath = getBridgeScriptPath(provider.id);

    if (provider.hooks.events.sessionStart) {
      const bridgeCmd = provider.hooks.bridgeCommand(bridgePath, 'SessionStart');
      commands.SessionStart = bridgeCmd.join(' ');
    }

    if (provider.hooks.events.completion) {
      const bridgeCmd = provider.hooks.bridgeCommand(bridgePath, 'Stop');
      commands.Stop = bridgeCmd.join(' ');
    }

    // Progress hooks will be added in Phase 3

    return { commands };
  }
}

/**
 * Convert ProviderEvent to internal ProviderHookEvent
 */
function toHookEvent(ev: ProviderEvent): ProviderHookEvent | null {
  switch (ev.type) {
    case 'session_start':
      return {
        kind: 'SessionStart',
        resumeId: (ev.payload.resumeId as string) ?? ev.sessionId,
        transcriptPath: ev.payload.transcriptPath as string | undefined,
      };
    case 'turn_completed':
      return {
        kind: 'TurnCompleted',
        resumeId: (ev.payload.resumeId as string) ?? '',
        turnId: (ev.payload.turnId as string) ?? '',
      };
    case 'stop':
      return { kind: 'Stop' };
    case 'progress':
      return { kind: 'Progress', percent: (ev.payload.percent as number) ?? 0 };
    default:
      return null;
  }
}

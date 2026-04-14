import { join } from 'path';
import { homedir } from 'os';
import type { ProviderDefinition } from '@coder-studio/core';
import { HookRegistrationRepo, type NewHookRegistration } from '../storage/repositories/hook-registration-repo';
import { writeRuntimeConfig, type RuntimeConfig } from './runtime-json';
import { deployBridgeScript, getBridgeScriptPath } from './bridge';
import { mergeWriteConfig } from './merge-writer';

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
    private readonly runtime: RuntimeConfig
  ) {}

  /**
   * Deploys bridge scripts for all registered providers
   * Called during server startup
   */
  async deployBridgeScripts(): Promise<void> {
    // This will be implemented when we have provider registry access
    // For now, this is a placeholder that will be called from server initialization
    throw new Error('deployBridgeScripts requires provider registry - implement in server initialization');
  }

  /**
   * Deploys bridge script and ensures global config for a single provider
   * Called during server startup for each registered provider
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
          // Update existing registration
          this.hookRegistrationRepo.updateInjection(
            provider.id,
            provider.hooks.markerVersion,
            now
          );
          this.hookRegistrationRepo.updateCheckStatus(provider.id, now, 'ok');
        } else {
          // Create new registration
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
        // Track error
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

        // Log error (in production, this would go to proper logger)
        console.error(`Failed to ensure global config for ${provider.id}:`, result.error);
      }
    } catch (error) {
      // Unexpected error - log and continue
      console.error(`Unexpected error ensuring global config for ${provider.id}:`, error);
    }
  }

  /**
   * Handles hook event received from bridge script
   * Routes event to appropriate session manager
   */
  handleHookEvent(event: string, payload: unknown): void {
    // This will be implemented when we have SessionManager
    // For now, this is a placeholder that logs events
    console.log('Hook event received:', { event, payload });

    // Future implementation:
    // 1. Detect provider from event name or payload structure
    // 2. Parse event using provider.hooks.parseEvent()
    // 3. Extract sessionId from parsed event
    // 4. Route to SessionManager.onHookEvent(sessionId, event)
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

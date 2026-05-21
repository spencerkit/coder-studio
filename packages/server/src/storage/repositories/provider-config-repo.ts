import type { ProviderConfig } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface ProviderConfigFileRecord {
  version: 1;
  providers: Record<string, ProviderConfig>;
}

export interface ProviderConfigRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeProviderConfigFile(value: unknown): Record<string, ProviderConfig> {
  if (isRecord(value) && value.version === 1 && isRecord(value.providers)) {
    return value.providers as Record<string, ProviderConfig>;
  }

  if (isRecord(value)) {
    return value as Record<string, ProviderConfig>;
  }

  return {};
}

/**
 * Provider configuration repository
 */
export class ProviderConfigRepo {
  private readonly filePath: string;

  constructor(input: ProviderConfigRepoOptions) {
    this.filePath = input.filePath;
  }

  private loadFileConfigs(): Record<string, ProviderConfig> {
    const parsed = readJsonFile<ProviderConfigFileRecord | Record<string, ProviderConfig>>(
      this.filePath
    );
    if (parsed !== undefined) {
      return { ...normalizeProviderConfigFile(parsed) };
    }

    return {};
  }

  private saveFileConfigs(configs: Record<string, ProviderConfig>): void {
    const payload: ProviderConfigFileRecord = {
      version: 1,
      providers: configs,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }

  /**
   * Gets a provider configuration by provider ID
   */
  get(providerId: string): ProviderConfig | undefined {
    return this.loadFileConfigs()[providerId];
  }

  /**
   * Sets a provider configuration
   * Creates the configuration if it doesn't exist, updates if it does
   */
  set(providerId: string, config: ProviderConfig): void {
    const next = this.loadFileConfigs();
    next[providerId] = config;
    this.saveFileConfigs(next);
  }

  /**
   * Deletes a provider configuration by provider ID
   */
  delete(providerId: string): void {
    const next = this.loadFileConfigs();
    if (!Object.prototype.hasOwnProperty.call(next, providerId)) {
      return;
    }
    delete next[providerId];
    this.saveFileConfigs(next);
  }

  /**
   * Lists all provider IDs that have configurations
   */
  listProviderIds(): string[] {
    return Object.keys(this.loadFileConfigs());
  }

  /**
   * Gets all provider configurations as a key-value object
   */
  getAll(): Record<string, ProviderConfig> {
    return { ...this.loadFileConfigs() };
  }
}

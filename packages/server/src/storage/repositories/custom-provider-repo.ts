import type { CustomProviderConfig } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface CustomProviderFileRecord {
  version: 1;
  providers: Record<string, CustomProviderConfig>;
}

export interface CustomProviderRepoOptions {
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeConfig(config: CustomProviderConfig): CustomProviderConfig {
  return {
    ...config,
    args: [...config.args],
    env: { ...config.env },
    capabilities: config.capabilities.map((capability) => ({ ...capability })),
  };
}

function normalizeFileConfigs(value: unknown): Record<string, CustomProviderConfig> {
  if (isRecord(value) && value.version === 1 && isRecord(value.providers)) {
    return Object.fromEntries(
      Object.entries(value.providers).map(([id, config]) => [
        id,
        normalizeConfig(config as CustomProviderConfig),
      ])
    );
  }

  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([id, config]) => [
        id,
        normalizeConfig(config as CustomProviderConfig),
      ])
    );
  }

  return {};
}

export class CustomProviderRepo {
  private readonly filePath: string;

  constructor(input: CustomProviderRepoOptions) {
    this.filePath = input.filePath;
  }

  list(): CustomProviderConfig[] {
    return Object.values(this.loadFileConfigs()).sort(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id)
    );
  }

  get(id: string): CustomProviderConfig | undefined {
    return this.loadFileConfigs()[id];
  }

  set(config: CustomProviderConfig): CustomProviderConfig {
    const existing = this.get(config.id);
    const createdAt = existing?.createdAt ?? config.createdAt;
    const normalized = normalizeConfig({
      ...config,
      createdAt,
    });

    const next = this.loadFileConfigs();
    next[normalized.id] = normalized;
    this.saveFileConfigs(next);
    return next[normalized.id]!;
  }

  delete(id: string): void {
    const next = this.loadFileConfigs();
    if (!Object.prototype.hasOwnProperty.call(next, id)) {
      return;
    }
    delete next[id];
    this.saveFileConfigs(next);
  }

  private loadFileConfigs(): Record<string, CustomProviderConfig> {
    const parsed = readJsonFile<CustomProviderFileRecord | Record<string, CustomProviderConfig>>(
      this.filePath
    );
    if (parsed !== undefined) {
      return normalizeFileConfigs(parsed);
    }

    return {};
  }

  private saveFileConfigs(configs: Record<string, CustomProviderConfig>): void {
    const payload: CustomProviderFileRecord = {
      version: 1,
      providers: configs,
    };
    writeJsonFileAtomic(this.filePath, payload);
  }
}

import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface AppearanceAssetRecord {
  id: string;
  fileName: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  size: number;
  storagePath: string;
  createdAt: number;
}

interface AppearanceAssetFileRecord {
  version: 1;
  assets: Record<string, AppearanceAssetRecord>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeAppearanceAssetFile(value: unknown): Record<string, AppearanceAssetRecord> {
  if (isRecord(value) && value.version === 1 && isRecord(value.assets)) {
    return value.assets as Record<string, AppearanceAssetRecord>;
  }

  if (isRecord(value)) {
    return value as Record<string, AppearanceAssetRecord>;
  }

  return {};
}

export class AppearanceAssetRepo {
  constructor(private readonly options: { filePath: string }) {}

  private loadFileAssets(): Record<string, AppearanceAssetRecord> {
    const parsed = readJsonFile<AppearanceAssetFileRecord | Record<string, AppearanceAssetRecord>>(
      this.options.filePath
    );
    if (parsed !== undefined) {
      return { ...normalizeAppearanceAssetFile(parsed) };
    }

    return {};
  }

  private saveFileAssets(assets: Record<string, AppearanceAssetRecord>): void {
    const payload: AppearanceAssetFileRecord = {
      version: 1,
      assets,
    };
    writeJsonFileAtomic(this.options.filePath, payload);
  }

  get(id: string): AppearanceAssetRecord | undefined {
    return this.loadFileAssets()[id];
  }

  set(record: AppearanceAssetRecord): void {
    const next = this.loadFileAssets();
    next[record.id] = record;
    this.saveFileAssets(next);
  }

  delete(id: string): void {
    const next = this.loadFileAssets();
    if (!Object.prototype.hasOwnProperty.call(next, id)) {
      return;
    }

    delete next[id];
    this.saveFileAssets(next);
  }

  list(): AppearanceAssetRecord[] {
    return Object.values(this.loadFileAssets());
  }
}

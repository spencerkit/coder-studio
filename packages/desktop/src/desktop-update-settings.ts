import { readFile } from "node:fs/promises";
import {
  createDefaultDesktopUpdateSettings,
  type DesktopUpdateSettings,
  type UpdateCheckIntervalSec,
} from "@coder-studio/core";
import { writeJsonFileAtomic } from "./atomic-json-file.js";

const VALID_INTERVALS = new Set<UpdateCheckIntervalSec>([3600, 21600, 43200, 86400]);

export interface DesktopUpdateSettingsRepoOptions {
  filePath: string;
  onWarning?: (message: string) => void;
}

function parseSettings(value: unknown): DesktopUpdateSettings {
  if (!value || typeof value !== "object") throw new Error("settings must be an object");
  const candidate = value as Partial<DesktopUpdateSettings>;
  if (
    candidate.schemaVersion !== 1 ||
    typeof candidate.autoCheckEnabled !== "boolean" ||
    !VALID_INTERVALS.has(candidate.checkIntervalSec as UpdateCheckIntervalSec)
  ) {
    throw new Error("settings are invalid");
  }
  return {
    schemaVersion: 1,
    autoCheckEnabled: candidate.autoCheckEnabled,
    checkIntervalSec: candidate.checkIntervalSec as UpdateCheckIntervalSec,
  };
}

export class DesktopUpdateSettingsRepo {
  constructor(private readonly options: DesktopUpdateSettingsRepoOptions) {}

  async get(): Promise<DesktopUpdateSettings> {
    try {
      return parseSettings(JSON.parse(await readFile(this.options.filePath, "utf8")));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        this.options.onWarning?.(
          `Unable to read desktop-update-settings.json: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      return createDefaultDesktopUpdateSettings();
    }
  }

  async set(patch: Partial<DesktopUpdateSettings>): Promise<DesktopUpdateSettings> {
    const current = await this.get();
    const settings = parseSettings({ ...current, ...patch, schemaVersion: 1 });
    await writeJsonFileAtomic(this.options.filePath, settings);
    return settings;
  }
}

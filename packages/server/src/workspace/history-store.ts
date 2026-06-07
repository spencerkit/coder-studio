import { basename } from "node:path";
import type { WorkspaceHistoryEntry } from "@coder-studio/core";
import { z } from "zod";
import { SettingsRepo } from "../storage/repositories/settings-repo.js";

export const WORKSPACE_HISTORY_KEY = "workspace.history";
const WORKSPACE_HISTORY_LIMIT = 20;

const workspaceHistoryEntrySchema = z.object({
  path: z.string(),
  name: z.string(),
  lastOpenedAt: z.number(),
});

function normalizeHistory(value: unknown): WorkspaceHistoryEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .flatMap((entry) => {
      const parsed = workspaceHistoryEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    })
    .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
    .slice(0, WORKSPACE_HISTORY_LIMIT);
}

function buildEntry(path: string, lastOpenedAt: number): WorkspaceHistoryEntry {
  const trimmedPath = path.trim();
  const derivedName = basename(trimmedPath) || trimmedPath;

  return {
    path: trimmedPath,
    name: derivedName,
    lastOpenedAt,
  };
}

export class WorkspaceHistoryStore {
  private readonly settingsRepo: SettingsRepo;

  constructor(settingsRepo: SettingsRepo) {
    this.settingsRepo = settingsRepo;
  }

  list(): WorkspaceHistoryEntry[] {
    return normalizeHistory(this.settingsRepo.get<unknown>(WORKSPACE_HISTORY_KEY));
  }

  recordOpen(path: string, now = Date.now()): void {
    const nextEntry = buildEntry(path, now);
    const nextHistory = [nextEntry, ...this.list().filter((entry) => entry.path !== nextEntry.path)]
      .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
      .slice(0, WORKSPACE_HISTORY_LIMIT);

    this.settingsRepo.set(WORKSPACE_HISTORY_KEY, nextHistory);
  }
}

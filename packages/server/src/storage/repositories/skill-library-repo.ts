import type { SkillLibraryEntry } from "@coder-studio/core";
import { scanLocalSkillEntries } from "../../skills/local-skill-scanner.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SkillLibraryFileRecord {
  version: 1;
  entries?: Record<string, SkillLibraryEntry>;
}

function isSkillLibraryFileRecord(value: unknown): value is SkillLibraryFileRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1
  );
}

type SkillLibraryRecord = Record<string, SkillLibraryEntry>;

export class SkillLibraryRepo {
  constructor(private readonly input: { filePath: string; localSkillRoots?: string[] }) {}

  list(): SkillLibraryEntry[] {
    return Object.values(this.load()).sort(
      (left, right) => right.updatedAt - left.updatedAt || left.slug.localeCompare(right.slug)
    );
  }

  get(slug: string): SkillLibraryEntry | undefined {
    return this.load()[slug];
  }

  set(entry: SkillLibraryEntry): SkillLibraryEntry {
    const next = this.loadPersisted();
    next[entry.slug] = { ...entry };
    this.save(next);
    return next[entry.slug]!;
  }

  delete(slug: string): void {
    const next = this.loadPersisted();
    delete next[slug];
    this.save(next);
  }

  private load(): SkillLibraryRecord {
    const persisted = this.loadPersisted();
    const discovered = scanLocalSkillEntries(this.input.localSkillRoots ?? []);

    for (const entry of discovered) {
      const existing = persisted[entry.slug];
      if (!existing || existing.source === "local") {
        persisted[entry.slug] = entry;
      }
    }

    return persisted;
  }

  private loadPersisted(): SkillLibraryRecord {
    const parsed = readJsonFile<SkillLibraryFileRecord | SkillLibraryRecord>(this.input.filePath);
    if (isSkillLibraryFileRecord(parsed)) {
      return { ...(parsed.entries ?? {}) };
    }
    return parsed ? { ...parsed } : {};
  }

  private save(entries: Record<string, SkillLibraryEntry>): void {
    writeJsonFileAtomic(this.input.filePath, { version: 1, entries });
  }
}

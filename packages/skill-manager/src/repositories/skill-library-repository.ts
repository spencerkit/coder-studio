import type { SkillLibraryEntry } from "../domain/skill-management.js";
import type { SkillJsonStorage } from "../ports/json-storage.js";
import type { SkillLibraryRepositoryPort } from "../ports/repositories.js";

type LegacySkillLibrarySource = SkillLibraryEntry["source"] | "local" | "skillhub";
type LegacySkillLibraryOrigin = SkillLibraryEntry["origin"] | "local" | "skillhub";

type PersistedSkillLibraryEntry = Omit<SkillLibraryEntry, "source" | "origin"> & {
  source: LegacySkillLibrarySource;
  origin?: LegacySkillLibraryOrigin;
};

type ModernPersistedSkillLibraryEntry = Omit<PersistedSkillLibraryEntry, "source" | "origin"> & {
  source: SkillLibraryEntry["source"];
  origin?: SkillLibraryEntry["origin"];
};

export interface SkillLibraryJsonDocumentV1 {
  version: 1;
  entries?: Record<string, SkillLibraryEntry>;
}

interface ReadableSkillLibraryJsonDocumentV1 {
  version: 1;
  entries?: Record<string, PersistedSkillLibraryEntry>;
}

type SkillLibraryRecord = Record<string, SkillLibraryEntry>;

export interface SkillLibraryRepositoryOptions {
  storage: SkillJsonStorage;
  discover?: () => SkillLibraryEntry[];
  isCustomLocation?: (libraryPath: string) => boolean;
}

export class SkillLibraryRepository implements SkillLibraryRepositoryPort {
  constructor(private readonly options: SkillLibraryRepositoryOptions) {}

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
    next[entry.slug] = normalizePersistedEntry(entry, this.options.isCustomLocation);
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
    for (const entry of this.options.discover?.() ?? []) {
      const existing = persisted[entry.slug];
      if (!existing || compareEntryPriority(entry, existing) > 0) {
        persisted[entry.slug] = entry;
      }
    }
    return persisted;
  }

  private loadPersisted(): SkillLibraryRecord {
    const parsed = this.options.storage.read("skills.library") as
      | ReadableSkillLibraryJsonDocumentV1
      | Record<string, PersistedSkillLibraryEntry>
      | undefined;
    const records = isSkillLibraryFileRecord(parsed) ? (parsed.entries ?? {}) : (parsed ?? {});
    const normalized: SkillLibraryRecord = {};

    for (const [slug, entry] of Object.entries(records)) {
      normalized[slug] = normalizePersistedEntry(entry, this.options.isCustomLocation);
    }
    return normalized;
  }

  private save(entries: SkillLibraryRecord): void {
    this.options.storage.write("skills.library", { version: 1, entries });
  }
}

function isSkillLibraryFileRecord(value: unknown): value is ReadableSkillLibraryJsonDocumentV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1
  );
}

function normalizePersistedEntry(
  entry: PersistedSkillLibraryEntry,
  isCustomLocation: ((libraryPath: string) => boolean) | undefined
): SkillLibraryEntry {
  if (entry.source === "skillhub" || entry.origin === "skillhub") {
    return { ...entry, source: "installed", origin: "skillhub" };
  }

  const isCustom = isCustomLocation?.(entry.libraryPath) === true;
  if (entry.source === "local" || isCustom) {
    return {
      ...entry,
      source: isCustom ? "custom" : "installed",
      origin: "filesystem",
    };
  }

  const modernEntry = entry as ModernPersistedSkillLibraryEntry;
  return modernEntry.source === "installed" && !modernEntry.origin
    ? { ...modernEntry, origin: "filesystem" }
    : modernEntry;
}

function compareEntryPriority(left: SkillLibraryEntry, right: SkillLibraryEntry): number {
  return priorityOf(left) - priorityOf(right);
}

function priorityOf(entry: SkillLibraryEntry): number {
  if (entry.source === "builtin") return 4;
  if (entry.source === "custom") return 3;
  if (
    entry.source === "installed" &&
    (entry.origin === "skillhub" || entry.origin === "skills-sh")
  ) {
    return 2;
  }
  return 1;
}

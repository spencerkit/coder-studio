import { relative } from "node:path";
import type { SkillLibraryEntry } from "@coder-studio/core";
import { scanDiscoveredSkillEntries } from "../../skills/local-skill-scanner.js";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

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

interface SkillLibraryFileRecord {
  version: 1;
  entries?: Record<string, PersistedSkillLibraryEntry>;
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
  constructor(
    private readonly input: {
      filePath: string;
      builtinRoot?: string;
      managedLibraryRoot?: string;
      customSkillRoot?: string;
      externalSkillRoots?: string[];
      localSkillRoots?: string[];
    }
  ) {}

  getCustomSkillRoot(): string {
    return this.input.customSkillRoot ?? "";
  }

  getLocalRoots(): string[] {
    if (this.input.customSkillRoot) {
      return [this.input.customSkillRoot, ...(this.input.externalSkillRoots ?? [])];
    }

    return [...(this.input.localSkillRoots ?? [])];
  }

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
    next[entry.slug] = normalizePersistedEntry(entry, this.getCustomSkillRoot());
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
    const discovered = scanDiscoveredSkillEntries({
      builtinRoot: this.input.builtinRoot,
      managedLibraryRoot: this.input.managedLibraryRoot,
      customRoot: this.input.customSkillRoot,
      externalRoots: this.input.externalSkillRoots ?? this.input.localSkillRoots ?? [],
    });

    for (const entry of discovered) {
      const existing = persisted[entry.slug];
      if (!existing || compareEntryPriority(entry, existing) > 0) {
        persisted[entry.slug] = entry;
      }
    }

    return persisted;
  }

  private loadPersisted(): SkillLibraryRecord {
    const parsed = readJsonFile<
      SkillLibraryFileRecord | Record<string, PersistedSkillLibraryEntry>
    >(this.input.filePath);
    const records = isSkillLibraryFileRecord(parsed) ? (parsed.entries ?? {}) : (parsed ?? {});
    const normalized: SkillLibraryRecord = {};

    for (const [slug, entry] of Object.entries(records)) {
      normalized[slug] = normalizePersistedEntry(entry, this.getCustomSkillRoot());
    }

    return normalized;
  }

  private save(entries: Record<string, SkillLibraryEntry>): void {
    writeJsonFileAtomic(this.input.filePath, { version: 1, entries });
  }
}

function normalizePersistedEntry(
  entry: PersistedSkillLibraryEntry,
  customRoot: string
): SkillLibraryEntry {
  if (entry.source === "skillhub" || entry.origin === "skillhub") {
    return {
      ...entry,
      source: "installed",
      origin: "skillhub",
    };
  }

  const isUnderCustomRoot = isPathInsideRoot(entry.libraryPath, customRoot);
  const isLegacyLocal = entry.source === "local";

  if (isLegacyLocal || isUnderCustomRoot) {
    return {
      ...entry,
      source: isUnderCustomRoot ? "custom" : "installed",
      origin: "filesystem",
    };
  }

  const modernEntry = entry as ModernPersistedSkillLibraryEntry;

  return modernEntry.source === "installed" && !modernEntry.origin
    ? {
        ...modernEntry,
        origin: "filesystem",
      }
    : modernEntry;
}

function isPathInsideRoot(candidatePath: string, rootPath: string): boolean {
  if (!rootPath) {
    return false;
  }

  const relativePath = relative(rootPath, candidatePath);
  return relativePath !== "" && !relativePath.startsWith("..") && !relativePath.includes(":/");
}

function compareEntryPriority(left: SkillLibraryEntry, right: SkillLibraryEntry): number {
  return priorityOf(left) - priorityOf(right);
}

function priorityOf(entry: SkillLibraryEntry): number {
  if (entry.source === "builtin") {
    return 4;
  }
  if (entry.source === "custom") {
    return 3;
  }
  if (entry.source === "installed" && entry.origin === "skillhub") {
    return 2;
  }
  return 1;
}

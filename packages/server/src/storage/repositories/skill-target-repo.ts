import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

export interface SkillTargetSettingRecord {
  providerId: string;
  skillDir?: string;
  updatedAt: number;
}

interface SkillTargetFileRecord {
  version: 1;
  targets?: Record<string, SkillTargetSettingRecord>;
}

function isSkillTargetFileRecord(value: unknown): value is SkillTargetFileRecord {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1
  );
}

type SkillTargetRecord = Record<string, SkillTargetSettingRecord>;

export class SkillTargetRepo {
  constructor(private readonly input: { filePath: string }) {}

  list(): SkillTargetSettingRecord[] {
    return Object.values(this.load()).sort((left, right) =>
      left.providerId.localeCompare(right.providerId)
    );
  }

  get(providerId: string): SkillTargetSettingRecord | undefined {
    return this.load()[providerId];
  }

  set(record: SkillTargetSettingRecord): SkillTargetSettingRecord {
    const next = this.load();
    next[record.providerId] = { ...record };
    this.save(next);
    return next[record.providerId]!;
  }

  delete(providerId: string): void {
    const next = this.load();
    delete next[providerId];
    this.save(next);
  }

  private load(): SkillTargetRecord {
    const parsed = readJsonFile<SkillTargetFileRecord | SkillTargetRecord>(this.input.filePath);
    if (isSkillTargetFileRecord(parsed)) {
      return { ...(parsed.targets ?? {}) };
    }
    return parsed ? { ...parsed } : {};
  }

  private save(targets: Record<string, SkillTargetSettingRecord>): void {
    writeJsonFileAtomic(this.input.filePath, { version: 1, targets });
  }
}

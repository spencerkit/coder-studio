import type { SkillJsonStorage } from "../ports/json-storage.js";
import type { SkillTargetRepositoryPort, SkillTargetSettingRecord } from "../ports/repositories.js";

export interface SkillTargetJsonDocumentV1 {
  version: 1;
  targets?: Record<string, SkillTargetSettingRecord>;
}

type SkillTargetRecord = Record<string, SkillTargetSettingRecord>;

export class SkillTargetRepository implements SkillTargetRepositoryPort {
  constructor(private readonly storage: SkillJsonStorage) {}

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
    const parsed = this.storage.read("skills.targets") as
      | SkillTargetJsonDocumentV1
      | SkillTargetRecord
      | undefined;
    if (isSkillTargetFileRecord(parsed)) {
      return { ...(parsed.targets ?? {}) };
    }
    return parsed ? { ...parsed } : {};
  }

  private save(targets: SkillTargetRecord): void {
    this.storage.write("skills.targets", { version: 1, targets });
  }
}

function isSkillTargetFileRecord(value: unknown): value is SkillTargetJsonDocumentV1 {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as { version?: unknown }).version === 1
  );
}

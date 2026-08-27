import type { SkillLibraryEntry, SkillMountRelation } from "../domain/skill-management.js";

export interface SkillLibraryRepositoryPort {
  list(): SkillLibraryEntry[];
  get(slug: string): SkillLibraryEntry | undefined;
  set(entry: SkillLibraryEntry): SkillLibraryEntry;
  delete(slug: string): void;
}

export interface SkillMountRepositoryPort {
  list(): SkillMountRelation[];
  get(providerId: string, skillSlug: string): SkillMountRelation | undefined;
  listByProviderId(providerId: string): SkillMountRelation[];
  listBySkillSlug(skillSlug: string): SkillMountRelation[];
  upsert(relation: SkillMountRelation): SkillMountRelation;
  delete(providerId: string, skillSlug: string): void;
  deleteBySkillSlug(skillSlug: string): void;
  countsByProviderId(): Record<string, number>;
}

export interface SkillTargetSettingRecord {
  providerId: string;
  skillDir?: string;
  updatedAt: number;
}

export interface SkillTargetRepositoryPort {
  list(): SkillTargetSettingRecord[];
  get(providerId: string): SkillTargetSettingRecord | undefined;
  set(record: SkillTargetSettingRecord): SkillTargetSettingRecord;
  delete(providerId: string): void;
}

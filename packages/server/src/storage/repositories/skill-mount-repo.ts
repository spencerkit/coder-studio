import type { SkillMountRelation } from "@coder-studio/core";
import { readJsonFile, writeJsonFileAtomic } from "./json-file-store.js";

interface SkillMountFileRecord {
  version: 1;
  mounts: SkillMountRelation[];
}

function sortRelations(relations: SkillMountRelation[]): SkillMountRelation[] {
  return [...relations].sort(
    (left, right) =>
      left.providerId.localeCompare(right.providerId) ||
      left.skillSlug.localeCompare(right.skillSlug)
  );
}

export class SkillMountRepo {
  constructor(private readonly input: { filePath: string }) {}
  list(): SkillMountRelation[] {
    return sortRelations(this.load());
  }

  get(providerId: string, skillSlug: string): SkillMountRelation | undefined {
    return this.list().find(
      (entry) => entry.providerId === providerId && entry.skillSlug === skillSlug
    );
  }

  listByProviderId(providerId: string): SkillMountRelation[] {
    return this.list().filter((entry) => entry.providerId === providerId);
  }

  listBySkillSlug(skillSlug: string): SkillMountRelation[] {
    return this.list().filter((entry) => entry.skillSlug === skillSlug);
  }

  upsert(relation: SkillMountRelation): SkillMountRelation {
    const next = this.load().filter(
      (entry) =>
        !(entry.providerId === relation.providerId && entry.skillSlug === relation.skillSlug)
    );
    next.push({ ...relation });
    this.save(next);
    return relation;
  }

  delete(providerId: string, skillSlug: string): void {
    this.save(
      this.load().filter(
        (entry) => !(entry.providerId === providerId && entry.skillSlug === skillSlug)
      )
    );
  }

  deleteBySkillSlug(skillSlug: string): void {
    this.save(this.load().filter((entry) => entry.skillSlug !== skillSlug));
  }

  countsByProviderId(): Record<string, number> {
    return this.list().reduce<Record<string, number>>((acc, entry) => {
      if (!entry.enabled) return acc;
      acc[entry.providerId] = (acc[entry.providerId] ?? 0) + 1;
      return acc;
    }, {});
  }

  private load(): SkillMountRelation[] {
    const parsed = readJsonFile<SkillMountFileRecord | SkillMountRelation[]>(this.input.filePath);
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      return [...(parsed.mounts ?? [])];
    }
    return parsed ? [...parsed] : [];
  }

  private save(mounts: SkillMountRelation[]): void {
    writeJsonFileAtomic(this.input.filePath, { version: 1, mounts: sortRelations(mounts) });
  }
}

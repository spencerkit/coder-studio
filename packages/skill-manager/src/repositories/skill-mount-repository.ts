import type { SkillMountRelation } from "../domain/skill-management.js";
import type { SkillJsonStorage } from "../ports/json-storage.js";
import type { SkillMountRepositoryPort } from "../ports/repositories.js";

export interface SkillMountJsonDocumentV1 {
  version: 1;
  mounts: SkillMountRelation[];
}

export class SkillMountRepository implements SkillMountRepositoryPort {
  constructor(private readonly storage: SkillJsonStorage) {}

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
    const parsed = this.storage.read("skills.mounts") as
      | SkillMountJsonDocumentV1
      | SkillMountRelation[]
      | undefined;
    if (parsed && typeof parsed === "object" && "version" in parsed) {
      return [...(parsed.mounts ?? [])];
    }
    return parsed ? [...parsed] : [];
  }

  private save(mounts: SkillMountRelation[]): void {
    this.storage.write("skills.mounts", { version: 1, mounts: sortRelations(mounts) });
  }
}

function sortRelations(relations: SkillMountRelation[]): SkillMountRelation[] {
  return [...relations].sort(
    (left, right) =>
      left.providerId.localeCompare(right.providerId) ||
      left.skillSlug.localeCompare(right.skillSlug)
  );
}

import type {
  AgentSkillTargetEntry,
  SkillInstallJobSnapshot,
  SkillLibraryEntry,
  SkillMountRelation,
} from "../domain/skill-management.js";

export interface SkillCatalogEntry {
  slug: string;
  registryRef?: string;
  displayName?: string;
  name?: string;
  description?: string;
  version?: string;
  installCount?: number;
  githubStars?: number;
}

export interface SkillCatalogHost {
  search(query: string): Promise<SkillCatalogEntry[]>;
  info(slug: string, registryRef?: string): Promise<SkillCatalogEntry>;
}

export interface SkillInstallJobsHost {
  start(slug: string, registryRef?: string): Promise<SkillInstallJobSnapshot>;
  get(jobId: string): SkillInstallJobSnapshot | undefined;
}

export interface SkillMountHost {
  mount(input: {
    providerId: string;
    skillSlug: string;
    enabled: boolean;
  }): Promise<SkillMountRelation>;
  unmount(providerId: string, skillSlug: string): Promise<void>;
}

export interface SkillHealthHost {
  discoverMounts(existingRelations: SkillMountRelation[]): Promise<SkillMountRelation[]>;
  scanMount(relation: SkillMountRelation): Promise<SkillMountRelation>;
}

export interface SkillTargetProvider {
  listTargets(
    mountCountsByProviderId: Record<string, number>
  ): Promise<Array<AgentSkillTargetEntry & { mountedSkillCount: number }>>;
}

export interface LocalSkillImportInput {
  source: string;
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
}

export interface SkillContentHost {
  importLocal?(input: LocalSkillImportInput): Promise<{ libraryPath: string }>;
  canRemove?(entry: SkillLibraryEntry): boolean | Promise<boolean>;
  remove?(entry: SkillLibraryEntry): Promise<void>;
}

export type SkillManagerEvent =
  | { reason: "imported"; slug: string }
  | { reason: "mounted" | "unmounted" | "repaired"; providerId: string; skillSlug: string }
  | { reason: "uninstalled"; slug: string };

export interface SkillEventPublisher {
  publish(event: SkillManagerEvent): void;
}

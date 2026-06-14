import type { ProviderDefinition, SkillLibraryEntry, SkillMountRelation } from "@coder-studio/core";
import type { SettingsRepo } from "../../storage/repositories/settings-repo.js";
import type { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import type { SkillMountManager } from "../mount-manager.js";
import { materializeBuiltinSkills } from "./materialize.js";
import { BuiltinSkillMountPreferences } from "./mount-preferences.js";
import type { BuiltinSkillDefinition } from "./registry.js";
import { removeStaleBuiltinSkills } from "./stale-cleanup.js";

export interface BuiltinSkillSyncManagerDeps {
  builtinRoot: string;
  getProviderRegistry: () => ProviderDefinition[];
  skillLibraryRepo: SkillLibraryRepo;
  skillMountRepo: SkillMountRepo;
  skillMountMgr: SkillMountManager;
  settingsRepo: SettingsRepo;
  now?: () => number;
  skills?: readonly BuiltinSkillDefinition[];
}

export interface BuiltinSkillSyncResult {
  libraryEntries: SkillLibraryEntry[];
  mounted: SkillMountRelation[];
  skipped: Array<{ providerId: string; skillSlug: string; reason: string }>;
  removed: Array<{ skillSlug: string; unmountedProviderIds: string[] }>;
}

export class BuiltinSkillSyncManager {
  private preferences?: BuiltinSkillMountPreferences;

  constructor(private readonly deps: BuiltinSkillSyncManagerDeps) {}

  async sync(): Promise<BuiltinSkillSyncResult> {
    const entries = await materializeBuiltinSkills({
      builtinRoot: this.deps.builtinRoot,
      now: this.deps.now,
      skills: this.deps.skills,
    });
    for (const entry of entries) {
      this.deps.skillLibraryRepo.set(entry);
    }
    const removed = await removeStaleBuiltinSkills({
      builtinRoot: this.deps.builtinRoot,
      currentEntries: entries,
      libraryRepo: this.deps.skillLibraryRepo,
      mountRepo: this.deps.skillMountRepo,
      mountManager: this.deps.skillMountMgr,
      getProviderRegistry: this.deps.getProviderRegistry,
      preferences: this.getPreferences(),
    });

    const mounted: SkillMountRelation[] = [];
    const skipped: BuiltinSkillSyncResult["skipped"] = [];

    for (const provider of this.deps.getProviderRegistry()) {
      if (!this.shouldAutoMountProvider(provider)) {
        continue;
      }

      for (const entry of entries) {
        const decision = this.getPreferences().getMountDecision(
          provider.id,
          entry.slug,
          entry.builtin?.autoMount === true
        );

        if (!decision.shouldMount && decision.reason === "disabled") {
          await this.deps.skillMountMgr.unmount(provider.id, entry.slug);
          skipped.push({ providerId: provider.id, skillSlug: entry.slug, reason: "disabled" });
          continue;
        }

        if (!decision.shouldMount && decision.reason === "not_mvp_auto") {
          skipped.push({ providerId: provider.id, skillSlug: entry.slug, reason: "not_mvp_auto" });
          continue;
        }

        const relation = await this.deps.skillMountMgr.mount({
          providerId: provider.id,
          skillSlug: entry.slug,
          enabled: true,
        });
        this.deps.skillMountRepo.upsert(relation);
        mounted.push(relation);
      }
    }

    return { libraryEntries: entries, mounted, skipped, removed };
  }

  setMountEnabled(providerId: string, skillSlug: string, enabled: boolean): void {
    this.getPreferences().setMountEnabled(providerId, skillSlug, enabled);
  }

  isMountDisabled(providerId: string, skillSlug: string): boolean {
    return this.getPreferences().isMountDisabled(providerId, skillSlug);
  }

  private shouldAutoMountProvider(provider: ProviderDefinition): boolean {
    if (!provider.skillMountDirectories?.[0]) {
      return false;
    }

    return provider.kind !== "custom" || provider.supportsSkillsMount === true;
  }

  private getPreferences(): BuiltinSkillMountPreferences {
    if (this.preferences) {
      return this.preferences;
    }

    this.preferences = new BuiltinSkillMountPreferences(this.deps.settingsRepo);
    return this.preferences;
  }
}

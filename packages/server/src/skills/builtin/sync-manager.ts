import type { ProviderDefinition, SkillLibraryEntry, SkillMountRelation } from "@coder-studio/core";
import type { SettingsRepo } from "../../storage/repositories/settings-repo.js";
import type { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import type { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import type { SkillMountManager } from "../mount-manager.js";
import { materializeBuiltinSkills } from "./materialize.js";

const DISABLED_MOUNTS_SETTING_KEY = "skills.builtin.disabledMounts";

export interface BuiltinSkillSyncManagerDeps {
  builtinRoot: string;
  getProviderRegistry: () => ProviderDefinition[];
  skillLibraryRepo: SkillLibraryRepo;
  skillMountRepo: SkillMountRepo;
  skillMountMgr: SkillMountManager;
  settingsRepo: SettingsRepo;
  now?: () => number;
}

export interface BuiltinSkillSyncResult {
  libraryEntries: SkillLibraryEntry[];
  mounted: SkillMountRelation[];
  skipped: Array<{ providerId: string; skillSlug: string; reason: string }>;
}

export class BuiltinSkillSyncManager {
  constructor(private readonly deps: BuiltinSkillSyncManagerDeps) {}

  async sync(): Promise<BuiltinSkillSyncResult> {
    const entries = await materializeBuiltinSkills({
      builtinRoot: this.deps.builtinRoot,
      now: this.deps.now,
    });
    for (const entry of entries) {
      this.deps.skillLibraryRepo.set(entry);
    }

    const disabled = this.readDisabledMounts();
    const mounted: SkillMountRelation[] = [];
    const skipped: BuiltinSkillSyncResult["skipped"] = [];

    for (const provider of this.deps.getProviderRegistry()) {
      if (!this.shouldAutoMountProvider(provider)) {
        continue;
      }

      for (const entry of entries) {
        if (!entry.builtin?.autoMount) {
          skipped.push({ providerId: provider.id, skillSlug: entry.slug, reason: "not_mvp_auto" });
          continue;
        }

        if (disabled[disabledKey(provider.id, entry.slug)]) {
          skipped.push({ providerId: provider.id, skillSlug: entry.slug, reason: "disabled" });
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

    return { libraryEntries: entries, mounted, skipped };
  }

  setMountEnabled(providerId: string, skillSlug: string, enabled: boolean): void {
    const disabled = this.readDisabledMounts();
    const key = disabledKey(providerId, skillSlug);
    if (enabled) {
      delete disabled[key];
    } else {
      disabled[key] = true;
    }
    this.deps.settingsRepo.set(DISABLED_MOUNTS_SETTING_KEY, disabled);
  }

  isMountDisabled(providerId: string, skillSlug: string): boolean {
    return Boolean(this.readDisabledMounts()[disabledKey(providerId, skillSlug)]);
  }

  private shouldAutoMountProvider(provider: ProviderDefinition): boolean {
    if (!provider.skillMountDirectories?.[0]) {
      return false;
    }

    return provider.kind !== "custom" || provider.supportsSkillsMount === true;
  }

  private readDisabledMounts(): Record<string, true> {
    const raw = this.deps.settingsRepo.get<Record<string, unknown>>(DISABLED_MOUNTS_SETTING_KEY);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }
    return Object.fromEntries(Object.entries(raw).filter(([, value]) => value === true)) as Record<
      string,
      true
    >;
  }
}

function disabledKey(providerId: string, skillSlug: string): string {
  return `${providerId}:${skillSlug}`;
}

import type { SettingsRepo } from "../../storage/repositories/settings-repo.js";

const DISABLED_MOUNTS_SETTING_KEY = "skills.builtin.disabledMounts";
const ENABLED_MOUNTS_SETTING_KEY = "skills.builtin.enabledMounts";

export interface BuiltinSkillMountDecision {
  shouldMount: boolean;
  reason?: "disabled" | "not_mvp_auto";
}

export class BuiltinSkillMountPreferences {
  constructor(private readonly settingsRepo: SettingsRepo) {}

  getMountDecision(
    providerId: string,
    skillSlug: string,
    autoMountInMvp: boolean
  ): BuiltinSkillMountDecision {
    const key = mountPreferenceKey(providerId, skillSlug);
    const disabled = this.readPreferenceMap(DISABLED_MOUNTS_SETTING_KEY);
    if (disabled[key]) {
      return { shouldMount: false, reason: "disabled" };
    }

    const enabled = this.readPreferenceMap(ENABLED_MOUNTS_SETTING_KEY);
    if (!autoMountInMvp && !enabled[key]) {
      return { shouldMount: false, reason: "not_mvp_auto" };
    }

    return { shouldMount: true };
  }

  setMountEnabled(providerId: string, skillSlug: string, enabled: boolean): void {
    const disabledMounts = this.readPreferenceMap(DISABLED_MOUNTS_SETTING_KEY);
    const enabledMounts = this.readPreferenceMap(ENABLED_MOUNTS_SETTING_KEY);
    const key = mountPreferenceKey(providerId, skillSlug);

    if (enabled) {
      delete disabledMounts[key];
      enabledMounts[key] = true;
    } else {
      disabledMounts[key] = true;
      delete enabledMounts[key];
    }

    this.settingsRepo.set(DISABLED_MOUNTS_SETTING_KEY, disabledMounts);
    this.settingsRepo.set(ENABLED_MOUNTS_SETTING_KEY, enabledMounts);
  }

  isMountDisabled(providerId: string, skillSlug: string): boolean {
    return Boolean(
      this.readPreferenceMap(DISABLED_MOUNTS_SETTING_KEY)[mountPreferenceKey(providerId, skillSlug)]
    );
  }

  removeSkill(skillSlug: string): void {
    this.removeSkillFromSetting(DISABLED_MOUNTS_SETTING_KEY, skillSlug);
    this.removeSkillFromSetting(ENABLED_MOUNTS_SETTING_KEY, skillSlug);
  }

  private removeSkillFromSetting(settingKey: string, skillSlug: string): void {
    const settings = this.readPreferenceMap(settingKey);
    const next = Object.fromEntries(
      Object.entries(settings).filter(([key]) => !key.endsWith(`:${skillSlug}`))
    ) as Record<string, true>;

    if (Object.keys(next).length !== Object.keys(settings).length) {
      this.settingsRepo.set(settingKey, next);
    }
  }

  private readPreferenceMap(settingKey: string): Record<string, true> {
    const raw = this.settingsRepo.get<Record<string, unknown>>(settingKey);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return {};
    }

    return Object.fromEntries(Object.entries(raw).filter(([, value]) => value === true)) as Record<
      string,
      true
    >;
  }
}

function mountPreferenceKey(providerId: string, skillSlug: string): string {
  return `${providerId}:${skillSlug}`;
}

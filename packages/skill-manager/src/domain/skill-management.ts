export const SKILL_INSTALL_STATES = ["installed", "installing", "failed"] as const;
export const SKILL_LIBRARY_SOURCES = ["builtin", "installed", "custom"] as const;
export const SKILL_LIBRARY_ORIGINS = ["builtin", "skillhub", "filesystem"] as const;
export const SKILL_LIBRARY_ITEM_STATES = [
  "unmounted",
  "partially_mounted",
  "fully_mounted",
  "error",
] as const;
export const SKILL_MOUNT_STATUSES = [
  "mounted",
  "stale",
  "missing_target",
  "missing_source",
  "failed",
] as const;
export const SKILL_VERSION_CHECK_STATUSES = [
  "up_to_date",
  "update_available",
  "unknown",
  "error",
] as const;
export const SKILL_TARGET_HEALTH_STATES = ["healthy", "warning", "error", "unconfigured"] as const;
export const SKILL_MANAGER_ERROR_CODES = [
  "skills_unavailable",
  "skill_slug_conflict",
  "skill_update_unavailable",
  "skill_install_unavailable",
  "skill_install_job_not_found",
  "skill_import_unavailable",
  "skill_mount_unavailable",
  "skill_mount_not_found",
  "skill_health_unavailable",
  "skill_targets_unavailable",
  "skill_uninstall_unavailable",
  "skill_uninstall_confirmation_required",
  "skill_uninstall_blocked",
] as const;

export type SkillInstallState = (typeof SKILL_INSTALL_STATES)[number];
export type SkillLibrarySource = (typeof SKILL_LIBRARY_SOURCES)[number];
export type SkillLibraryOrigin = (typeof SKILL_LIBRARY_ORIGINS)[number];
export type SkillLibraryItemState = (typeof SKILL_LIBRARY_ITEM_STATES)[number];
export type SkillMountStatus = (typeof SKILL_MOUNT_STATUSES)[number];
export type SkillVersionCheckStatus = (typeof SKILL_VERSION_CHECK_STATUSES)[number];
export type SkillTargetHealthState = (typeof SKILL_TARGET_HEALTH_STATES)[number];
export type SkillManagerErrorCode = (typeof SKILL_MANAGER_ERROR_CODES)[number];

export interface SkillManagerError {
  code: SkillManagerErrorCode;
  message: string;
  details?: string[];
}

export function isSkillMountStatus(value: string): value is SkillMountStatus {
  return (SKILL_MOUNT_STATUSES as readonly string[]).includes(value);
}

export interface SkillLibraryEntry {
  slug: string;
  displayName: string;
  description?: string;
  version: string;
  source: SkillLibrarySource;
  origin?: SkillLibraryOrigin;
  libraryPath: string;
  installState: SkillInstallState;
  installedAt: number;
  updatedAt: number;
  lastError?: string;
  builtin?: {
    defaultEnabled: boolean;
    autoMount: boolean;
  };
}

export interface SkillLibraryListItem extends SkillLibraryEntry {
  mountedProviderIds: string[];
  mountStatus: SkillLibraryItemState;
  errorCount: number;
}

export interface SkillSearchResultItem {
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
  installed: boolean;
  installedVersion?: string;
  mountedProviderIds: string[];
}

export interface SkillInfoItem {
  slug: string;
  displayName: string;
  description?: string;
  version?: string;
  installed: boolean;
  libraryEntry?: SkillLibraryEntry;
  mounts: SkillMountRelation[];
}

export interface SkillVersionCheckEntry {
  slug: string;
  currentVersion: string;
  latestVersion?: string;
  status: SkillVersionCheckStatus;
  error?: string;
}

export interface AgentSkillTargetEntry {
  providerId: string;
  displayName: string;
  kind: "built_in" | "preset" | "custom";
  skillDir?: string;
  mountPreference: "auto";
  lastHealthState: SkillTargetHealthState;
  lastHealthError?: string;
}

export interface SkillMountRelation {
  providerId: string;
  skillSlug: string;
  enabled: boolean;
  sourcePath: string;
  targetPath: string;
  mountModeResolved: "symlink" | "copy";
  status: SkillMountStatus;
  lastSyncedAt?: number;
  lastError?: string;
}

export interface SkillInstallStepSnapshot {
  id: string;
  titleKey: string;
  kind: "prepare" | "download" | "extract" | "verify";
  status: "pending" | "running" | "succeeded" | "failed";
  detail?: string;
  startedAt?: number;
  finishedAt?: number;
}

export interface SkillInstallFailure {
  code:
    | "cli_unavailable"
    | "search_parse_failed"
    | "install_failed"
    | "sync_failed"
    | "invalid_skill_payload"
    | "write_failed"
    | "unknown_failure";
  slug: string;
  failedStepId: string;
  message: string;
  detail?: string;
}

export interface SkillInstallJobSnapshot {
  jobId: string;
  slug: string;
  version?: string;
  status: "queued" | "running" | "succeeded" | "failed";
  currentStepId?: string;
  steps: SkillInstallStepSnapshot[];
  failure?: SkillInstallFailure;
}

export interface SkillsHealthScanResult {
  targets: Array<AgentSkillTargetEntry & { mountedSkillCount: number }>;
  mounts: SkillMountRelation[];
}

import type {
  SkillInfoItem,
  SkillInstallJobSnapshot,
  SkillLibraryEntry,
  SkillLibraryListItem,
  SkillMountRelation,
  SkillSearchResultItem,
  SkillsHealthScanResult,
  SkillVersionCheckEntry,
} from "../domain/skill-management.js";
import type {
  LocalSkillImportInput,
  SkillCatalogHost,
  SkillContentHost,
  SkillEventPublisher,
  SkillHealthHost,
  SkillInstallJobsHost,
  SkillMountHost,
  SkillTargetProvider,
} from "../ports/hosts.js";
import type {
  SkillLibraryRepositoryPort,
  SkillMountRepositoryPort,
} from "../ports/repositories.js";

export interface SkillManagerDependencies {
  library: SkillLibraryRepositoryPort;
  mounts: SkillMountRepositoryPort;
  catalog?: SkillCatalogHost;
  installJobs?: SkillInstallJobsHost;
  mountHost?: SkillMountHost;
  healthHost?: SkillHealthHost;
  targetProvider?: SkillTargetProvider;
  contentHost?: SkillContentHost;
  events?: SkillEventPublisher;
  now?: () => number;
  hostLabel?: string;
}

export class SkillManager {
  constructor(private readonly deps: SkillManagerDependencies) {}

  listSkills(): SkillLibraryListItem[] {
    return this.deps.library.list().map((entry) => {
      const mounts = this.deps.mounts.listBySkillSlug(entry.slug).filter((item) => item.enabled);
      const errors = mounts.filter((item) => item.status === "failed" || item.status === "stale");

      return {
        ...entry,
        mountedProviderIds: mounts.map((item) => item.providerId),
        mountStatus:
          errors.length > 0
            ? "error"
            : mounts.length === 0
              ? "unmounted"
              : mounts.length === 1
                ? "partially_mounted"
                : "fully_mounted",
        errorCount: errors.length,
      };
    });
  }

  async searchSkills(query: string): Promise<SkillSearchResultItem[]> {
    const catalog = this.requireCatalog();
    const remote = await catalog.search(query.trim());
    return remote.map((item) => {
      const installed = this.deps.library.get(item.slug);
      const mounts = this.deps.mounts.listBySkillSlug(item.slug).filter((entry) => entry.enabled);

      return {
        slug: item.slug,
        displayName: item.displayName ?? item.name ?? item.slug,
        description: item.description,
        version: item.version,
        installed: Boolean(installed),
        installedVersion: installed?.version,
        mountedProviderIds: mounts.map((entry) => entry.providerId),
      };
    });
  }

  async getSkillInfo(slug: string): Promise<SkillInfoItem> {
    const catalog = this.requireCatalog();
    const libraryEntry = this.deps.library.get(slug);
    const remote = await catalog.info(slug).catch(() => undefined);

    return {
      slug,
      displayName: remote?.name ?? remote?.displayName ?? libraryEntry?.displayName ?? slug,
      description: remote?.description ?? libraryEntry?.description,
      version: remote?.version ?? libraryEntry?.version,
      installed: Boolean(libraryEntry),
      libraryEntry,
      mounts: this.deps.mounts.listBySkillSlug(slug),
    };
  }

  async checkVersions(): Promise<SkillVersionCheckEntry[]> {
    const catalog = this.requireCatalog();
    const entries = this.deps.library
      .list()
      .filter(
        (entry) =>
          entry.source === "installed" &&
          entry.origin === "skillhub" &&
          entry.installState === "installed"
      );

    return Promise.all(entries.map((entry) => checkVersion(entry, catalog)));
  }

  async startInstall(slug: string): Promise<SkillInstallJobSnapshot> {
    const installJobs = this.requireInstallJobs();
    const existing = this.deps.library.get(slug);
    if (!canInstallFromSkillHub(existing)) {
      throw {
        code: "skill_slug_conflict",
        message: `A skill with slug ${slug} already exists`,
      };
    }
    return installJobs.start(slug);
  }

  async startUpdate(slug: string): Promise<SkillInstallJobSnapshot> {
    const installJobs = this.requireInstallJobs();
    const entry = this.deps.library.get(slug);
    if (
      !entry ||
      entry.source !== "installed" ||
      entry.origin !== "skillhub" ||
      entry.installState !== "installed"
    ) {
      throw {
        code: "skill_update_unavailable",
        message: `Only installed Skill Hub skills can be updated: ${slug}`,
      };
    }
    return installJobs.start(slug);
  }

  getInstallJob(jobId: string): SkillInstallJobSnapshot {
    const job = this.requireInstallJobs().get(jobId);
    if (!job) {
      throw {
        code: "skill_install_job_not_found",
        message: `Install job not found: ${jobId}`,
      };
    }
    return job;
  }

  async importLocal(input: LocalSkillImportInput): Promise<SkillLibraryEntry> {
    if (this.deps.library.get(input.slug)) {
      throw {
        code: "skill_slug_conflict",
        message: `A skill with slug ${input.slug} already exists`,
      };
    }
    if (!this.deps.contentHost?.importLocal) {
      throw { code: "skill_import_unavailable", message: "Local skill import is not configured" };
    }

    const imported = await this.deps.contentHost.importLocal(input);
    const now = this.deps.now?.() ?? Date.now();
    const entry = this.deps.library.set({
      slug: input.slug,
      displayName: input.displayName,
      description: input.description,
      version: input.version ?? "local",
      source: "installed",
      origin: "filesystem",
      libraryPath: imported.libraryPath,
      installState: "installed",
      installedAt: now,
      updatedAt: now,
    });
    this.deps.events?.publish({ reason: "imported", slug: entry.slug });
    return entry;
  }

  async sync(input: {
    providerId: string;
    skillSlug: string;
    enabled?: boolean;
  }): Promise<SkillMountRelation> {
    const mountHost = this.requireMountHost();
    const healthHost = this.requireHealthHost();
    const relation = await mountHost.mount({
      providerId: input.providerId,
      skillSlug: input.skillSlug,
      enabled: input.enabled ?? true,
    });
    const scanned = await healthHost.scanMount(relation);
    this.deps.mounts.upsert(scanned);
    this.deps.events?.publish({
      reason: "mounted",
      providerId: input.providerId,
      skillSlug: input.skillSlug,
    });
    return scanned;
  }

  async unsync(providerId: string, skillSlug: string): Promise<void> {
    await this.requireMountHost().unmount(providerId, skillSlug);
    this.deps.mounts.delete(providerId, skillSlug);
    this.deps.events?.publish({ reason: "unmounted", providerId, skillSlug });
  }

  async remove(slug: string, force = false): Promise<{ deleted: true; slug: string }> {
    const mountHost = this.requireMountHost();
    const libraryEntry = this.deps.library.get(slug);

    if (libraryEntry?.source === "builtin") {
      throw {
        code: "skill_uninstall_unavailable",
        message: `Built-in skills cannot be uninstalled: ${slug}`,
      };
    }
    if (
      libraryEntry?.source === "installed" &&
      libraryEntry.origin === "filesystem" &&
      !(await this.deps.contentHost?.canRemove?.(libraryEntry))
    ) {
      throw {
        code: "skill_uninstall_unavailable",
        message: `Filesystem-installed skills cannot be uninstalled by ${this.deps.hostLabel ?? "the host"}: ${slug}`,
      };
    }
    if (libraryEntry?.source === "custom" && !force) {
      throw {
        code: "skill_uninstall_confirmation_required",
        message: `Custom skill deletion requires confirmation: ${slug}`,
      };
    }

    const mounts = this.deps.mounts.listBySkillSlug(slug);
    const enabledMounts = mounts.filter((entry) => entry.enabled);
    if (enabledMounts.length > 0 && !force) {
      throw {
        code: "skill_uninstall_blocked",
        message: `Skill still mounted: ${slug}`,
        details: enabledMounts.map((entry) => entry.providerId),
      };
    }

    if (force) {
      for (const mount of mounts) {
        await mountHost.unmount(mount.providerId, mount.skillSlug).catch(() => undefined);
      }
    }

    this.deps.mounts.deleteBySkillSlug(slug);
    this.deps.library.delete(slug);
    if (libraryEntry) {
      await this.deps.contentHost?.remove?.(libraryEntry);
    }
    this.deps.events?.publish({ reason: "uninstalled", slug });
    return { deleted: true, slug };
  }

  async repair(providerId: string, skillSlug: string): Promise<SkillMountRelation> {
    const existing = this.deps.mounts.get(providerId, skillSlug);
    if (!existing) {
      throw {
        code: "skill_mount_not_found",
        message: `Mount not found for ${providerId}:${skillSlug}`,
      };
    }

    const relation = await this.requireMountHost().mount({
      providerId,
      skillSlug,
      enabled: existing.enabled,
    });
    const scanned = await this.requireHealthHost().scanMount(relation);
    this.deps.mounts.upsert(scanned);
    this.deps.events?.publish({ reason: "repaired", providerId, skillSlug });
    return scanned;
  }

  async listTargets() {
    return this.requireTargetProvider().listTargets(this.deps.mounts.countsByProviderId());
  }

  async scan(): Promise<SkillsHealthScanResult> {
    const healthHost = this.requireHealthHost();
    const discovered = await healthHost.discoverMounts(this.deps.mounts.list());
    for (const relation of discovered) {
      this.deps.mounts.upsert(relation);
    }

    const scanned = await Promise.all(
      this.deps.mounts.list().map((relation) => healthHost.scanMount(relation))
    );
    for (const relation of scanned) {
      this.deps.mounts.upsert(relation);
    }

    return { targets: await this.listTargets(), mounts: scanned };
  }

  private requireCatalog(): SkillCatalogHost {
    if (!this.deps.catalog) {
      throw { code: "skills_unavailable", message: "Skill catalog is not configured" };
    }
    return this.deps.catalog;
  }

  private requireInstallJobs(): SkillInstallJobsHost {
    if (!this.deps.installJobs) {
      throw {
        code: "skill_install_unavailable",
        message: "Skill install manager is not configured",
      };
    }
    return this.deps.installJobs;
  }

  private requireMountHost(): SkillMountHost {
    if (!this.deps.mountHost) {
      throw { code: "skill_mount_unavailable", message: "Skill mount manager is not configured" };
    }
    return this.deps.mountHost;
  }

  private requireHealthHost(): SkillHealthHost {
    if (!this.deps.healthHost) {
      throw {
        code: "skill_health_unavailable",
        message: "Skill health manager is not configured",
      };
    }
    return this.deps.healthHost;
  }

  private requireTargetProvider(): SkillTargetProvider {
    if (!this.deps.targetProvider) {
      throw { code: "skill_targets_unavailable", message: "Skill targets are not configured" };
    }
    return this.deps.targetProvider;
  }
}

function canInstallFromSkillHub(entry: SkillLibraryEntry | undefined): boolean {
  return !entry || (entry.source === "installed" && entry.origin === "skillhub");
}

function parseVersionParts(version: string): number[] {
  return version
    .trim()
    .replace(/^v(?=\d)/i, "")
    .split(".")
    .map((segment) => {
      const match = segment.match(/^(\d+)/);
      return match ? Number.parseInt(match[1]!, 10) : 0;
    });
}

export function compareSkillVersions(left: string, right: string): number {
  const leftParts = parseVersionParts(left);
  const rightParts = parseVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }
  return 0;
}

async function checkVersion(
  entry: SkillLibraryEntry,
  catalog: SkillCatalogHost
): Promise<SkillVersionCheckEntry> {
  try {
    const remote = await catalog.info(entry.slug);
    const latestVersion = remote.version?.trim();
    if (!latestVersion) {
      return { slug: entry.slug, currentVersion: entry.version, status: "unknown" };
    }
    return {
      slug: entry.slug,
      currentVersion: entry.version,
      latestVersion,
      status:
        compareSkillVersions(latestVersion, entry.version) > 0 ? "update_available" : "up_to_date",
    };
  } catch (error) {
    return {
      slug: entry.slug,
      currentVersion: entry.version,
      status: "error",
      error: error instanceof Error ? error.message : "Version check failed",
    };
  }
}

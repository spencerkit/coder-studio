import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readdir, readlink, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import type {
  SkillInstallFailure,
  SkillInstallJobSnapshot,
  SkillInstallStepSnapshot,
  SkillLibraryEntry,
} from "@coder-studio/core";
import type { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { SkillMountManager } from "./mount-manager.js";
import type { SkillsHubClient } from "./skills-hub-client.js";

interface SkillInstallManagerDeps {
  skillsHubClient: SkillsHubClient;
  skillLibraryRepo: SkillLibraryRepo;
  libraryRoot: string;
  skillMountMgr?: SkillMountManager;
  getInstalledSkillTargetProviderIds?: () => Promise<string[]>;
}

interface InstallRecord {
  tempHome?: string;
}

interface SkillInfoLike {
  name?: string;
  description?: string;
  version?: string;
}

function canOverwriteWithSkillHubInstall(existing: SkillLibraryEntry | undefined): boolean {
  return !existing || (existing.source === "installed" && existing.origin === "skillhub");
}

export class SkillInstallManager {
  private readonly jobs = new Map<string, SkillInstallJobSnapshot>();
  private readonly activeJobIdsBySlug = new Map<string, string>();
  private readonly inFlightStartsBySlug = new Map<string, Promise<SkillInstallJobSnapshot>>();
  private readonly installs = new Map<string, InstallRecord>();

  constructor(private readonly deps: SkillInstallManagerDeps) {}

  async start(slug: string): Promise<SkillInstallJobSnapshot> {
    const active = this.getActiveJob(slug);
    if (active) {
      return cloneJobSnapshot(active);
    }

    const inFlight = this.inFlightStartsBySlug.get(slug);
    if (inFlight) {
      return cloneJobSnapshot(await inFlight);
    }

    const promise = this.prepareAndRun(slug);
    this.inFlightStartsBySlug.set(slug, promise);

    try {
      return cloneJobSnapshot(await promise);
    } finally {
      if (this.inFlightStartsBySlug.get(slug) === promise) {
        this.inFlightStartsBySlug.delete(slug);
      }
    }
  }

  get(jobId: string): SkillInstallJobSnapshot | undefined {
    const job = this.jobs.get(jobId);
    return job ? cloneJobSnapshot(job) : undefined;
  }

  private async prepareAndRun(slug: string): Promise<SkillInstallJobSnapshot> {
    const job = this.createJob(slug);
    this.jobs.set(job.jobId, job);
    this.activeJobIdsBySlug.set(slug, job.jobId);

    queueMicrotask(() => {
      void this.run(job);
    });

    return job;
  }

  private async run(job: SkillInstallJobSnapshot): Promise<void> {
    const record = this.installs.get(job.jobId);
    if (!record) {
      return;
    }

    try {
      job.status = "running";
      markStep(job, "stage-install", "running");
      this.jobs.set(job.jobId, job);

      const existing = this.deps.skillLibraryRepo.get(job.slug);
      if (!canOverwriteWithSkillHubInstall(existing)) {
        throw new Error(`A skill with slug ${job.slug} already exists`);
      }

      const info = (await this.deps.skillsHubClient.info(job.slug).catch(() => undefined)) as
        | SkillInfoLike
        | undefined;
      const staged = await this.deps.skillsHubClient.stageInstall(job.slug);
      record.tempHome = staged.tempHome;

      job.version = info?.version;
      markStep(job, "stage-install", "succeeded");
      job.currentStepId = "write-library";
      markStep(job, "write-library", "running");
      await this.writeLibraryEntry(job.slug, staged.exportDir, info);
      markStep(job, "write-library", "succeeded");

      job.currentStepId = "mount-targets";
      markStep(job, "mount-targets", "running");
      await this.mountInstalledAgentTargets(job.slug);
      markStep(job, "mount-targets", "succeeded");

      job.status = "succeeded";
      job.currentStepId = undefined;
      this.jobs.set(job.jobId, job);
      this.activeJobIdsBySlug.delete(job.slug);
    } catch (error) {
      if (job.currentStepId) {
        markStep(job, job.currentStepId, "failed");
      }
      job.status = "failed";
      job.failure = buildFailure(job.slug, job.currentStepId ?? "stage-install", error);
      this.jobs.set(job.jobId, job);
      this.activeJobIdsBySlug.delete(job.slug);
    } finally {
      const tempHome = this.installs.get(job.jobId)?.tempHome;
      if (tempHome) {
        await this.deps.skillsHubClient.cleanupStage(tempHome).catch(() => undefined);
      }
      this.installs.delete(job.jobId);
    }
  }

  private async writeLibraryEntry(
    slug: string,
    exportDir: string,
    info?: SkillInfoLike
  ): Promise<void> {
    await this.deps.skillsHubClient.readStagedSkill(exportDir, slug);
    const libraryPath = join(this.deps.libraryRoot, slug);
    const stagedSkillPath = join(exportDir, slug);
    await rm(libraryPath, { recursive: true, force: true });
    await copyDirectory(stagedSkillPath, libraryPath);

    const existing = this.deps.skillLibraryRepo.get(slug);
    const now = Date.now();
    const entry: SkillLibraryEntry = {
      slug,
      displayName: info?.name?.trim() || slug,
      description: info?.description?.trim() || undefined,
      version: info?.version?.trim() || "1",
      source: "installed",
      origin: "skillhub",
      libraryPath,
      installState: "installed",
      installedAt: existing?.installedAt ?? now,
      updatedAt: now,
    };

    this.deps.skillLibraryRepo.set(entry);
  }

  private createJob(slug: string): SkillInstallJobSnapshot {
    const jobId = randomUUID();
    const steps: SkillInstallStepSnapshot[] = [
      {
        id: "stage-install",
        titleKey: "skills.install.step.stage",
        kind: "prepare",
        status: "pending",
      },
      {
        id: "write-library",
        titleKey: "skills.install.step.write",
        kind: "extract",
        status: "pending",
      },
      {
        id: "mount-targets",
        titleKey: "skills.install.step.mount",
        kind: "verify",
        status: "pending",
      },
    ];

    const job: SkillInstallJobSnapshot = {
      jobId,
      slug,
      status: "queued",
      currentStepId: steps[0]?.id,
      steps,
    };

    this.installs.set(jobId, {});
    return job;
  }

  private getActiveJob(slug: string): SkillInstallJobSnapshot | undefined {
    const jobId = this.activeJobIdsBySlug.get(slug);
    if (!jobId) {
      return undefined;
    }

    const job = this.jobs.get(jobId);
    if (!job) {
      this.activeJobIdsBySlug.delete(slug);
      return undefined;
    }

    if (job.status === "queued" || job.status === "running") {
      return job;
    }

    this.activeJobIdsBySlug.delete(slug);
    return undefined;
  }

  private async mountInstalledAgentTargets(slug: string): Promise<void> {
    if (!this.deps.skillMountMgr || !this.deps.getInstalledSkillTargetProviderIds) {
      return;
    }

    const targets = new Set(
      this.deps.skillMountMgr.listTargets().map((target) => target.providerId)
    );
    const installedProviderIds = await this.deps.getInstalledSkillTargetProviderIds();

    for (const providerId of installedProviderIds) {
      if (!targets.has(providerId)) {
        continue;
      }

      await this.deps.skillMountMgr.mount({
        providerId,
        skillSlug: slug,
        enabled: true,
      });
    }
  }
}

function buildFailure(slug: string, failedStepId: string, error: unknown): SkillInstallFailure {
  const message = error instanceof Error ? error.message : "Unknown install failure";
  return {
    code: "unknown_failure",
    slug,
    failedStepId,
    message,
    detail: typeof error === "string" ? error : undefined,
  };
}

function cloneJobSnapshot(job: SkillInstallJobSnapshot): SkillInstallJobSnapshot {
  return {
    ...job,
    steps: job.steps.map((step) => ({ ...step })),
    failure: job.failure ? { ...job.failure } : undefined,
  };
}

function markStep(
  job: SkillInstallJobSnapshot,
  stepId: string,
  status: SkillInstallStepSnapshot["status"]
): void {
  const step = job.steps.find((item) => item.id === stepId);
  if (!step) {
    return;
  }

  step.status = status;
  if (status === "running" && !step.startedAt) {
    step.startedAt = Date.now();
  }
  if ((status === "succeeded" || status === "failed") && !step.finishedAt) {
    step.finishedAt = Date.now();
  }
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, targetPath);
      continue;
    }

    if (entry.isSymbolicLink()) {
      const linkTarget = await readlink(sourcePath);
      await symlink(linkTarget, targetPath);
      continue;
    }

    await copyFile(sourcePath, targetPath);
  }
}

import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { SkillInstallManager } from "../../skills/install-manager.js";
import { SkillMountManager } from "../../skills/mount-manager.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";

function provider(id: string, skillDir?: string): ProviderDefinition {
  return {
    id,
    displayName: id,
    badge: id,
    kind: "built_in",
    supportsSkillsMount: true,
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: [id], env: {}, cwd: "/tmp" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: [id],
    skillMountDirectories: skillDir ? [skillDir] : undefined,
  };
}

async function waitForJob(
  manager: SkillInstallManager,
  jobId: string
): Promise<ReturnType<SkillInstallManager["get"]>> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const job = manager.get(jobId);
    if (job?.status === "succeeded" || job?.status === "failed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return manager.get(jobId);
}

describe("SkillInstallManager", () => {
  it("auto-mounts installed skills.sh skills into installed agent skill targets", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-install-auto-mount-"));
    try {
      const libraryRoot = join(tempDir, "library");
      const exportDir = join(tempDir, "export");
      const stagedSkillPath = join(exportDir, "code-review");
      const codexSkillDir = join(tempDir, "codex-skills");
      const uninstalledSkillDir = join(tempDir, "uninstalled-skills");
      await mkdir(stagedSkillPath, { recursive: true });
      await writeFile(join(stagedSkillPath, "SKILL.md"), "---\nversion: 1.2.3\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      const providers = [
        provider("codex", codexSkillDir),
        provider("uninstalled-agent", uninstalledSkillDir),
        provider("unconfigured-agent"),
      ];
      const skillMountMgr = new SkillMountManager({
        getProviderRegistry: () => providers,
        skillLibraryRepo,
        skillMountRepo,
      });
      const manager = new SkillInstallManager({
        skillsHubClient: {
          info: vi.fn(async () => ({
            slug: "code-review",
            name: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
          })),
          stageInstall: vi.fn(async () => ({
            tempHome: join(tempDir, "home"),
            exportDir,
            info: {
              slug: "code-review",
              registryRef: "mattpocock/skills@code-review",
              name: "Code Review",
              description: "Review code changes before merge",
              version: "1.2.3",
            },
          })),
          readStagedSkill: vi.fn(async () => "skill body"),
          cleanupStage: vi.fn(async () => undefined),
        } as never,
        skillLibraryRepo,
        libraryRoot,
        skillMountMgr,
        getInstalledSkillTargetProviderIds: async () => ["codex"],
      });

      const started = await manager.start("code-review");
      const finished = await waitForJob(manager, started.jobId);

      expect(finished?.status).toBe("succeeded");
      expect(finished?.steps.map((step) => step.id)).toEqual([
        "stage-install",
        "write-library",
        "mount-targets",
      ]);
      expect(skillMountRepo.get("codex", "code-review")).toMatchObject({
        providerId: "codex",
        skillSlug: "code-review",
        enabled: true,
        status: "mounted",
      });
      await expect(lstat(join(codexSkillDir, "code-review"))).resolves.toBeTruthy();
      await expect(lstat(join(uninstalledSkillDir, "code-review"))).rejects.toBeTruthy();
      expect(skillMountRepo.get("uninstalled-agent", "code-review")).toBeUndefined();
      expect(skillMountRepo.get("unconfigured-agent", "code-review")).toBeUndefined();
      expect(skillLibraryRepo.get("code-review")).toEqual(
        expect.objectContaining({
          slug: "code-review",
          source: "installed",
          origin: "skills-sh",
          registryRef: "mattpocock/skills@code-review",
        })
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects Skill Hub installs when a custom skill already owns the slug", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-install-conflict-custom-"));
    try {
      const libraryRoot = join(tempDir, "library");
      const customSkillPath = join(tempDir, "state", "skills", "custom", "code-review");
      await mkdir(customSkillPath, { recursive: true });
      await writeFile(join(customSkillPath, "SKILL.md"), "# Custom Code Review\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
        customSkillRoot: join(tempDir, "state", "skills", "custom"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Custom version",
        version: "local",
        source: "custom",
        origin: "filesystem",
        libraryPath: customSkillPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 1,
      });

      const manager = new SkillInstallManager({
        skillsHubClient: {
          info: vi.fn(async () => ({
            slug: "code-review",
            name: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
          })),
          stageInstall: vi.fn(async () => {
            throw new Error("stageInstall should not run");
          }),
          readStagedSkill: vi.fn(async () => "skill body"),
          cleanupStage: vi.fn(async () => undefined),
        } as never,
        skillLibraryRepo,
        libraryRoot,
      });

      const started = await manager.start("code-review");
      const finished = await waitForJob(manager, started.jobId);

      expect(finished?.status).toBe("failed");
      expect(finished?.failure).toMatchObject({
        code: "unknown_failure",
        message: "A skill with slug code-review already exists",
      });
      expect(skillLibraryRepo.get("code-review")).toEqual(
        expect.objectContaining({
          source: "custom",
          origin: "filesystem",
          libraryPath: customSkillPath,
        })
      );
      await expect(lstat(customSkillPath)).resolves.toBeTruthy();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

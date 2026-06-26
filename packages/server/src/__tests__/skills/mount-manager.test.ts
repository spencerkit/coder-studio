import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CODER_STUDIO_SKILL_MARKER } from "../../skills/managed-skill-metadata.js";
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

describe("SkillMountManager", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("preserves the managed marker when symlink mount falls back to copy", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-mount-manager-"));
    tempDirs.push(tempDir);
    const libraryPath = join(tempDir, "state", "skills", "custom", "my-review-skill");
    const skillDir = join(tempDir, ".agents", "skills");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), "# My Review Skill\n", "utf8");
    await writeFile(
      join(libraryPath, CODER_STUDIO_SKILL_MARKER),
      JSON.stringify({
        version: 1,
        managedBy: "coder-studio",
        source: "custom",
        slug: "my-review-skill",
      }),
      "utf8"
    );

    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const skillMountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    skillLibraryRepo.set({
      slug: "my-review-skill",
      displayName: "My Review Skill",
      version: "local",
      source: "custom",
      origin: "filesystem",
      libraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });

    vi.resetModules();
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        symlink: vi.fn(async () => {
          throw Object.assign(new Error("symlink not permitted"), { code: "EPERM" });
        }),
      };
    });

    const { SkillMountManager } = await import("../../skills/mount-manager.js");

    const manager = new SkillMountManager({
      getProviderRegistry: () => [provider("codex", skillDir)],
      skillLibraryRepo,
      skillMountRepo,
    });

    const relation = await manager.mount({
      providerId: "codex",
      skillSlug: "my-review-skill",
      enabled: true,
    });

    expect(relation.mountModeResolved).toBe("copy");
    await expect(
      lstat(join(skillDir, "my-review-skill", CODER_STUDIO_SKILL_MARKER))
    ).resolves.toBeTruthy();
    expect(
      JSON.parse(
        await readFile(join(skillDir, "my-review-skill", CODER_STUDIO_SKILL_MARKER), "utf8")
      )
    ).toMatchObject({
      managedBy: "coder-studio",
      source: "custom",
      slug: "my-review-skill",
    });
  });

  it("can force copy mode and apply mounted overrides", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-mount-manager-"));
    tempDirs.push(tempDir);
    const libraryPath = join(tempDir, "state", "skills", "custom", "automation-skill");
    const skillDir = join(tempDir, ".agents", "skills");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), "# Placeholder\noriginal\n", "utf8");
    await writeFile(join(libraryPath, "notes.txt"), "library copy\n", "utf8");

    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const skillMountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    skillLibraryRepo.set({
      slug: "automation-skill",
      displayName: "Automation Skill",
      version: "local",
      source: "custom",
      origin: "filesystem",
      libraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });

    const { SkillMountManager } = await import("../../skills/mount-manager.js");

    const manager = new SkillMountManager({
      getProviderRegistry: () => [provider("codex", skillDir)],
      skillLibraryRepo,
      skillMountRepo,
    });

    const relation = await manager.mount({
      providerId: "codex",
      skillSlug: "automation-skill",
      enabled: true,
      preferredMode: "copy",
      mountedOverrides: [
        {
          relativePath: "SKILL.md",
          content: "# Rewritten\nmounted\n",
        },
      ],
    });

    expect(relation.mountModeResolved).toBe("copy");
    expect((await lstat(join(skillDir, "automation-skill"))).isSymbolicLink()).toBe(false);
    await expect(readFile(join(skillDir, "automation-skill", "notes.txt"), "utf8")).resolves.toBe(
      "library copy\n"
    );
    await expect(readFile(join(skillDir, "automation-skill", "SKILL.md"), "utf8")).resolves.toBe(
      "# Rewritten\nmounted\n"
    );
  });

  it("treats mounted overrides as copy-only behavior", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-mount-manager-"));
    tempDirs.push(tempDir);
    const libraryPath = join(tempDir, "state", "skills", "custom", "override-skill");
    const skillDir = join(tempDir, ".agents", "skills");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), "# Source\noriginal\n", "utf8");

    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const skillMountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    skillLibraryRepo.set({
      slug: "override-skill",
      displayName: "Override Skill",
      version: "local",
      source: "custom",
      origin: "filesystem",
      libraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });

    vi.resetModules();
    const symlinkMock = vi.fn(async () => undefined);
    vi.doMock("node:fs/promises", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs/promises")>();
      return {
        ...actual,
        symlink: symlinkMock,
      };
    });

    const { SkillMountManager } = await import("../../skills/mount-manager.js");

    const manager = new SkillMountManager({
      getProviderRegistry: () => [provider("codex", skillDir)],
      skillLibraryRepo,
      skillMountRepo,
    });

    const relation = await manager.mount({
      providerId: "codex",
      skillSlug: "override-skill",
      enabled: true,
      mountedOverrides: [
        {
          relativePath: "SKILL.md",
          content: "# Mounted\nrewritten\n",
        },
      ],
    });

    expect(relation.mountModeResolved).toBe("copy");
    expect(symlinkMock).not.toHaveBeenCalled();
    expect((await lstat(join(skillDir, "override-skill"))).isSymbolicLink()).toBe(false);
    await expect(readFile(join(skillDir, "override-skill", "SKILL.md"), "utf8")).resolves.toBe(
      "# Mounted\nrewritten\n"
    );
    await expect(readFile(join(libraryPath, "SKILL.md"), "utf8")).resolves.toBe(
      "# Source\noriginal\n"
    );
  });

  it("replaces copied symlinked override files before writing mounted overrides", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-mount-manager-"));
    tempDirs.push(tempDir);
    const libraryPath = join(tempDir, "state", "skills", "custom", "symlinked-override-skill");
    const skillDir = join(tempDir, ".agents", "skills");
    const sharedPath = join(tempDir, "shared-skill-template.md");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(sharedPath, "# Shared\nsource\n", "utf8");
    await symlink(sharedPath, join(libraryPath, "SKILL.md"));

    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const skillMountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    skillLibraryRepo.set({
      slug: "symlinked-override-skill",
      displayName: "Symlinked Override Skill",
      version: "local",
      source: "custom",
      origin: "filesystem",
      libraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });

    vi.resetModules();
    vi.doUnmock("node:fs/promises");
    const { SkillMountManager } = await import("../../skills/mount-manager.js");

    const manager = new SkillMountManager({
      getProviderRegistry: () => [provider("codex", skillDir)],
      skillLibraryRepo,
      skillMountRepo,
    });

    const relation = await manager.mount({
      providerId: "codex",
      skillSlug: "symlinked-override-skill",
      enabled: true,
      mountedOverrides: [
        {
          relativePath: "SKILL.md",
          content: "# Mounted\noverride\n",
        },
      ],
    });

    expect(relation.mountModeResolved).toBe("copy");
    expect(
      (await lstat(join(skillDir, "symlinked-override-skill", "SKILL.md"))).isSymbolicLink()
    ).toBe(false);
    await expect(
      readFile(join(skillDir, "symlinked-override-skill", "SKILL.md"), "utf8")
    ).resolves.toBe("# Mounted\noverride\n");
    await expect(readFile(sharedPath, "utf8")).resolves.toBe("# Shared\nsource\n");
  });
});

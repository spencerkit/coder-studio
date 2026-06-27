import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
  AUTOMATION_CMD_FILE_NAME,
} from "../../skills/builtin/automation-bridge.js";
import type { BuiltinSkillDefinition } from "../../skills/builtin/registry.js";
import { BUILTIN_SKILLS } from "../../skills/builtin/registry.js";
import { BuiltinSkillSyncManager } from "../../skills/builtin/sync-manager.js";
import { readManagedSkillMarker } from "../../skills/managed-skill-metadata.js";
import { SkillMountManager } from "../../skills/mount-manager.js";
import { SettingsRepo } from "../../storage/repositories/settings-repo.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";

const TEST_BUILTIN_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-example-builtin",
  displayName: "Coder Studio Example Builtin",
  description: "Test fixture for built-in skill sync.",
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: false,
  content: [
    "---",
    "name: coder-studio-example-builtin",
    "description: Test fixture for built-in skill sync.",
    "---",
    "",
    "# Example Builtin",
    "",
  ].join("\n"),
};

const TEST_AUTOMATION_BRIDGE_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-automation-bridge-test",
  displayName: "Coder Studio Automation Bridge Test",
  description: "Test fixture for automation bridge mount rewriting.",
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: true,
  mountRendering: "automation_bridge",
  content: [
    "---",
    "name: coder-studio-automation-bridge-test",
    "description: Automation bridge test fixture.",
    "---",
    "",
    `Run \`node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}"\` to bridge.`,
    "",
  ].join("\n"),
  files: [
    {
      relativePath: AUTOMATION_CMD_FILE_NAME,
      content: 'console.log("bridge");',
    },
  ],
};

function provider(id: string, skillDir?: string): ProviderDefinition {
  return {
    id,
    displayName: id,
    badge: id,
    kind: "built_in",
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

describe("BuiltinSkillSyncManager", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("auto-mounts the default Coder Studio built-in skills", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-default-sync-"));
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(BUILTIN_SKILLS.map((skill) => skill.slug)).toEqual(
      expect.arrayContaining([
        "coder-studio-open",
        "coder-studio-memory",
        "coder-studio-canvas",
        "coder-studio-session-activity",
      ])
    );
    expect(result.libraryEntries.map((entry) => entry.slug)).toEqual(
      expect.arrayContaining([
        "coder-studio-open",
        "coder-studio-memory",
        "coder-studio-canvas",
        "coder-studio-session-activity",
      ])
    );
    expect(result.libraryEntries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          slug: "coder-studio-open",
          source: "builtin",
          origin: "builtin",
        }),
        expect.objectContaining({
          slug: "coder-studio-memory",
          source: "builtin",
          origin: "builtin",
        }),
        expect.objectContaining({
          slug: "coder-studio-canvas",
          source: "builtin",
          origin: "builtin",
        }),
        expect.objectContaining({
          slug: "coder-studio-session-activity",
          source: "builtin",
          origin: "builtin",
        }),
      ])
    );
    expect(result.mounted).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          providerId: "codex",
          skillSlug: "coder-studio-open",
          status: "mounted",
        }),
        expect.objectContaining({
          providerId: "codex",
          skillSlug: "coder-studio-memory",
          status: "mounted",
        }),
        expect.objectContaining({
          providerId: "codex",
          skillSlug: "coder-studio-canvas",
          status: "mounted",
        }),
        expect.objectContaining({
          providerId: "codex",
          skillSlug: "coder-studio-session-activity",
          status: "mounted",
        }),
      ])
    );
    expect(result.mounted).toHaveLength(4);
    expect(result.skipped).toEqual([]);
    expect(readManagedSkillMarker(join(skillDir, "coder-studio-open"))).toEqual({
      version: 1,
      managedBy: "coder-studio",
      source: "builtin",
      slug: "coder-studio-open",
    });
    expect(mountRepo.get("codex", "coder-studio-open")).toEqual(
      expect.objectContaining({
        providerId: "codex",
        skillSlug: "coder-studio-open",
      })
    );
    expect(mountRepo.get("codex", "coder-studio-memory")).toEqual(
      expect.objectContaining({
        providerId: "codex",
        skillSlug: "coder-studio-memory",
      })
    );
    expect(mountRepo.get("codex", "coder-studio-canvas")).toEqual(
      expect.objectContaining({
        providerId: "codex",
        skillSlug: "coder-studio-canvas",
      })
    );
    expect(mountRepo.get("codex", "coder-studio-session-activity")).toEqual(
      expect.objectContaining({
        providerId: "codex",
        skillSlug: "coder-studio-session-activity",
      })
    );
    await expect(lstat(join(skillDir, "coder-studio-open", "SKILL.md"))).resolves.toBeTruthy();
    await expect(lstat(join(skillDir, "coder-studio-memory", "SKILL.md"))).resolves.toBeTruthy();
    await expect(lstat(join(skillDir, "coder-studio-canvas", "SKILL.md"))).resolves.toBeTruthy();
    await expect(
      lstat(join(skillDir, "coder-studio-session-activity", "SKILL.md"))
    ).resolves.toBeTruthy();
  });

  it("syncs provided built-ins into the library without auto-mounting by default", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-sync-"));
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
      skills: [TEST_BUILTIN_SKILL],
    });

    const result = await manager.sync();

    expect(result.libraryEntries.map((entry) => entry.slug)).toEqual([
      "coder-studio-example-builtin",
    ]);
    expect(mountRepo.get("codex", "coder-studio-example-builtin")).toBeUndefined();
    expect(result.mounted).toEqual([]);
    expect(result.skipped).toEqual([
      {
        providerId: "codex",
        skillSlug: "coder-studio-example-builtin",
        reason: "not_mvp_auto",
      },
    ]);
  });

  it("persists disabled mount settings for built-in skills", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-disabled-"));
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    settingsRepo.set("skills.builtin.disabledMounts", {
      "codex:coder-studio-example-builtin": true,
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
      skills: [TEST_BUILTIN_SKILL],
    });

    await manager.sync();

    expect(mountRepo.get("codex", "coder-studio-example-builtin")).toBeUndefined();
    expect(settingsRepo.get("skills.builtin.disabledMounts")).toEqual({
      "codex:coder-studio-example-builtin": true,
    });
  });

  it("mounts automation-rendered builtins in copy mode with rewritten SKILL.md content", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-automation-"));
    const builtinRoot = join(tempDir, "builtin");
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot,
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
      skills: [TEST_AUTOMATION_BRIDGE_SKILL],
    });

    const result = await manager.sync();
    const mountedPath = join(skillDir, TEST_AUTOMATION_BRIDGE_SKILL.slug);
    const mountedSkillPath = join(mountedPath, "SKILL.md");
    const expectedCmdPath = join(mountedPath, AUTOMATION_CMD_FILE_NAME);

    expect(result.mounted).toEqual([
      expect.objectContaining({
        providerId: "codex",
        skillSlug: TEST_AUTOMATION_BRIDGE_SKILL.slug,
        mountModeResolved: "copy",
      }),
    ]);
    expect((await lstat(mountedPath)).isSymbolicLink()).toBe(false);
    await expect(readFile(mountedSkillPath, "utf8")).resolves.toContain(expectedCmdPath);
    await expect(readFile(mountedSkillPath, "utf8")).resolves.not.toContain(
      AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN
    );
    await expect(
      readFile(join(builtinRoot, TEST_AUTOMATION_BRIDGE_SKILL.slug, "SKILL.md"), "utf8")
    ).resolves.toContain(AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN);
  });

  it("removes stale built-in skills without touching other installed skills", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-stale-"));
    const builtinRoot = join(tempDir, "builtin");
    const skillDir = join(tempDir, "codex-skills");
    const staleLibraryPath = join(builtinRoot, "old-builtin-skill");
    const staleTargetPath = join(skillDir, "old-builtin-skill");
    const skillHubLibraryPath = join(tempDir, "skillhub", "frontend-design");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    await mkdir(staleLibraryPath, { recursive: true });
    await writeFile(join(staleLibraryPath, "SKILL.md"), "# Old Builtin\n", "utf8");
    await mkdir(staleTargetPath, { recursive: true });
    await writeFile(join(staleTargetPath, "SKILL.md"), "# Mounted Old Builtin\n", "utf8");
    await mkdir(skillHubLibraryPath, { recursive: true });
    await writeFile(join(skillHubLibraryPath, "SKILL.md"), "# Frontend Design\n", "utf8");

    libraryRepo.set({
      slug: "old-builtin-skill",
      displayName: "Old Builtin Skill",
      description: "No longer registered",
      version: "0.1.0",
      source: "builtin",
      libraryPath: staleLibraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
      builtin: { defaultEnabled: true, autoMount: true },
    });
    libraryRepo.set({
      slug: "frontend-design",
      displayName: "Frontend Design",
      description: "Installed from Skill Hub",
      version: "1.0.0",
      source: "installed",
      origin: "skillhub",
      libraryPath: skillHubLibraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });
    mountRepo.upsert({
      providerId: "codex",
      skillSlug: "old-builtin-skill",
      enabled: true,
      sourcePath: staleLibraryPath,
      targetPath: staleTargetPath,
      mountModeResolved: "copy",
      status: "mounted",
      lastSyncedAt: 1,
    });
    settingsRepo.set("skills.builtin.disabledMounts", {
      "codex:old-builtin-skill": true,
      "codex:unrelated-builtin-skill": true,
    });
    settingsRepo.set("skills.builtin.enabledMounts", {
      "codex:old-builtin-skill": true,
      "codex:unrelated-builtin-skill": true,
    });

    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot,
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(libraryRepo.get("old-builtin-skill")).toBeUndefined();
    expect(libraryRepo.get("frontend-design")).toEqual(
      expect.objectContaining({
        slug: "frontend-design",
        source: "installed",
        origin: "skillhub",
      })
    );
    await expect(lstat(staleLibraryPath)).rejects.toThrow();
    await expect(lstat(staleTargetPath)).rejects.toThrow();
    await expect(lstat(skillHubLibraryPath)).resolves.toBeTruthy();
    expect(mountRepo.get("codex", "old-builtin-skill")).toBeUndefined();
    expect(settingsRepo.get("skills.builtin.disabledMounts")).toEqual({
      "codex:unrelated-builtin-skill": true,
    });
    expect(settingsRepo.get("skills.builtin.enabledMounts")).toEqual({
      "codex:unrelated-builtin-skill": true,
    });
    expect(result.removed).toEqual([
      {
        skillSlug: "old-builtin-skill",
        unmountedProviderIds: ["codex"],
      },
    ]);
  });

  it("removes stale built-in symlink artifacts that were already dropped from the library index", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-stale-local-"));
    const builtinRoot = join(tempDir, "builtin");
    const skillDir = join(tempDir, "agent-skills");
    const staleLibraryPath = join(builtinRoot, "old-builtin-skill");
    const staleTargetPath = join(skillDir, "old-builtin-skill");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
      localSkillRoots: [skillDir],
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    await mkdir(staleLibraryPath, { recursive: true });
    await writeFile(join(staleLibraryPath, "SKILL.md"), "# Old Builtin\n", "utf8");
    await mkdir(skillDir, { recursive: true });
    await symlink(staleLibraryPath, staleTargetPath);

    expect(libraryRepo.get("old-builtin-skill")).toEqual(
      expect.objectContaining({
        slug: "old-builtin-skill",
        source: "installed",
        origin: "filesystem",
      })
    );

    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot,
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(libraryRepo.get("old-builtin-skill")).toBeUndefined();
    await expect(lstat(staleTargetPath)).rejects.toThrow();
    await expect(lstat(staleLibraryPath)).rejects.toThrow();
    expect(result.removed).toEqual([
      {
        skillSlug: "old-builtin-skill",
        unmountedProviderIds: ["codex"],
      },
    ]);
  });

  it("removes local stale built-in symlinks that point at another Coder Studio state directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-stale-external-"));
    const builtinRoot = join(tempDir, "dev", "state", "skills", "builtin");
    const externalBuiltinRoot = join(tempDir, "prod", "state", "skills", "builtin");
    const skillDir = join(tempDir, "agent-skills");
    const providerSkillDir = join(tempDir, "provider-skills");
    const staleLibraryPath = join(externalBuiltinRoot, "old-builtin-skill");
    const sharedTargetPath = join(skillDir, "old-builtin-skill");
    const providerTargetPath = join(providerSkillDir, "old-builtin-skill");
    const providers = [provider("codex", skillDir), provider("claude", providerSkillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
      localSkillRoots: [skillDir],
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    await mkdir(staleLibraryPath, { recursive: true });
    await writeFile(join(staleLibraryPath, "SKILL.md"), "# Old Builtin\n", "utf8");
    await mkdir(skillDir, { recursive: true });
    await mkdir(providerSkillDir, { recursive: true });
    await symlink(staleLibraryPath, sharedTargetPath);
    await symlink(staleLibraryPath, providerTargetPath);

    expect(libraryRepo.get("old-builtin-skill")).toEqual(
      expect.objectContaining({
        slug: "old-builtin-skill",
        source: "installed",
        origin: "filesystem",
      })
    );

    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot,
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(libraryRepo.get("old-builtin-skill")).toBeUndefined();
    await expect(lstat(sharedTargetPath)).rejects.toThrow();
    await expect(lstat(providerTargetPath)).rejects.toThrow();
    await expect(lstat(staleLibraryPath)).resolves.toBeTruthy();
    expect(result.removed).toEqual([
      {
        skillSlug: "old-builtin-skill",
        unmountedProviderIds: ["codex", "claude"],
      },
    ]);
  });

  it("removes copied stale built-in artifacts under a symlinked parent skill directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-stale-symlink-parent-copy-"));
    const builtinRoot = join(tempDir, "dev", "state", "skills", "builtin");
    const externalBuiltinRoot = join(tempDir, "prod", "state", "skills", "builtin");
    const symlinkedSkillDir = join(tempDir, "agent-skills");
    const staleLibraryPath = join(externalBuiltinRoot, "old-builtin-skill");
    const staleTargetPath = join(symlinkedSkillDir, "old-builtin-skill");
    const providers = [provider("codex", symlinkedSkillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
      localSkillRoots: [symlinkedSkillDir],
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    await mkdir(staleLibraryPath, { recursive: true });
    await writeFile(join(staleLibraryPath, "SKILL.md"), "# Old Builtin\n", "utf8");
    await symlink(externalBuiltinRoot, symlinkedSkillDir);

    expect(libraryRepo.get("old-builtin-skill")).toEqual(
      expect.objectContaining({
        slug: "old-builtin-skill",
        source: "installed",
        origin: "filesystem",
      })
    );

    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot,
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(libraryRepo.get("old-builtin-skill")).toBeUndefined();
    await expect(lstat(staleTargetPath)).rejects.toThrow();
    await expect(lstat(staleLibraryPath)).rejects.toThrow();
    expect(result.removed).toEqual([
      {
        skillSlug: "old-builtin-skill",
        unmountedProviderIds: ["codex"],
      },
    ]);
  });

  it("does not remove a real local skill that reuses a stale built-in slug", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-stale-real-local-"));
    const builtinRoot = join(tempDir, "builtin");
    const skillDir = join(tempDir, "agent-skills");
    const staleLibraryPath = join(builtinRoot, "old-builtin-skill");
    const localSkillPath = join(skillDir, "old-builtin-skill");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
      localSkillRoots: [skillDir],
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    await mkdir(staleLibraryPath, { recursive: true });
    await writeFile(join(staleLibraryPath, "SKILL.md"), "# Old Builtin\n", "utf8");
    await mkdir(localSkillPath, { recursive: true });
    await writeFile(join(localSkillPath, "SKILL.md"), "# User Local Skill\n", "utf8");

    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot,
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    await manager.sync();

    expect(libraryRepo.get("old-builtin-skill")).toEqual(
      expect.objectContaining({
        slug: "old-builtin-skill",
        source: "installed",
        origin: "filesystem",
        libraryPath: localSkillPath,
      })
    );
    await expect(lstat(localSkillPath)).resolves.toBeTruthy();
    await expect(lstat(staleLibraryPath)).rejects.toThrow();
  });

  it("mounts and unmounts built-in skills when their mount preference changes", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-toggle-"));
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
      skills: [TEST_BUILTIN_SKILL],
    });

    await manager.sync();
    manager.setMountEnabled("codex", "coder-studio-example-builtin", true);
    await manager.sync();

    expect(mountRepo.get("codex", "coder-studio-example-builtin")).toEqual(
      expect.objectContaining({
        providerId: "codex",
        skillSlug: "coder-studio-example-builtin",
        status: "mounted",
      })
    );
    await expect(lstat(join(skillDir, "coder-studio-example-builtin"))).resolves.toBeTruthy();

    manager.setMountEnabled("codex", "coder-studio-example-builtin", false);
    await manager.sync();

    expect(mountRepo.get("codex", "coder-studio-example-builtin")).toBeUndefined();
    await expect(lstat(join(skillDir, "coder-studio-example-builtin"))).rejects.toThrow();
    expect(settingsRepo.get("skills.builtin.disabledMounts")).toEqual({
      "codex:coder-studio-example-builtin": true,
    });
  });
});

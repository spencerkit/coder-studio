import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { SkillHealthManager } from "../../skills/health-manager.js";
import { SkillMountManager } from "../../skills/mount-manager.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";
import "../../commands/skills.js";

function createBaseContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspaceMgr: {} as never,
    sessionMgr: {} as never,
    terminalMgr: {} as never,
    eventBus: {} as never,
    broadcaster: {} as never,
    settingsRepo: {} as never,
    providerConfigRepo: {} as never,
    providerRegistry: [
      {
        id: "codex",
        displayName: "Codex",
        badge: "Codex",
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
        buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/tmp" }),
        configSchema: { parse: (value: unknown) => value } as never,
        defaultConfig: {},
        requiredCommands: ["codex"],
        skillMountDirectories: ["/Users/test/.agents/skills", "/Users/test/.codex/skills"],
      },
    ] as never,
    fencingMgr: {} as never,
    supervisorMgr: {} as never,
    autoFetch: {} as never,
    activationMgr: { getLease: () => undefined } as never,
    lspMgr: {} as never,
    ...overrides,
  } as CommandContext;
}

describe("skills commands", () => {
  it("returns remote search results decorated with local install state", async () => {
    const ctx = createBaseContext({
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "code-review",
          displayName: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
          source: "skillhub",
          libraryPath: "/library/code-review",
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => [
          {
            providerId: "codex",
            skillSlug: "code-review",
            enabled: true,
            sourcePath: "/library/code-review",
            targetPath: "/codex/code-review",
            mountModeResolved: "symlink",
            status: "mounted",
          },
        ]),
        countsByProviderId: vi.fn(() => ({ codex: 1 })),
      } as never,
      skillsHubClient: {
        search: vi.fn(async () => [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
          },
        ]),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-search-1",
        op: "skills.search",
        args: { query: "review" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        installed: true,
        installedVersion: "1.2.3",
        mountedProviderIds: ["codex"],
      },
    ]);
  });

  it("returns merged remote and local info for a skill", async () => {
    const ctx = createBaseContext({
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "code-review",
          displayName: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
          source: "skillhub",
          libraryPath: "/library/code-review",
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => [
          {
            providerId: "codex",
            skillSlug: "code-review",
            enabled: true,
            sourcePath: "/library/code-review",
            targetPath: "/codex/code-review",
            mountModeResolved: "symlink",
            status: "mounted",
          },
        ]),
      } as never,
      skillsHubClient: {
        info: vi.fn(async () => ({
          slug: "code-review",
          name: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-info-1",
        op: "skills.info",
        args: { slug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      slug: "code-review",
      displayName: "Code Review",
      description: "Review code changes before merge",
      version: "1.2.3",
      installed: true,
      libraryEntry: expect.objectContaining({ slug: "code-review" }),
      mounts: [expect.objectContaining({ providerId: "codex" })],
    });
  });

  it("returns library entries with derived mount state", async () => {
    const ctx = createBaseContext({
      skillLibraryRepo: {
        list: vi.fn(() => [
          {
            slug: "code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
        ]),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => [
          {
            providerId: "codex",
            skillSlug: "code-review",
            enabled: true,
            sourcePath: "/library/code-review",
            targetPath: "/codex/code-review",
            mountModeResolved: "symlink",
            status: "mounted",
          },
        ]),
      } as never,
      skillsHubClient: {} as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-library-list-1",
        op: "skills.library.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        slug: "code-review",
        mountedProviderIds: ["codex"],
        mountStatus: "partially_mounted",
        errorCount: 0,
      }),
    ]);
  });

  it("returns builtin library metadata", async () => {
    const ctx = createBaseContext({
      skillLibraryRepo: {
        list: vi.fn(() => [
          {
            slug: "coder-studio-automation",
            displayName: "Coder Studio Automation",
            description: "Teach agents",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-automation",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            builtin: { defaultEnabled: true, autoMount: true },
          },
        ]),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
      skillsHubClient: {} as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-library-builtin-1",
        op: "skills.library.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        slug: "coder-studio-automation",
        source: "builtin",
        builtin: { defaultEnabled: true, autoMount: true },
      }),
    ]);
  });

  it("syncs builtin skills through command dispatch", async () => {
    const sync = vi.fn(async () => ({
      libraryEntries: [],
      mounted: [],
      skipped: [],
    }));
    const ctx = createBaseContext({
      builtinSkillSyncMgr: { sync } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-builtin-sync-1",
        op: "skills.builtin.sync",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("persists builtin mount disablement through command dispatch", async () => {
    const setMountEnabled = vi.fn();
    const sync = vi.fn(async () => ({
      libraryEntries: [],
      mounted: [],
      skipped: [],
    }));
    const ctx = createBaseContext({
      builtinSkillSyncMgr: { setMountEnabled, sync } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-builtin-set-enabled-1",
        op: "skills.builtin.setMountEnabled",
        args: {
          providerId: "codex",
          skillSlug: "coder-studio-review",
          enabled: false,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(setMountEnabled).toHaveBeenCalledWith("codex", "coder-studio-review", false);
    expect(sync).toHaveBeenCalledTimes(1);
  });

  it("starts and fetches install jobs", async () => {
    const start = vi.fn(async () => ({
      jobId: "job-1",
      slug: "code-review",
      status: "queued",
      steps: [],
    }));
    const get = vi.fn(() => ({
      jobId: "job-1",
      slug: "code-review",
      status: "running",
      steps: [],
    }));
    const ctx = createBaseContext({
      skillInstallMgr: { start, get } as never,
    });

    const started = await dispatch(
      {
        kind: "command",
        id: "skills-install-start-1",
        op: "skills.install.start",
        args: { slug: "code-review" },
      },
      ctx
    );
    const fetched = await dispatch(
      {
        kind: "command",
        id: "skills-install-get-1",
        op: "skills.install.get",
        args: { jobId: "job-1" },
      },
      ctx
    );

    expect(started.ok).toBe(true);
    expect(fetched.ok).toBe(true);
    expect(start).toHaveBeenCalledWith("code-review");
    expect(get).toHaveBeenCalledWith("job-1");
  });

  it("mounts a skill and persists scanned relation", async () => {
    const mount = vi.fn(async () => ({
      providerId: "codex",
      skillSlug: "code-review",
      enabled: true,
      sourcePath: "/library/code-review",
      targetPath: "/codex/code-review",
      mountModeResolved: "symlink",
      status: "mounted",
    }));
    const scanMount = vi.fn(async (relation) => relation);
    const upsert = vi.fn();
    const ctx = createBaseContext({
      skillMountMgr: { mount } as never,
      skillHealthMgr: { scanMount } as never,
      skillTargetRepo: {} as never,
      skillMountRepo: { upsert } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-mount-1",
        op: "skills.mount",
        args: { providerId: "codex", skillSlug: "code-review", enabled: true },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(mount).toHaveBeenCalledWith({
      providerId: "codex",
      skillSlug: "code-review",
      enabled: true,
    });
    expect(upsert).toHaveBeenCalled();
  });

  it("mounts Codex skills into the shared directory before provider-specific fallbacks", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-codex-mount-target-"));
    try {
      const libraryPath = join(tempDir, "library", "code-review");
      const codexSkillDir = join(tempDir, ".codex", "skills");
      const sharedSkillDir = join(tempDir, ".agents", "skills");
      await mkdir(libraryPath, { recursive: true });
      await writeFile(join(libraryPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        version: "1.0.0",
        source: "skillhub",
        libraryPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      });

      const providers = [
        {
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
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
          buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/tmp" }),
          configSchema: { parse: (value: unknown) => value } as never,
          defaultConfig: {},
          requiredCommands: ["codex"],
          skillMountDirectories: [sharedSkillDir, codexSkillDir],
        },
      ] as CommandContext["providerRegistry"];

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-mount-codex-primary-target-1",
          op: "skills.mount",
          args: { providerId: "codex", skillSlug: "code-review", enabled: true },
        },
        createBaseContext({
          providerRegistry: providers,
          skillLibraryRepo,
          skillMountRepo,
          skillMountMgr: new SkillMountManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
            skillMountRepo,
          }),
          skillHealthMgr: new SkillHealthManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
          }),
        })
      );

      const targetPath = join(sharedSkillDir, "code-review");
      expect(result.ok).toBe(true);
      expect(result.data).toEqual(expect.objectContaining({ targetPath, status: "mounted" }));
      await expect(lstat(targetPath)).resolves.toBeTruthy();
      await expect(lstat(join(codexSkillDir, "code-review"))).rejects.toBeTruthy();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("mounts local shared Codex skills without rewriting their source directory", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-codex-local-shared-mount-"));
    try {
      const sharedSkillDir = join(tempDir, ".agents", "skills");
      const codexSkillDir = join(tempDir, ".codex", "skills");
      const localSkillPath = join(sharedSkillDir, "code-review");
      await mkdir(localSkillPath, { recursive: true });
      await writeFile(join(localSkillPath, "SKILL.md"), "---\nversion: local\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        version: "local",
        source: "local",
        libraryPath: localSkillPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      });

      const providers = [
        {
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
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
          buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/tmp" }),
          configSchema: { parse: (value: unknown) => value } as never,
          defaultConfig: {},
          requiredCommands: ["codex"],
          skillMountDirectories: [sharedSkillDir, codexSkillDir],
        },
      ] as CommandContext["providerRegistry"];

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-mount-codex-local-shared-1",
          op: "skills.mount",
          args: { providerId: "codex", skillSlug: "code-review", enabled: true },
        },
        createBaseContext({
          providerRegistry: providers,
          skillLibraryRepo,
          skillMountRepo,
          skillMountMgr: new SkillMountManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
            skillMountRepo,
          }),
          skillHealthMgr: new SkillHealthManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
          }),
        })
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          sourcePath: localSkillPath,
          targetPath: localSkillPath,
          status: "mounted",
        })
      );
      await expect(lstat(join(localSkillPath, "SKILL.md"))).resolves.toBeTruthy();
      expect((await lstat(localSkillPath)).isSymbolicLink()).toBe(false);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not delete local shared skills when unmounting a discovered native mount", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-native-unmount-"));
    try {
      const localSkillPath = join(tempDir, ".agents", "skills", "code-review");
      await mkdir(localSkillPath, { recursive: true });
      await writeFile(join(localSkillPath, "SKILL.md"), "---\nversion: local\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        version: "local",
        source: "local",
        libraryPath: localSkillPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      });
      skillMountRepo.upsert({
        providerId: "codex",
        skillSlug: "code-review",
        enabled: true,
        sourcePath: localSkillPath,
        targetPath: localSkillPath,
        mountModeResolved: "copy",
        status: "mounted",
        lastSyncedAt: 3,
      });

      const providers = [
        {
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
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
          buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/tmp" }),
          configSchema: { parse: (value: unknown) => value } as never,
          defaultConfig: {},
          requiredCommands: ["codex"],
          skillMountDirectories: [
            join(tempDir, ".agents", "skills"),
            join(tempDir, ".codex", "skills"),
          ],
        },
      ] as CommandContext["providerRegistry"];

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-unmount-native-shared-1",
          op: "skills.unmount",
          args: { providerId: "codex", skillSlug: "code-review" },
        },
        createBaseContext({
          providerRegistry: providers,
          skillLibraryRepo,
          skillMountRepo,
          skillMountMgr: new SkillMountManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
            skillMountRepo,
          }),
        })
      );

      expect(result.ok).toBe(true);
      await expect(lstat(join(localSkillPath, "SKILL.md"))).resolves.toBeTruthy();
      expect(skillMountRepo.get("codex", "code-review")).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers shared directory discovery over existing provider-specific Codex relations", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-codex-shared-preferred-"));
    try {
      const libraryPath = join(tempDir, "library", "code-review");
      const sharedTargetPath = join(tempDir, ".agents", "skills", "code-review");
      const codexTargetPath = join(tempDir, ".codex", "skills", "code-review");
      await mkdir(libraryPath, { recursive: true });
      await mkdir(sharedTargetPath, { recursive: true });
      await mkdir(codexTargetPath, { recursive: true });
      await writeFile(join(libraryPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");
      await writeFile(join(sharedTargetPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");
      await writeFile(join(codexTargetPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        version: "1.0.0",
        source: "skillhub",
        libraryPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      });
      skillMountRepo.upsert({
        providerId: "codex",
        skillSlug: "code-review",
        enabled: true,
        sourcePath: libraryPath,
        targetPath: codexTargetPath,
        mountModeResolved: "copy",
        status: "mounted",
        lastSyncedAt: 3,
      });

      const providers = [
        {
          id: "codex",
          displayName: "Codex",
          badge: "Codex",
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
          buildCommand: () => ({ argv: ["codex"], env: {}, cwd: "/tmp" }),
          configSchema: { parse: (value: unknown) => value } as never,
          defaultConfig: {},
          requiredCommands: ["codex"],
          skillMountDirectories: [
            join(tempDir, ".agents", "skills"),
            join(tempDir, ".codex", "skills"),
          ],
        },
      ] as CommandContext["providerRegistry"];

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-health-scan-codex-shared-preferred-1",
          op: "skills.health.scan",
          args: {},
        },
        createBaseContext({
          providerRegistry: providers,
          skillLibraryRepo,
          skillMountRepo,
          skillHealthMgr: new SkillHealthManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
          }),
        })
      );

      expect(result.ok).toBe(true);
      expect(skillMountRepo.get("codex", "code-review")).toEqual(
        expect.objectContaining({
          targetPath: sharedTargetPath,
          status: "mounted",
        })
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("returns aggregated target settings and health", async () => {
    const ctx = createBaseContext({
      skillMountRepo: {
        countsByProviderId: vi.fn(() => ({ codex: 2 })),
      } as never,
      skillHealthMgr: {
        listTargetHealth: vi.fn(async () => ({ codex: { state: "healthy" } })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-targets-list-1",
        op: "skills.targets.list",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        providerId: "codex",
        skillDir: "/Users/test/.agents/skills",
        mountedSkillCount: 2,
        lastHealthState: "healthy",
      }),
    ]);
  });

  it("uninstalls a skill by removing repo state and library directory", async () => {
    const tempDir = join(tmpdir(), `skill-uninstall-${Date.now()}`);
    const libraryPath = join(tempDir, "code-review");
    await mkdir(libraryPath, { recursive: true });
    const deleteBySkillSlug = vi.fn();
    const deleteEntry = vi.fn();
    const ctx = createBaseContext({
      skillsHubClient: {} as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "code-review",
          displayName: "Code Review",
          version: "1.0.0",
          source: "skillhub",
          libraryPath,
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
        delete: deleteEntry,
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
        deleteBySkillSlug,
      } as never,
      skillMountMgr: {} as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-uninstall-1",
        op: "skills.uninstall",
        args: { slug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(deleteBySkillSlug).toHaveBeenCalledWith("code-review");
    expect(deleteEntry).toHaveBeenCalledWith("code-review");
    await expect(rm(libraryPath, { recursive: true, force: false })).rejects.toBeTruthy();
  });

  it("scans and persists mount health state", async () => {
    const upsert = vi.fn();
    const ctx = createBaseContext({
      skillMountRepo: {
        list: vi.fn(() => [
          {
            providerId: "codex",
            skillSlug: "code-review",
            enabled: true,
            sourcePath: "/library/code-review",
            targetPath: "/codex/code-review",
            mountModeResolved: "symlink",
            status: "mounted",
          },
        ]),
        countsByProviderId: vi.fn(() => ({ codex: 1 })),
        upsert,
      } as never,
      skillHealthMgr: {
        discoverMounts: vi.fn(async () => []),
        scanMount: vi.fn(async (relation) => ({ ...relation, status: "stale" })),
        listTargetHealth: vi.fn(async () => ({ codex: { state: "warning" } })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-health-scan-1",
        op: "skills.health.scan",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ status: "stale" }));
  });

  it("discovers mounted Claude skills from provider-specific directories during health scan", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-claude-mount-discovery-"));
    try {
      const libraryPath = join(tempDir, "library", "code-review");
      const claudeSkillDir = join(tempDir, ".claude", "skills");
      const targetPath = join(claudeSkillDir, "code-review");
      await mkdir(libraryPath, { recursive: true });
      await mkdir(targetPath, { recursive: true });
      await writeFile(join(libraryPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");
      await writeFile(join(targetPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        version: "1.0.0",
        source: "skillhub",
        libraryPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      });

      const providers = [
        {
          id: "claude",
          displayName: "Claude Code",
          badge: "Claude",
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
          buildCommand: () => ({ argv: ["claude"], env: {}, cwd: "/tmp" }),
          configSchema: { parse: (value: unknown) => value } as never,
          defaultConfig: {},
          requiredCommands: ["claude"],
          skillMountDirectories: [claudeSkillDir],
        },
      ] as CommandContext["providerRegistry"];

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-health-scan-claude-discovery-1",
          op: "skills.health.scan",
          args: {},
        },
        createBaseContext({
          providerRegistry: providers,
          skillLibraryRepo,
          skillMountRepo,
          skillHealthMgr: new SkillHealthManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
          }),
        })
      );

      expect(result.ok).toBe(true);
      expect(skillMountRepo.get("claude", "code-review")).toEqual(
        expect.objectContaining({
          enabled: true,
          mountModeResolved: "copy",
          sourcePath: libraryPath,
          status: "mounted",
          targetPath,
        })
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not mark shared local skills as mounted for Claude", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-claude-shared-not-mounted-"));
    try {
      const libraryPath = join(tempDir, "library", "code-review");
      const sharedTargetPath = join(tempDir, ".agents", "skills", "code-review");
      const claudeSkillDir = join(tempDir, ".claude", "skills");
      await mkdir(libraryPath, { recursive: true });
      await mkdir(sharedTargetPath, { recursive: true });
      await writeFile(join(libraryPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");
      await writeFile(join(sharedTargetPath, "SKILL.md"), "---\nversion: 1.0.0\n---\n");

      const skillLibraryRepo = new SkillLibraryRepo({
        filePath: join(tempDir, "library-index.json"),
      });
      const skillMountRepo = new SkillMountRepo({
        filePath: join(tempDir, "mounts.json"),
      });
      skillLibraryRepo.set({
        slug: "code-review",
        displayName: "Code Review",
        description: "Review code changes before merge",
        version: "1.0.0",
        source: "skillhub",
        libraryPath,
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      });

      const providers = [
        {
          id: "claude",
          displayName: "Claude Code",
          badge: "Claude",
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
          buildCommand: () => ({ argv: ["claude"], env: {}, cwd: "/tmp" }),
          configSchema: { parse: (value: unknown) => value } as never,
          defaultConfig: {},
          requiredCommands: ["claude"],
          skillMountDirectories: [claudeSkillDir],
        },
      ] as CommandContext["providerRegistry"];

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-health-scan-claude-shared-not-mounted-1",
          op: "skills.health.scan",
          args: {},
        },
        createBaseContext({
          providerRegistry: providers,
          skillLibraryRepo,
          skillMountRepo,
          skillHealthMgr: new SkillHealthManager({
            getProviderRegistry: () => providers,
            skillLibraryRepo,
          }),
        })
      );

      expect(result.ok).toBe(true);
      expect(skillMountRepo.get("claude", "code-review")).toBeUndefined();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("repairs an existing mount by remounting and rescanning it", async () => {
    const mount = vi.fn(async () => ({
      providerId: "codex",
      skillSlug: "code-review",
      enabled: true,
      sourcePath: "/library/code-review",
      targetPath: "/codex/code-review",
      mountModeResolved: "symlink",
      status: "mounted",
    }));
    const scanMount = vi.fn(async (relation) => relation);
    const upsert = vi.fn();
    const ctx = createBaseContext({
      skillTargetRepo: {} as never,
      skillMountRepo: {
        get: vi.fn(() => ({
          providerId: "codex",
          skillSlug: "code-review",
          enabled: true,
        })),
        upsert,
      } as never,
      skillMountMgr: { mount } as never,
      skillHealthMgr: { scanMount } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-repair-1",
        op: "skills.repair",
        args: { providerId: "codex", skillSlug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(mount).toHaveBeenCalledWith({
      providerId: "codex",
      skillSlug: "code-review",
      enabled: true,
    });
    expect(upsert).toHaveBeenCalled();
  });
});

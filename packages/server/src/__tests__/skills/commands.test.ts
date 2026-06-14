import { lstat, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { registerSkillsCommands } from "../../commands/skills/index.js";
import { SkillHealthManager } from "../../skills/health-manager.js";
import { SkillMountManager } from "../../skills/mount-manager.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";

registerSkillsCommands();

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
            version: "1.3.0",
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
        version: "1.3.0",
        installed: true,
        installedVersion: "1.2.3",
        mountedProviderIds: ["codex"],
      },
    ]);
  });

  it("recommends uninstalled skills from workspace intelligence", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "skills-recommend-workspace-"));
    try {
      await writeFile(
        join(workspaceRoot, "package.json"),
        JSON.stringify(
          {
            dependencies: {
              react: "^19.0.0",
            },
            devDependencies: {
              vite: "^7.0.0",
            },
            scripts: {
              test: "vitest run",
              build: "vite build",
              lint: "eslint .",
            },
          },
          null,
          2
        )
      );

      const ctx = createBaseContext({
        workspaceMgr: {
          get: vi.fn(() => ({ id: "ws-1", path: workspaceRoot })),
        } as never,
        skillLibraryRepo: {
          get: vi.fn((slug: string) =>
            slug === "react-review"
              ? {
                  slug: "react-review",
                  displayName: "React Review",
                  description: "Review React code",
                  version: "1.0.0",
                  source: "skillhub",
                  libraryPath: "/library/react-review",
                  installState: "installed",
                  installedAt: 1,
                  updatedAt: 1,
                }
              : undefined
          ),
        } as never,
        skillMountRepo: {
          listBySkillSlug: vi.fn(() => []),
        } as never,
        skillsHubClient: {
          search: vi.fn(async (query: string) => {
            if (query.includes("React")) {
              return [
                {
                  slug: "vite-testing",
                  displayName: "Vite Testing",
                  description: "Testing Vite apps",
                },
                {
                  slug: "react-review",
                  displayName: "React Review",
                  description: "Review React code",
                },
              ];
            }

            return [];
          }),
        } as never,
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-recommend-1",
          op: "skills.recommend",
          args: { workspaceId: "ws-1" },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual([
        expect.objectContaining({
          slug: "vite-testing",
          installed: false,
          reason: expect.any(String),
          sourceQuery: expect.any(String),
        }),
      ]);
      expect(
        (result.data as Array<{ slug: string }>).some((item) => item.slug === "react-review")
      ).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
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

  it("checks installed Skill Hub versions and skips local or built-in skills", async () => {
    const info = vi.fn(async (slug: string) => {
      if (slug === "code-review") {
        return {
          slug,
          name: "Code Review",
          description: "Review code changes before merge",
          version: "1.3.0",
        };
      }

      if (slug === "security-review") {
        return {
          slug,
          name: "Security Review",
          description: "Review security issues",
          version: "1.2.3",
        };
      }

      return { slug };
    });
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
          {
            slug: "security-review",
            displayName: "Security Review",
            description: "Review security issues",
            version: "1.2.3",
            source: "skillhub",
            libraryPath: "/library/security-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
          {
            slug: "local-helper",
            displayName: "Local Helper",
            version: "local",
            source: "local",
            libraryPath: "/library/local-helper",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/library/builtin/example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            builtin: { defaultEnabled: true, autoMount: false },
          },
        ]),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
      skillsHubClient: { info } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-versions-check-1",
        op: "skills.versions.check",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        slug: "code-review",
        currentVersion: "1.2.3",
        latestVersion: "1.3.0",
        status: "update_available",
      },
      {
        slug: "security-review",
        currentVersion: "1.2.3",
        latestVersion: "1.2.3",
        status: "up_to_date",
      },
    ]);
    expect(info).toHaveBeenCalledTimes(2);
    expect(info).toHaveBeenCalledWith("code-review");
    expect(info).toHaveBeenCalledWith("security-review");
  });

  it("reports unknown and error states when Skill Hub version checks cannot compare versions", async () => {
    const info = vi.fn(async (slug: string) => {
      if (slug === "missing-version") {
        return { slug, name: "Missing Version" };
      }

      throw new Error("Skill Hub unavailable");
    });
    const ctx = createBaseContext({
      skillLibraryRepo: {
        list: vi.fn(() => [
          {
            slug: "missing-version",
            displayName: "Missing Version",
            version: "1.0.0",
            source: "skillhub",
            libraryPath: "/library/missing-version",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
          {
            slug: "lookup-failed",
            displayName: "Lookup Failed",
            version: "1.0.0",
            source: "skillhub",
            libraryPath: "/library/lookup-failed",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
        ]),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
      skillsHubClient: { info } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-versions-check-unknown-1",
        op: "skills.versions.check",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      {
        slug: "missing-version",
        currentVersion: "1.0.0",
        status: "unknown",
      },
      {
        slug: "lookup-failed",
        currentVersion: "1.0.0",
        status: "error",
        error: "Skill Hub unavailable",
      },
    ]);
  });

  it("returns builtin library metadata", async () => {
    const ctx = createBaseContext({
      skillLibraryRepo: {
        list: vi.fn(() => [
          {
            slug: "coder-studio-example-builtin",
            displayName: "Coder Studio Example Builtin",
            description: "Test fixture for built-in skill command behavior.",
            version: "1.0.0",
            source: "builtin",
            libraryPath: "/skills/builtin/coder-studio-example-builtin",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
            builtin: { defaultEnabled: true, autoMount: false },
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
        slug: "coder-studio-example-builtin",
        source: "builtin",
        builtin: { defaultEnabled: true, autoMount: false },
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

  it("broadcasts a skill library change after builtin sync removes stale skills", async () => {
    const broadcast = vi.fn();
    const removed = [{ skillSlug: "old-builtin-skill", unmountedProviderIds: ["codex"] }];
    const sync = vi.fn(async () => ({
      libraryEntries: [],
      mounted: [],
      skipped: [],
      removed,
    }));
    const ctx = createBaseContext({
      broadcaster: { broadcast } as never,
      builtinSkillSyncMgr: { sync } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-builtin-sync-broadcast-1",
        op: "skills.builtin.sync",
        args: {},
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(broadcast).toHaveBeenCalledWith(
      Topics.skillLibraryChanged,
      expect.objectContaining({
        reason: "builtin_sync",
        removed,
      })
    );
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
          skillSlug: "coder-studio-example-builtin",
          enabled: false,
        },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(setMountEnabled).toHaveBeenCalledWith("codex", "coder-studio-example-builtin", false);
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

  it("starts updates for installed Skill Hub skills only", async () => {
    const start = vi.fn(async () => ({
      jobId: "job-update-1",
      slug: "code-review",
      status: "queued",
      steps: [],
    }));
    const ctx = createBaseContext({
      skillInstallMgr: { start } as never,
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
          updatedAt: 2,
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-update-start-1",
        op: "skills.update.start",
        args: { slug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(true);
    expect(start).toHaveBeenCalledWith("code-review");
  });

  it("rejects update requests for non-Skill Hub skills", async () => {
    const start = vi.fn();
    const ctx = createBaseContext({
      skillInstallMgr: { start } as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "local-helper",
          displayName: "Local Helper",
          version: "local",
          source: "local",
          libraryPath: "/library/local-helper",
          installState: "installed",
          installedAt: 1,
          updatedAt: 2,
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-update-start-local-1",
        op: "skills.update.start",
        args: { slug: "local-helper" },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "skill_update_unavailable",
      message: "Only installed Skill Hub skills can be updated: local-helper",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects update requests for Skill Hub skills that are not installed", async () => {
    const start = vi.fn();
    const ctx = createBaseContext({
      skillInstallMgr: { start } as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "code-review",
          displayName: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
          source: "skillhub",
          libraryPath: "/library/code-review",
          installState: "failed",
          installedAt: 1,
          updatedAt: 2,
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-update-start-failed-1",
        op: "skills.update.start",
        args: { slug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "skill_update_unavailable",
      message: "Only installed Skill Hub skills can be updated: code-review",
    });
    expect(start).not.toHaveBeenCalled();
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
    const broadcast = vi.fn();
    const deleteBySkillSlug = vi.fn();
    const deleteEntry = vi.fn();
    const ctx = createBaseContext({
      broadcaster: { broadcast } as never,
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
    expect(broadcast).toHaveBeenCalledWith(
      Topics.skillLibraryChanged,
      expect.objectContaining({
        reason: "uninstalled",
        slug: "code-review",
      })
    );
    await expect(rm(libraryPath, { recursive: true, force: false })).rejects.toBeTruthy();
  });

  it("rejects uninstalling built-in skills", async () => {
    const tempDir = join(tmpdir(), `skill-uninstall-builtin-${Date.now()}`);
    const libraryPath = join(tempDir, "coder-studio-example-builtin");
    await mkdir(libraryPath, { recursive: true });
    const deleteBySkillSlug = vi.fn();
    const deleteEntry = vi.fn();
    const ctx = createBaseContext({
      skillsHubClient: {} as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "coder-studio-example-builtin",
          displayName: "Coder Studio Example Builtin",
          description: "Test fixture for built-in skill command behavior.",
          version: "1.0.0",
          source: "builtin",
          libraryPath,
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
          builtin: { defaultEnabled: true, autoMount: false },
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
        id: "skills-uninstall-builtin-1",
        op: "skills.uninstall",
        args: { slug: "coder-studio-example-builtin", force: true },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("skill_uninstall_unavailable");
    expect(deleteBySkillSlug).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect((await lstat(libraryPath)).isDirectory()).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
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

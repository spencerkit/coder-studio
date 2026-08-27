import {
  readFile as fsReadFile,
  lstat,
  mkdir,
  mkdtemp,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Topics } from "@coder-studio/core";
import { describe, expect, it, vi } from "vitest";
import { registerSkillsCommands } from "../../commands/skills/index.js";
import { SkillHealthManager } from "../../skills/health-manager.js";
import { readManagedSkillMarker } from "../../skills/managed-skill-metadata.js";
import { SkillMountManager } from "../../skills/mount-manager.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";
import type { CommandContext } from "../../ws/dispatch.js";
import { dispatch } from "../../ws/dispatch.js";

registerSkillsCommands();

const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

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
          source: "installed",
          origin: "skillhub",
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
            installCount: 8_674,
            githubStars: 518,
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
        installCount: 8_674,
        githubStars: 518,
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
                  source: "installed",
                  origin: "skillhub",
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
      expect(result.data).toEqual({
        entries: [
          expect.objectContaining({
            slug: "vite-testing",
            installed: false,
            reason: expect.any(String),
            sourceQuery: expect.any(String),
          }),
        ],
        hasMore: false,
      });
      expect(
        (result.data as { entries: Array<{ slug: string }> }).entries.some(
          (item) => item.slug === "react-review"
        )
      ).toBe(false);
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  });

  it("returns paginated recommendations with hasMore", async () => {
    const workspaceRoot = await mkdtemp(join(tmpdir(), "skills-recommend-page-"));
    try {
      await writeFile(
        join(workspaceRoot, "package.json"),
        JSON.stringify(
          {
            dependencies: { react: "^19.0.0" },
            scripts: { test: "vitest run" },
          },
          null,
          2
        )
      );

      const ctx = createBaseContext({
        workspaceMgr: {
          get: vi.fn(() => ({ id: "ws-1", path: workspaceRoot })),
        } as never,
        skillLibraryRepo: { get: vi.fn(() => undefined) } as never,
        skillMountRepo: { listBySkillSlug: vi.fn(() => []) } as never,
        skillsHubClient: {
          search: vi.fn(async (query: string) =>
            query.includes("React")
              ? [
                  { slug: "skill-a", displayName: "Skill A", description: "A" },
                  { slug: "skill-b", displayName: "Skill B", description: "B" },
                  { slug: "skill-c", displayName: "Skill C", description: "C" },
                ]
              : []
          ),
        } as never,
      });

      const result = await dispatch(
        {
          kind: "command",
          id: "skills-recommend-page-1",
          op: "skills.recommend",
          args: { workspaceId: "ws-1", limit: 2, offset: 1 },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual({
        entries: [
          expect.objectContaining({ slug: "skill-b" }),
          expect.objectContaining({ slug: "skill-c" }),
        ],
        hasMore: false,
      });
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
          source: "installed",
          origin: "skillhub",
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
            registryRef: "mattpocock/skills@code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "installed",
            origin: "skills-sh",
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
            registryRef: "mattpocock/skills@code-review",
            displayName: "Code Review",
            description: "Review code changes before merge",
            version: "1.2.3",
            source: "installed",
            origin: "skills-sh",
            libraryPath: "/library/code-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
          {
            slug: "security-review",
            registryRef: "acme/skills@security-review",
            displayName: "Security Review",
            description: "Review security issues",
            version: "1.2.3",
            source: "installed",
            origin: "skills-sh",
            libraryPath: "/library/security-review",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
          {
            slug: "local-helper",
            displayName: "Local Helper",
            version: "local",
            source: "custom",
            origin: "filesystem",
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
    expect(info).toHaveBeenCalledWith("code-review", "mattpocock/skills@code-review");
    expect(info).toHaveBeenCalledWith("security-review", "acme/skills@security-review");
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
            registryRef: "acme/skills@missing-version",
            displayName: "Missing Version",
            version: "1.0.0",
            source: "installed",
            origin: "skills-sh",
            libraryPath: "/library/missing-version",
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
          {
            slug: "lookup-failed",
            registryRef: "acme/skills@lookup-failed",
            displayName: "Lookup Failed",
            version: "1.0.0",
            source: "installed",
            origin: "skills-sh",
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

  it("creates a custom skill in the canonical custom root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skills-custom-create-"));
    const libraryFile = join(tempDir, "skill-library.json");
    const customSkillRoot = join(tempDir, "state", "skills", "custom");
    const externalSkillRoot = join(tempDir, "external-skills");
    await mkdir(customSkillRoot, { recursive: true });
    await mkdir(externalSkillRoot, { recursive: true });
    const broadcast = vi.fn();
    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: libraryFile,
      customSkillRoot,
      externalSkillRoots: [externalSkillRoot],
    });
    const ctx = createBaseContext({
      broadcaster: { broadcast } as never,
      skillsHubClient: {} as never,
      skillLibraryRepo,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
    });

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "skills-custom-create-1",
          op: "skills.custom.create",
          args: { name: "My Review Skill" },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(result.data).toEqual(
        expect.objectContaining({
          slug: "my-review-skill",
          source: "custom",
          origin: "filesystem",
          installState: "installed",
          libraryPath: join(customSkillRoot, "my-review-skill"),
        })
      );
      expect(skillLibraryRepo.get("my-review-skill")).toEqual(
        expect.objectContaining({
          slug: "my-review-skill",
          source: "custom",
          origin: "filesystem",
        })
      );
      expect(readManagedSkillMarker(join(customSkillRoot, "my-review-skill"))).toEqual({
        version: 1,
        managedBy: "coder-studio",
        source: "custom",
        slug: "my-review-skill",
      });
      expect(broadcast).toHaveBeenCalledWith(
        Topics.skillLibraryChanged,
        expect.objectContaining({
          reason: "custom_created",
          slug: "my-review-skill",
        })
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects custom skill creation when another source already owns the slug", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skills-custom-create-conflict-"));
    const customSkillRoot = join(tempDir, "state", "skills", "custom");
    const managedLibraryRoot = join(tempDir, "state", "skills", "library");
    const existingLibraryPath = join(managedLibraryRoot, "my-review-skill");
    await mkdir(existingLibraryPath, { recursive: true });
    await writeFile(join(existingLibraryPath, "SKILL.md"), "# Existing\n");

    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "skill-library.json"),
      managedLibraryRoot,
      customSkillRoot,
    });
    skillLibraryRepo.set({
      slug: "my-review-skill",
      displayName: "My Review Skill",
      description: "Installed variant",
      version: "1.0.0",
      source: "installed",
      origin: "skillhub",
      libraryPath: existingLibraryPath,
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });
    const ctx = createBaseContext({
      broadcaster: { broadcast: vi.fn() } as never,
      skillsHubClient: {} as never,
      skillLibraryRepo,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
    });

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "skills-custom-create-conflict-1",
          op: "skills.custom.create",
          args: { name: "My Review Skill" },
        },
        ctx
      );

      expect(result.ok).toBe(false);
      expect(result.error).toMatchObject({
        code: "skill_slug_conflict",
        message: "A skill with slug my-review-skill already exists",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("reads the file tree and files for local skills", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skills-files-read-"));
    const customSkillRoot = join(tempDir, "state", "skills", "custom");
    const skillRoot = join(customSkillRoot, "my-review-skill");
    await mkdir(join(skillRoot, "refs"), { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# My Review Skill\n");
    await writeFile(join(skillRoot, "refs", "guide.md"), "guide\n");
    await writeFile(join(skillRoot, "pixel.png"), PNG_BYTES);
    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "skill-library.json"),
      customSkillRoot,
    });
    const ctx = createBaseContext({
      skillsHubClient: {} as never,
      skillLibraryRepo,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
    });

    try {
      const treeResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-tree-1",
          op: "skills.files.readTree",
          args: { skillSlug: "my-review-skill" },
        },
        ctx
      );
      const textReadResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-read-1",
          op: "skills.files.read",
          args: { skillSlug: "my-review-skill", path: "refs/guide.md" },
        },
        ctx
      );
      const imageReadResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-read-2",
          op: "skills.files.read",
          args: { skillSlug: "my-review-skill", path: "pixel.png" },
        },
        ctx
      );

      expect(treeResult.ok).toBe(true);
      expect((treeResult.data as { path: string }).path).toBe(".");
      expect(
        (treeResult.data as { children: Array<{ path: string; kind: string }> }).children
      ).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: "refs", kind: "dir" }),
          expect.objectContaining({ path: "SKILL.md", kind: "file" }),
        ])
      );
      expect(textReadResult.ok).toBe(true);
      expect(textReadResult.data).toMatchObject({
        kind: "text",
        content: "guide\n",
        displayPath: join(skillRoot, "refs", "guide.md"),
        baseHash: expect.any(String),
      });
      expect(imageReadResult.ok).toBe(true);
      expect(imageReadResult.data).toMatchObject({
        kind: "image",
        mime: "image/png",
        url: "/api/skill-file?skillSlug=my-review-skill&path=pixel.png",
        size: PNG_BYTES.length,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("writes and mutates local skill files through skill file commands", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skills-files-write-"));
    const customSkillRoot = join(tempDir, "state", "skills", "custom");
    const skillRoot = join(customSkillRoot, "my-review-skill");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(join(skillRoot, "SKILL.md"), "# My Review Skill\n");
    await writeFile(join(skillRoot, "draft.md"), "draft\n");
    const broadcast = vi.fn();
    const skillLibraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "skill-library.json"),
      customSkillRoot,
    });
    const ctx = createBaseContext({
      broadcaster: { broadcast } as never,
      skillsHubClient: {} as never,
      skillLibraryRepo,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
    });

    try {
      const writeResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-write-1",
          op: "skills.files.write",
          args: { skillSlug: "my-review-skill", path: "draft.md", content: "updated\n" },
        },
        ctx
      );
      expect(writeResult.ok).toBe(true);
      expect(writeResult.data).toMatchObject({ newHash: expect.any(String) });
      expect(await fsReadFile(join(skillRoot, "draft.md"), "utf8")).toBe("updated\n");

      const createResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-create-1",
          op: "skills.files.create",
          args: { skillSlug: "my-review-skill", path: "notes/today.md" },
        },
        ctx
      );
      const mkdirResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-mkdir-1",
          op: "skills.files.mkdir",
          args: { skillSlug: "my-review-skill", path: "archive" },
        },
        ctx
      );
      const renameResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-rename-1",
          op: "skills.files.rename",
          args: {
            skillSlug: "my-review-skill",
            fromPath: "draft.md",
            toPath: "final.md",
          },
        },
        ctx
      );
      expect(createResult.ok).toBe(true);
      expect(await fsReadFile(join(skillRoot, "notes", "today.md"), "utf8")).toBe("");
      expect(mkdirResult.ok).toBe(true);
      expect((await stat(join(skillRoot, "archive"))).isDirectory()).toBe(true);
      expect(renameResult.ok).toBe(true);
      expect(await fsReadFile(join(skillRoot, "final.md"), "utf8")).toBe("updated\n");
      const deleteResult = await dispatch(
        {
          kind: "command",
          id: "skills-files-delete-1",
          op: "skills.files.delete",
          args: { skillSlug: "my-review-skill", path: "notes/today.md" },
        },
        ctx
      );
      expect(deleteResult.ok).toBe(true);
      await expect(stat(join(skillRoot, "notes", "today.md"))).rejects.toThrow();
      expect(broadcast).toHaveBeenCalledTimes(5);
      expect(broadcast).toHaveBeenCalledWith(
        Topics.skillLibraryChanged,
        expect.objectContaining({
          reason: "skill_files_changed",
          skillSlug: "my-review-skill",
        })
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects skill file commands for non-custom skills", async () => {
    const ctx = createBaseContext({
      skillsHubClient: {} as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "code-review",
          displayName: "Code Review",
          version: "1.0.0",
          source: "installed",
          origin: "skillhub",
          libraryPath: "/library/code-review",
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
      } as never,
    });

    const results = await Promise.all([
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-tree-1",
          op: "skills.files.readTree",
          args: { skillSlug: "code-review" },
        },
        ctx
      ),
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-read-1",
          op: "skills.files.read",
          args: { skillSlug: "code-review", path: "SKILL.md" },
        },
        ctx
      ),
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-write-1",
          op: "skills.files.write",
          args: { skillSlug: "code-review", path: "SKILL.md", content: "updated\n" },
        },
        ctx
      ),
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-create-1",
          op: "skills.files.create",
          args: { skillSlug: "code-review", path: "new.md" },
        },
        ctx
      ),
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-mkdir-1",
          op: "skills.files.mkdir",
          args: { skillSlug: "code-review", path: "refs" },
        },
        ctx
      ),
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-rename-1",
          op: "skills.files.rename",
          args: { skillSlug: "code-review", fromPath: "a.md", toPath: "b.md" },
        },
        ctx
      ),
      dispatch(
        {
          kind: "command",
          id: "skills-files-nonlocal-delete-1",
          op: "skills.files.delete",
          args: { skillSlug: "code-review", path: "SKILL.md" },
        },
        ctx
      ),
    ]);

    expect(results.every((result) => result.ok === false)).toBe(true);
    for (const result of results) {
      expect(result.error?.code).toBe("skill_not_found");
    }
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

  it("starts updates for installed skills.sh skills only", async () => {
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
          registryRef: "mattpocock/skills@code-review",
          displayName: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
          source: "installed",
          origin: "skills-sh",
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
    expect(start).toHaveBeenCalledWith("code-review", "mattpocock/skills@code-review");
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
          source: "custom",
          origin: "filesystem",
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
      message: "Only installed skills.sh skills can be updated: local-helper",
    });
    expect(start).not.toHaveBeenCalled();
  });

  it("rejects update requests for filesystem-installed skills", async () => {
    const start = vi.fn();
    const ctx = createBaseContext({
      skillInstallMgr: { start } as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "code-review",
          displayName: "Code Review",
          version: "1.0.0",
          source: "installed",
          origin: "filesystem",
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
        id: "skills-update-start-filesystem-1",
        op: "skills.update.start",
        args: { slug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "skill_update_unavailable",
      message: "Only installed skills.sh skills can be updated: code-review",
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
          registryRef: "mattpocock/skills@code-review",
          displayName: "Code Review",
          description: "Review code changes before merge",
          version: "1.2.3",
          source: "installed",
          origin: "skills-sh",
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
      message: "Only installed skills.sh skills can be updated: code-review",
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
        source: "installed",
        origin: "skillhub",
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
        source: "custom",
        origin: "filesystem",
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
        source: "custom",
        origin: "filesystem",
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
        source: "installed",
        origin: "skillhub",
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

  it("uninstalls a Skill Hub skill by removing repo state without deleting third-party filesystem directories", async () => {
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
          source: "installed",
          origin: "skillhub",
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
    await expect(lstat(libraryPath)).resolves.toBeTruthy();
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

  it("rejects uninstalling custom skills without force", async () => {
    const tempDir = join(tmpdir(), `skill-uninstall-custom-${Date.now()}`);
    const libraryPath = join(tempDir, "my-review-skill");
    await mkdir(libraryPath, { recursive: true });
    const deleteBySkillSlug = vi.fn();
    const deleteEntry = vi.fn();
    const ctx = createBaseContext({
      skillsHubClient: {} as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "my-review-skill",
          displayName: "My Review Skill",
          version: "local",
          source: "custom",
          origin: "filesystem",
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
        id: "skills-uninstall-custom-1",
        op: "skills.uninstall",
        args: { slug: "my-review-skill" },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("skill_uninstall_confirmation_required");
    expect(deleteBySkillSlug).not.toHaveBeenCalled();
    expect(deleteEntry).not.toHaveBeenCalled();
    expect((await lstat(libraryPath)).isDirectory()).toBe(true);

    await rm(tempDir, { recursive: true, force: true });
  });

  it("rejects uninstalling filesystem-installed skills", async () => {
    const tempDir = join(tmpdir(), `skill-uninstall-filesystem-${Date.now()}`);
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
          source: "installed",
          origin: "filesystem",
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
        id: "skills-uninstall-filesystem-1",
        op: "skills.uninstall",
        args: { slug: "code-review", force: true },
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

  it("force deletes custom skills and unmounts their relations", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-uninstall-custom-force-"));
    const libraryPath = join(tempDir, "state", "skills", "custom", "my-review-skill");
    await mkdir(libraryPath, { recursive: true });
    await writeFile(join(libraryPath, "SKILL.md"), "# My Review Skill\n");
    await writeFile(
      join(libraryPath, ".coder-studio-skill.json"),
      JSON.stringify({
        version: 1,
        managedBy: "coder-studio",
        source: "custom",
        slug: "my-review-skill",
      }),
      "utf8"
    );
    const deleteBySkillSlug = vi.fn();
    const deleteEntry = vi.fn();
    const unmount = vi.fn(async () => undefined);
    const broadcast = vi.fn();
    const ctx = createBaseContext({
      broadcaster: { broadcast } as never,
      skillsHubClient: {} as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "my-review-skill",
          displayName: "My Review Skill",
          version: "local",
          source: "custom",
          origin: "filesystem",
          libraryPath,
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
        getCustomSkillRoot: vi.fn(() => join(tempDir, "state", "skills", "custom")),
        delete: deleteEntry,
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => [
          {
            providerId: "codex",
            skillSlug: "my-review-skill",
            enabled: true,
            sourcePath: libraryPath,
            targetPath: join(tempDir, ".agents", "skills", "my-review-skill"),
            mountModeResolved: "symlink",
            status: "mounted",
          },
          {
            providerId: "claude",
            skillSlug: "my-review-skill",
            enabled: false,
            sourcePath: libraryPath,
            targetPath: join(tempDir, ".claude", "skills", "my-review-skill"),
            mountModeResolved: "copy",
            status: "mounted",
          },
        ]),
        deleteBySkillSlug,
      } as never,
      skillMountMgr: { unmount } as never,
    });

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "skills-uninstall-custom-force-1",
          op: "skills.uninstall",
          args: { slug: "my-review-skill", force: true },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      expect(unmount).toHaveBeenCalledTimes(2);
      expect(deleteBySkillSlug).toHaveBeenCalledWith("my-review-skill");
      expect(deleteEntry).toHaveBeenCalledWith("my-review-skill");
      await expect(lstat(libraryPath)).rejects.toThrow();
      expect(broadcast).toHaveBeenCalledWith(
        Topics.skillLibraryChanged,
        expect.objectContaining({
          reason: "uninstalled",
          slug: "my-review-skill",
        })
      );
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("does not delete a custom skill path outside the configured custom root", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "skill-uninstall-custom-guard-"));
    const customSkillRoot = join(tempDir, "state", "skills", "custom");
    const unrelatedPath = join(tempDir, "external", "my-review-skill");
    await mkdir(customSkillRoot, { recursive: true });
    await mkdir(unrelatedPath, { recursive: true });
    await writeFile(join(unrelatedPath, "SKILL.md"), "# My Review Skill\n");
    const deleteBySkillSlug = vi.fn();
    const deleteEntry = vi.fn();
    const ctx = createBaseContext({
      skillsHubClient: {} as never,
      skillLibraryRepo: {
        get: vi.fn(() => ({
          slug: "my-review-skill",
          displayName: "My Review Skill",
          version: "local",
          source: "custom",
          origin: "filesystem",
          libraryPath: unrelatedPath,
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
        getCustomSkillRoot: vi.fn(() => customSkillRoot),
        delete: deleteEntry,
      } as never,
      skillMountRepo: {
        listBySkillSlug: vi.fn(() => []),
        deleteBySkillSlug,
      } as never,
      skillMountMgr: { unmount: vi.fn(async () => undefined) } as never,
    });

    try {
      const result = await dispatch(
        {
          kind: "command",
          id: "skills-uninstall-custom-guard-1",
          op: "skills.uninstall",
          args: { slug: "my-review-skill", force: true },
        },
        ctx
      );

      expect(result.ok).toBe(true);
      await expect(lstat(unrelatedPath)).resolves.toBeTruthy();
      expect(deleteBySkillSlug).toHaveBeenCalledWith("my-review-skill");
      expect(deleteEntry).toHaveBeenCalledWith("my-review-skill");
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("rejects Skill Hub installs when another source already owns the slug", async () => {
    const start = vi.fn(async () => ({
      jobId: "job-install-conflict-1",
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
          version: "local",
          source: "custom",
          origin: "filesystem",
          libraryPath: "/skills/custom/code-review",
          installState: "installed",
          installedAt: 1,
          updatedAt: 1,
        })),
      } as never,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-install-start-conflict-1",
        op: "skills.install.start",
        args: { slug: "code-review" },
      },
      ctx
    );

    expect(result.ok).toBe(false);
    expect(result.error).toMatchObject({
      code: "skill_slug_conflict",
      message: "A skill with slug code-review already exists",
    });
    expect(start).not.toHaveBeenCalled();
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
        source: "installed",
        origin: "skillhub",
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
        source: "installed",
        origin: "skillhub",
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

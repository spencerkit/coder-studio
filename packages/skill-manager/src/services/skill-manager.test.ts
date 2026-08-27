import { describe, expect, it, vi } from "vitest";
import type { SkillJsonDocumentName, SkillJsonStorage } from "../ports/json-storage.js";
import { SkillLibraryRepository } from "../repositories/skill-library-repository.js";
import { SkillMountRepository } from "../repositories/skill-mount-repository.js";
import { SkillManager } from "./skill-manager.js";

class MemoryJsonStorage implements SkillJsonStorage {
  readonly documents = new Map<SkillJsonDocumentName, unknown>();

  read(name: SkillJsonDocumentName): unknown | undefined {
    return this.documents.get(name);
  }

  write(name: SkillJsonDocumentName, value: unknown): void {
    this.documents.set(name, value);
  }
}

function createRepositories() {
  const storage = new MemoryJsonStorage();
  return {
    library: new SkillLibraryRepository({ storage }),
    mounts: new SkillMountRepository(storage),
  };
}

describe("SkillManager", () => {
  it("decorates catalog search results and lists library mount state", async () => {
    const { library, mounts } = createRepositories();
    library.set({
      slug: "review",
      registryRef: "acme/skills@review",
      displayName: "Review",
      version: "1.0.0",
      source: "installed",
      origin: "skills-sh",
      libraryPath: "/skills/review",
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
    });
    mounts.upsert({
      providerId: "codex",
      skillSlug: "review",
      enabled: true,
      sourcePath: "/skills/review",
      targetPath: "/targets/review",
      mountModeResolved: "copy",
      status: "stale",
    });
    const manager = new SkillManager({
      library,
      mounts,
      catalog: {
        search: vi.fn(async () => [
          {
            slug: "review",
            displayName: "Code Review",
            version: "2.0.0",
            installCount: 8_674,
            githubStars: 518,
          },
        ]),
        info: vi.fn(),
      },
    });

    await expect(manager.searchSkills(" review ")).resolves.toEqual([
      expect.objectContaining({
        slug: "review",
        installed: true,
        installedVersion: "1.0.0",
        installCount: 8_674,
        githubStars: 518,
        mountedProviderIds: ["codex"],
      }),
    ]);
    expect(manager.listSkills()).toEqual([
      expect.objectContaining({ mountStatus: "error", errorCount: 1 }),
    ]);
  });

  it("validates install and update ownership before starting a host job", async () => {
    const { library, mounts } = createRepositories();
    const start = vi.fn(async (slug: string) => ({
      jobId: `job-${slug}`,
      slug,
      status: "queued" as const,
      steps: [],
    }));
    const manager = new SkillManager({ library, mounts, installJobs: { start, get: vi.fn() } });

    await expect(manager.startInstall("review")).resolves.toMatchObject({ slug: "review" });
    library.set({
      slug: "local",
      displayName: "Local",
      version: "local",
      source: "installed",
      origin: "filesystem",
      libraryPath: "/local",
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });
    await expect(manager.startInstall("local")).rejects.toMatchObject({
      code: "skill_slug_conflict",
    });
    await expect(manager.startUpdate("local")).rejects.toMatchObject({
      code: "skill_update_unavailable",
    });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("checks versions only for installed catalog skills", async () => {
    const { library, mounts } = createRepositories();
    library.set({
      slug: "review",
      registryRef: "acme/skills@review",
      displayName: "Review",
      version: "v1.2.0",
      source: "installed",
      origin: "skills-sh",
      libraryPath: "/skills/review",
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
    });
    library.set({
      slug: "external",
      displayName: "External",
      version: "local",
      source: "installed",
      origin: "filesystem",
      libraryPath: "/external",
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });
    const info = vi.fn(async (slug: string) => ({ slug, version: "1.3.0" }));
    const manager = new SkillManager({
      library,
      mounts,
      catalog: { search: vi.fn(), info },
    });

    await expect(manager.checkVersions()).resolves.toEqual([
      {
        slug: "review",
        currentVersion: "v1.2.0",
        latestVersion: "1.3.0",
        status: "update_available",
      },
    ]);
    expect(info).toHaveBeenCalledWith("review", "acme/skills@review");
  });

  it("imports a local skill through host content operations and persists metadata", async () => {
    const { library, mounts } = createRepositories();
    const publish = vi.fn();
    const manager = new SkillManager({
      library,
      mounts,
      now: () => 42,
      contentHost: {
        importLocal: vi.fn(async () => ({ libraryPath: "/managed/local-review" })),
      },
      events: { publish },
    });

    await expect(
      manager.importLocal({
        source: "/incoming/review",
        slug: "local-review",
        displayName: "Local Review",
      })
    ).resolves.toMatchObject({
      slug: "local-review",
      source: "installed",
      origin: "filesystem",
      libraryPath: "/managed/local-review",
      installedAt: 42,
    });
    expect(library.get("local-review")).toBeDefined();
    expect(publish).toHaveBeenCalledWith({ reason: "imported", slug: "local-review" });
  });

  it("lets the host distinguish managed imports from external filesystem skills", async () => {
    const { library, mounts } = createRepositories();
    library.set({
      slug: "managed-local",
      displayName: "Managed Local",
      version: "local",
      source: "installed",
      origin: "filesystem",
      libraryPath: "/managed/local",
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });
    const remove = vi.fn(async () => undefined);
    const manager = new SkillManager({
      library,
      mounts,
      mountHost: { mount: vi.fn(), unmount: vi.fn(async () => undefined) },
      contentHost: { canRemove: (entry) => entry.libraryPath.startsWith("/managed/"), remove },
    });

    await expect(manager.remove("managed-local")).resolves.toMatchObject({
      deleted: true,
      slug: "managed-local",
    });
    expect(remove).toHaveBeenCalledOnce();
  });

  it("owns sync, unsync, repair, and relation persistence around host execution", async () => {
    const { library, mounts } = createRepositories();
    const relation = {
      providerId: "codex",
      skillSlug: "review",
      enabled: true,
      sourcePath: "/skills/review",
      targetPath: "/targets/review",
      mountModeResolved: "copy" as const,
      status: "mounted" as const,
    };
    const mount = vi.fn(async () => relation);
    const unmount = vi.fn(async () => undefined);
    const scanMount = vi.fn(async (input: typeof relation) => ({
      ...input,
      status: "mounted" as const,
    }));
    const manager = new SkillManager({
      library,
      mounts,
      mountHost: { mount, unmount },
      healthHost: { discoverMounts: vi.fn(async () => []), scanMount },
    });

    await expect(manager.sync({ providerId: "codex", skillSlug: "review" })).resolves.toMatchObject(
      relation
    );
    expect(mounts.get("codex", "review")).toBeDefined();
    await expect(manager.repair("codex", "review")).resolves.toMatchObject(relation);
    await manager.unsync("codex", "review");
    expect(mounts.get("codex", "review")).toBeUndefined();
    expect(unmount).toHaveBeenCalledWith("codex", "review");
  });

  it("blocks unsafe removals and delegates managed content deletion to the host", async () => {
    const { library, mounts } = createRepositories();
    library.set({
      slug: "custom-review",
      displayName: "Custom Review",
      version: "local",
      source: "custom",
      origin: "filesystem",
      libraryPath: "/custom/review",
      installState: "installed",
      installedAt: 1,
      updatedAt: 1,
    });
    const remove = vi.fn(async () => undefined);
    const manager = new SkillManager({
      library,
      mounts,
      mountHost: { mount: vi.fn(), unmount: vi.fn(async () => undefined) },
      contentHost: { remove },
    });

    await expect(manager.remove("custom-review")).rejects.toMatchObject({
      code: "skill_uninstall_confirmation_required",
    });
    await expect(manager.remove("custom-review", true)).resolves.toEqual({
      deleted: true,
      slug: "custom-review",
    });
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({ slug: "custom-review" }));
    expect(library.get("custom-review")).toBeUndefined();
  });
});

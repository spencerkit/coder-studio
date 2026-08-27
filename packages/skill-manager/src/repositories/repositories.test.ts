import { describe, expect, it } from "vitest";
import type { SkillJsonDocumentName, SkillJsonStorage } from "../ports/json-storage.js";
import { SkillLibraryRepository } from "./skill-library-repository.js";
import { SkillMountRepository } from "./skill-mount-repository.js";
import { SkillTargetRepository } from "./skill-target-repository.js";

class MemoryJsonStorage implements SkillJsonStorage {
  readonly documents = new Map<SkillJsonDocumentName, unknown>();

  read(name: SkillJsonDocumentName): unknown | undefined {
    return this.documents.get(name);
  }

  write(name: SkillJsonDocumentName, value: unknown): void {
    this.documents.set(name, value);
  }
}

describe("JSON repositories", () => {
  it("normalizes legacy library entries and preserves source priority", () => {
    const storage = new MemoryJsonStorage();
    storage.documents.set("skills.library", {
      "hub-skill": {
        slug: "hub-skill",
        displayName: "Hub Skill",
        version: "1.0.0",
        source: "skillhub",
        libraryPath: "/managed/hub-skill",
        installState: "installed",
        installedAt: 1,
        updatedAt: 1,
      },
      "custom-skill": {
        slug: "custom-skill",
        displayName: "Custom Skill",
        version: "local",
        source: "local",
        libraryPath: "/custom/custom-skill",
        installState: "installed",
        installedAt: 1,
        updatedAt: 2,
      },
    });

    const repository = new SkillLibraryRepository({
      storage,
      isCustomLocation: (path) => path.startsWith("/custom/"),
      discover: () => [
        {
          slug: "hub-skill",
          displayName: "External Hub Shadow",
          version: "local",
          source: "installed",
          origin: "filesystem",
          libraryPath: "/external/hub-skill",
          installState: "installed",
          installedAt: 1,
          updatedAt: 3,
        },
        {
          slug: "builtin-skill",
          displayName: "Builtin Skill",
          version: "1",
          source: "builtin",
          origin: "builtin",
          libraryPath: "/builtin/builtin-skill",
          installState: "installed",
          installedAt: 1,
          updatedAt: 4,
        },
      ],
    });

    expect(repository.get("hub-skill")).toMatchObject({
      displayName: "Hub Skill",
      source: "installed",
      origin: "skillhub",
    });
    expect(repository.get("custom-skill")).toMatchObject({
      source: "custom",
      origin: "filesystem",
    });
    expect(repository.get("builtin-skill")?.source).toBe("builtin");
  });

  it("writes canonical versioned library, mount, and target documents", () => {
    const storage = new MemoryJsonStorage();
    const library = new SkillLibraryRepository({ storage });
    const mounts = new SkillMountRepository(storage);
    const targets = new SkillTargetRepository(storage);

    library.set({
      slug: "review",
      displayName: "Review",
      version: "local",
      source: "installed",
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
      status: "mounted",
    });
    targets.set({ providerId: "codex", skillDir: "/targets", updatedAt: 3 });

    expect(storage.documents.get("skills.library")).toMatchObject({
      version: 1,
      entries: { review: { origin: "filesystem" } },
    });
    expect(storage.documents.get("skills.mounts")).toEqual({
      version: 1,
      mounts: [expect.objectContaining({ providerId: "codex", skillSlug: "review" })],
    });
    expect(storage.documents.get("skills.targets")).toEqual({
      version: 1,
      targets: {
        codex: { providerId: "codex", skillDir: "/targets", updatedAt: 3 },
      },
    });
  });

  it("reads legacy unversioned mount and target documents", () => {
    const storage = new MemoryJsonStorage();
    storage.documents.set("skills.mounts", [
      {
        providerId: "codex",
        skillSlug: "review",
        enabled: true,
        sourcePath: "/skills/review",
        targetPath: "/targets/review",
        mountModeResolved: "symlink",
        status: "mounted",
      },
    ]);
    storage.documents.set("skills.targets", {
      codex: { providerId: "codex", skillDir: "/targets", updatedAt: 1 },
    });

    expect(new SkillMountRepository(storage).list()).toHaveLength(1);
    expect(new SkillTargetRepository(storage).get("codex")?.skillDir).toBe("/targets");
  });
});

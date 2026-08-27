import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";

describe("SkillLibraryRepo", () => {
  let tempDir: string;
  let repo: SkillLibraryRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skill-library-repo-"));
    repo = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      builtinRoot: join(tempDir, "state", "skills", "builtin"),
      managedLibraryRoot: join(tempDir, "state", "skills", "library"),
      customSkillRoot: join(tempDir, "state", "skills", "custom"),
      externalSkillRoots: [],
    });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists library entries across repo instances", () => {
    repo.set({
      slug: "code-review",
      displayName: "Code Review",
      description: "Review code changes before merge",
      version: "1.2.3",
      source: "skillhub",
      libraryPath: "/skills/library/code-review",
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
    });

    const reloaded = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      builtinRoot: join(tempDir, "state", "skills", "builtin"),
      managedLibraryRoot: join(tempDir, "state", "skills", "library"),
      customSkillRoot: join(tempDir, "state", "skills", "custom"),
      externalSkillRoots: [],
    });
    expect(reloaded.get("code-review")).toMatchObject({
      slug: "code-review",
      displayName: "Code Review",
      version: "1.2.3",
    });
  });

  it("includes skills discovered in local skill roots", async () => {
    const skillsRoot = join(tempDir, "agents-skills");
    const localSkillDir = join(skillsRoot, "code-review");
    await mkdir(localSkillDir, { recursive: true });
    await mkdir(join(skillsRoot, "ignored"), { recursive: true });
    await writeFile(
      join(localSkillDir, "SKILL.md"),
      [
        "---",
        "name: code-review",
        "description: Review code changes before merge",
        "---",
        "",
        "# Code Review",
        "",
      ].join("\n"),
      "utf8"
    );

    const scannedRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      builtinRoot: join(tempDir, "state", "skills", "builtin"),
      managedLibraryRoot: join(tempDir, "state", "skills", "library"),
      customSkillRoot: join(tempDir, "state", "skills", "custom"),
      externalSkillRoots: [skillsRoot],
    });

    expect(scannedRepo.get("code-review")).toMatchObject({
      slug: "code-review",
      displayName: "Code Review",
      description: "Review code changes before merge",
      source: "installed",
      origin: "filesystem",
      version: "local",
      installState: "installed",
      libraryPath: localSkillDir,
    });
    expect(scannedRepo.get("ignored")).toBeUndefined();
    expect(scannedRepo.list()).toEqual([
      expect.objectContaining({
        slug: "code-review",
        displayName: "Code Review",
        source: "installed",
      }),
    ]);
  });

  it("normalizes persisted entries inside the custom root to custom filesystem skills", async () => {
    const customRoot = join(tempDir, "state", "skills", "custom");
    const customSkillDir = join(customRoot, "code-review");
    await mkdir(customSkillDir, { recursive: true });
    await writeFile(
      join(customSkillDir, "SKILL.md"),
      ["---", "name: code-review", "description: Custom copy", "---", "", "# Custom", ""].join(
        "\n"
      ),
      "utf8"
    );

    await writeFile(
      join(tempDir, "library.json"),
      JSON.stringify({
        version: 1,
        entries: {
          "code-review": {
            slug: "code-review",
            displayName: "Code Review",
            description: "Custom copy",
            version: "1",
            source: "local",
            libraryPath: customSkillDir,
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
        },
      }),
      "utf8"
    );

    const reloaded = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      builtinRoot: join(tempDir, "state", "skills", "builtin"),
      managedLibraryRoot: join(tempDir, "state", "skills", "library"),
      customSkillRoot: customRoot,
      externalSkillRoots: [],
    });

    expect(reloaded.get("code-review")).toMatchObject({
      source: "custom",
      origin: "filesystem",
      libraryPath: customSkillDir,
    });
  });

  it("keeps managed installed entries ahead of matching external filesystem scans", async () => {
    const externalRoot = join(tempDir, "external");
    const skillDir = join(externalRoot, "code-review");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      ["---", "name: code-review", "description: External copy", "---", "", "# External", ""].join(
        "\n"
      ),
      "utf8"
    );

    repo.set({
      slug: "code-review",
      registryRef: "mattpocock/skills@code-review",
      displayName: "Code Review",
      description: "Managed copy",
      version: "12daafb9c4f77deb3c3303dc2e6f8a3c2a0ff7928fc004af959ba18b8bd38068",
      source: "installed",
      origin: "skills-sh",
      libraryPath: join(tempDir, "state", "skills", "library", "code-review"),
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
    });

    const scannedRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      builtinRoot: join(tempDir, "state", "skills", "builtin"),
      managedLibraryRoot: join(tempDir, "state", "skills", "library"),
      customSkillRoot: join(tempDir, "state", "skills", "custom"),
      externalSkillRoots: [externalRoot],
    });

    expect(scannedRepo.get("code-review")).toMatchObject({
      source: "installed",
      origin: "skills-sh",
      registryRef: "mattpocock/skills@code-review",
      description: "Managed copy",
    });
  });

  it("normalizes legacy local entries to installed filesystem when no custom root is configured", async () => {
    const legacyRoot = join(tempDir, "legacy-skills");
    const legacySkillDir = join(legacyRoot, "code-review");
    await mkdir(legacySkillDir, { recursive: true });
    await writeFile(
      join(tempDir, "library.json"),
      JSON.stringify({
        version: 1,
        entries: {
          "code-review": {
            slug: "code-review",
            displayName: "Code Review",
            description: "Legacy local copy",
            version: "1",
            source: "local",
            libraryPath: legacySkillDir,
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
        },
      }),
      "utf8"
    );

    const repoWithoutCustomRoot = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      localSkillRoots: [legacyRoot],
    });

    expect(repoWithoutCustomRoot.get("code-review")).toMatchObject({
      source: "installed",
      origin: "filesystem",
      libraryPath: legacySkillDir,
    });
  });

  it("treats sibling paths that merely share the custom prefix as installed filesystem skills", async () => {
    const customRoot = join(tempDir, "state", "skills", "custom");
    const siblingRoot = join(tempDir, "state", "skills", "custom-shadow");
    const siblingSkillDir = join(siblingRoot, "code-review");
    await mkdir(siblingSkillDir, { recursive: true });
    await writeFile(
      join(tempDir, "library.json"),
      JSON.stringify({
        version: 1,
        entries: {
          "code-review": {
            slug: "code-review",
            displayName: "Code Review",
            description: "Sibling copy",
            version: "1",
            source: "local",
            libraryPath: siblingSkillDir,
            installState: "installed",
            installedAt: 1,
            updatedAt: 2,
          },
        },
      }),
      "utf8"
    );

    const repoWithCustomRoot = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      customSkillRoot: customRoot,
    });

    expect(repoWithCustomRoot.get("code-review")).toMatchObject({
      source: "installed",
      origin: "filesystem",
      libraryPath: siblingSkillDir,
    });
  });
});

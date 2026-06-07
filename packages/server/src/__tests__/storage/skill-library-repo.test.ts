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
    repo = new SkillLibraryRepo({ filePath: join(tempDir, "library.json") });
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

    const reloaded = new SkillLibraryRepo({ filePath: join(tempDir, "library.json") });
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
      localSkillRoots: [skillsRoot],
    });

    expect(scannedRepo.get("code-review")).toMatchObject({
      slug: "code-review",
      displayName: "Code Review",
      description: "Review code changes before merge",
      source: "local",
      version: "local",
      installState: "installed",
      libraryPath: localSkillDir,
    });
    expect(scannedRepo.get("ignored")).toBeUndefined();
    expect(scannedRepo.list()).toEqual([
      expect.objectContaining({
        slug: "code-review",
        displayName: "Code Review",
        source: "local",
      }),
    ]);
  });

  it("does not let scanned local skills override persisted built-in entries", async () => {
    const skillsRoot = join(tempDir, "agents-skills");
    const localSkillDir = join(skillsRoot, "coder-studio-automation");
    await mkdir(localSkillDir, { recursive: true });
    await writeFile(
      join(localSkillDir, "SKILL.md"),
      [
        "---",
        "name: coder-studio-automation",
        "description: Local shadow copy",
        "---",
        "",
        "# Local Shadow Copy",
        "",
      ].join("\n"),
      "utf8"
    );

    repo.set({
      slug: "coder-studio-automation",
      displayName: "Coder Studio Automation",
      description: "Built-in automation skill",
      version: "1.0.0",
      source: "builtin",
      libraryPath: join(tempDir, "state", "skills", "builtin", "coder-studio-automation"),
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const scannedRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library.json"),
      localSkillRoots: [skillsRoot],
    });

    expect(scannedRepo.get("coder-studio-automation")).toMatchObject({
      slug: "coder-studio-automation",
      description: "Built-in automation skill",
      source: "builtin",
      libraryPath: join(tempDir, "state", "skills", "builtin", "coder-studio-automation"),
      builtin: { defaultEnabled: true, autoMount: true },
    });
  });
});

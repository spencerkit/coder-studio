import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import "../commands/skills.js";
import { SkillLibraryRepo } from "../storage/repositories/skill-library-repo.js";
import type { CommandContext } from "../ws/dispatch.js";
import { dispatch } from "../ws/dispatch.js";

describe("skills commands", () => {
  let tempDir: string;
  let skillLibraryRepo: SkillLibraryRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skills-command-"));
    skillLibraryRepo = new SkillLibraryRepo({ filePath: join(tempDir, "skill-library.json") });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns skill library entries through dispatch", async () => {
    skillLibraryRepo.set({
      slug: "code-review",
      displayName: "Code Review",
      description: "Review code changes before merge",
      version: "1.2.3",
      source: "installed",
      origin: "skillhub",
      libraryPath: "/skills/library/code-review",
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
    });

    const result = await dispatch(
      {
        kind: "command",
        id: "skills-library-list-1",
        op: "skills.library.list",
        args: {},
      },
      {
        skillLibraryRepo,
        skillMountRepo: {
          listBySkillSlug: () => [],
        } as never,
        skillsHubClient: {} as never,
      } as CommandContext
    );

    expect(result.ok).toBe(true);
    expect(result.data).toEqual([
      expect.objectContaining({
        slug: "code-review",
        displayName: "Code Review",
        version: "1.2.3",
      }),
    ]);
  });
});

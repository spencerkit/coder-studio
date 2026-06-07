import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillTargetRepo } from "../../storage/repositories/skill-target-repo.js";

describe("SkillTargetRepo", () => {
  let tempDir: string;
  let repo: SkillTargetRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skill-target-repo-"));
    repo = new SkillTargetRepo({ filePath: join(tempDir, "targets.json") });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("persists provider skill directories across repo instances", () => {
    repo.set({ providerId: "codex", skillDir: "/skills/codex", updatedAt: 10 });

    const reloaded = new SkillTargetRepo({ filePath: join(tempDir, "targets.json") });
    expect(reloaded.get("codex")).toEqual({
      providerId: "codex",
      skillDir: "/skills/codex",
      updatedAt: 10,
    });
  });
});

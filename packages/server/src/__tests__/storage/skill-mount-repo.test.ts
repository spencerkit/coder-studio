import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";

describe("SkillMountRepo", () => {
  let tempDir: string;
  let repo: SkillMountRepo;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skill-mount-repo-"));
    repo = new SkillMountRepo({ filePath: join(tempDir, "mounts.json") });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("indexes mount relations by provider and slug", () => {
    repo.upsert({
      providerId: "codex",
      skillSlug: "code-review",
      enabled: true,
      sourcePath: "/skills/library/code-review",
      targetPath: "/agents/codex/code-review",
      mountModeResolved: "symlink",
      status: "mounted",
      lastSyncedAt: 100,
    });

    expect(repo.listByProviderId("codex")).toHaveLength(1);
    expect(repo.listBySkillSlug("code-review")).toHaveLength(1);
    expect(repo.countsByProviderId()).toEqual({ codex: 1 });
  });
});

import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createCustomSkill, slugifySkillName } from "../../skills/custom-skill.js";
import { readManagedSkillMarker } from "../../skills/managed-skill-metadata.js";

const tempDirs: string[] = [];

async function createTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "custom-skill-"));
  tempDirs.push(root);
  return root;
}

describe("custom skill helpers", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("slugifies a display name into a stable directory slug", () => {
    expect(slugifySkillName("My Review Skill")).toBe("my-review-skill");
  });

  it("creates <root>/<slug>/SKILL.md with a default template", async () => {
    const rootDir = await createTempRoot();

    const entry = await createCustomSkill({ rootDir, name: "My Review Skill" });

    expect(entry.slug).toBe("my-review-skill");
    expect(entry.source).toBe("custom");
    expect(entry.origin).toBe("filesystem");
    expect(entry.installState).toBe("installed");
    expect(await readFile(join(rootDir, "my-review-skill", "SKILL.md"), "utf8")).toContain(
      "# My Review Skill"
    );
    expect(readManagedSkillMarker(join(rootDir, "my-review-skill"))).toEqual({
      version: 1,
      managedBy: "coder-studio",
      source: "custom",
      slug: "my-review-skill",
    });
  });
});

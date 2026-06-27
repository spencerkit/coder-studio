import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readSkillFile, readSkillTree } from "../../commands/skills/files.js";

const PNG_BYTES = Buffer.from(
  "89504E470D0A1A0A0000000D4948445200000001000000010806000000" +
    "1F15C4890000000A49444154789C63000100000005000157CFC4A30000" +
    "0000049454E44AE426082",
  "hex"
);

const tempDirs: string[] = [];

async function createSkillRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skill-file-io-"));
  tempDirs.push(root);
  await mkdir(join(root, "refs"), { recursive: true });
  await writeFile(join(root, "SKILL.md"), "# My Review Skill\n");
  await writeFile(join(root, "refs", "guide.md"), "guide\n");
  await writeFile(join(root, "pixel.png"), PNG_BYTES);
  return root;
}

describe("skill file helpers", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it("reads a skill tree with root-relative paths", async () => {
    const skillRoot = await createSkillRoot();

    const result = await readSkillTree(skillRoot);

    expect(result.path).toBe(".");
    expect(result.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "refs", kind: "dir" }),
        expect.objectContaining({ path: "SKILL.md", kind: "file" }),
      ])
    );
  });

  it("rejects path escape attempts when reading skill files", async () => {
    const skillRoot = await createSkillRoot();

    await expect(
      readSkillFile("my-review-skill", skillRoot, "../outside.md")
    ).rejects.toMatchObject({
      code: "path_escape",
    });
  });

  it("returns skill image reads with the skill asset URL shape", async () => {
    const skillRoot = await createSkillRoot();

    const result = await readSkillFile("my-review-skill", skillRoot, "pixel.png");

    expect(result).toMatchObject({
      kind: "image",
      mime: "image/png",
      url: "/api/skill-file?skillSlug=my-review-skill&path=pixel.png",
      size: PNG_BYTES.length,
      isTextBacked: false,
    });
  });

  it("includes workspace context in skill image URLs when provided", async () => {
    const skillRoot = await createSkillRoot();

    const result = await readSkillFile("my-review-skill", skillRoot, "pixel.png", {
      workspaceId: "ws-1",
    });

    expect(result).toMatchObject({
      kind: "image",
      url: "/api/skill-file?workspaceId=ws-1&skillSlug=my-review-skill&path=pixel.png",
    });
  });
});

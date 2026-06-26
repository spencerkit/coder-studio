import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  scanDiscoveredSkillEntries,
  scanLocalSkillEntries,
} from "../../skills/local-skill-scanner.js";

describe("local skill scanner", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "local-skill-scanner-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("treats the canonical custom root as custom filesystem skills", async () => {
    const externalRoot = join(tempDir, "external");
    const customRoot = join(tempDir, "custom");
    const slug = "code-review";
    const externalSkillDir = join(externalRoot, slug);
    const customSkillDir = join(customRoot, slug);

    await mkdir(externalSkillDir, { recursive: true });
    await mkdir(customSkillDir, { recursive: true });
    await writeFile(
      join(externalSkillDir, "SKILL.md"),
      ["---", "name: code-review", "description: External copy", "---", "", "# External", ""].join(
        "\n"
      ),
      "utf8"
    );
    await writeFile(
      join(customSkillDir, "SKILL.md"),
      ["---", "name: code-review", "description: Custom copy", "---", "", "# Custom", ""].join(
        "\n"
      ),
      "utf8"
    );

    expect(
      scanDiscoveredSkillEntries({
        customRoot,
        externalRoots: [externalRoot],
      })
    ).toEqual([
      expect.objectContaining({
        slug,
        description: "Custom copy",
        source: "custom",
        origin: "filesystem",
        libraryPath: customSkillDir,
      }),
    ]);
  });

  it("marks filesystem skills outside the custom root as installed", async () => {
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

    expect(scanLocalSkillEntries([externalRoot])).toEqual([
      expect.objectContaining({
        slug: "code-review",
        source: "installed",
        origin: "filesystem",
      }),
    ]);
  });

  it("skips managed mirrors discovered under external roots", async () => {
    const externalRoot = join(tempDir, "external");
    const skillDir = join(externalRoot, "coder-studio-open");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: coder-studio-open",
        "description: Mirror copy",
        "---",
        "",
        "# Mirror",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(skillDir, ".coder-studio-skill.json"),
      JSON.stringify({
        version: 1,
        managedBy: "coder-studio",
        source: "builtin",
        slug: "coder-studio-open",
      }),
      "utf8"
    );

    expect(scanLocalSkillEntries([externalRoot])).toEqual([]);
  });

  it("skips managed custom mirrors discovered under external roots", async () => {
    const externalRoot = join(tempDir, "external");
    const skillDir = join(externalRoot, "coder-studio-open");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      [
        "---",
        "name: coder-studio-open",
        "description: Mirror copy",
        "---",
        "",
        "# Mirror",
        "",
      ].join("\n"),
      "utf8"
    );
    await writeFile(
      join(skillDir, ".coder-studio-skill.json"),
      JSON.stringify({
        version: 1,
        managedBy: "coder-studio",
        source: "custom",
        slug: "coder-studio-open",
      }),
      "utf8"
    );

    expect(scanLocalSkillEntries([externalRoot])).toEqual([]);
  });
});

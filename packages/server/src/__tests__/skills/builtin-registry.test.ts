import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { materializeBuiltinSkills } from "../../skills/builtin/materialize.js";
import { BUILTIN_SKILLS } from "../../skills/builtin/registry.js";

describe("builtin skills", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("declares the MVP built-in skills with stable defaults", () => {
    expect(BUILTIN_SKILLS.map((skill) => skill.slug)).toEqual([
      "coder-studio-automation",
      "coder-studio-browser-verification",
      "coder-studio-review",
    ]);
    expect(BUILTIN_SKILLS.find((skill) => skill.slug === "coder-studio-automation")).toMatchObject({
      defaultEnabled: true,
      autoMountInMvp: true,
    });
    expect(
      BUILTIN_SKILLS.find((skill) => skill.slug === "coder-studio-browser-verification")
    ).toMatchObject({
      defaultEnabled: true,
      autoMountInMvp: false,
    });
  });

  it("materializes built-in SKILL.md files into the state directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-skills-"));

    const entries = await materializeBuiltinSkills({
      builtinRoot: tempDir,
      now: () => 1234,
    });

    expect(entries).toHaveLength(3);
    expect(entries[0]).toMatchObject({
      source: "builtin",
      installState: "installed",
      installedAt: 1234,
      updatedAt: 1234,
    });

    const automation = entries.find((entry) => entry.slug === "coder-studio-automation");
    expect(automation).toBeDefined();
    expect(await readFile(join(automation!.libraryPath, "SKILL.md"), "utf8")).toContain(
      "coder-studio identify --json"
    );
  });
});

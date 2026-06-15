import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODER_STUDIO_MEMORY_SKILL } from "../../skills/builtin/definitions/coder-studio-memory.js";
import { CODER_STUDIO_OPEN_SKILL } from "../../skills/builtin/definitions/coder-studio-open.js";
import { BUILTIN_SKILLS } from "../../skills/builtin/definitions/index.js";
import type { BuiltinSkillDefinition } from "../../skills/builtin/definitions/types.js";
import { materializeBuiltinSkills } from "../../skills/builtin/materialize.js";

const TEST_BUILTIN_SKILL: BuiltinSkillDefinition = {
  slug: "coder-studio-example-builtin",
  displayName: "Coder Studio Example Builtin",
  description: "Test fixture for built-in skill materialization.",
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: false,
  content: [
    "---",
    "name: coder-studio-example-builtin",
    "description: Test fixture for built-in skill materialization.",
    "---",
    "",
    "# Example Builtin",
    "",
    "Use this fixture only in tests.",
    "",
  ].join("\n"),
};

describe("builtin skills", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("declares the Coder Studio open skill as an auto-mounted built-in", () => {
    expect(CODER_STUDIO_OPEN_SKILL).toMatchObject({
      slug: "coder-studio-open",
      displayName: "Coder Studio Open",
      description: "Open workspace files and localhost URLs in Coder Studio.",
      version: "1.0.0",
      defaultEnabled: true,
      autoMountInMvp: true,
    });
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain("name: coder-studio-open");
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain("coder-studio ui open-file");
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain("coder-studio ui open-url");
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain("coder-studio ui close-file");
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain("coder-studio ui close-url");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("coder-studio ui show-panel");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("coder-studio ui run-command");
    expect(BUILTIN_SKILLS).toContain(CODER_STUDIO_OPEN_SKILL);
  });

  it("declares the workspace memory skill as default enabled and auto-mounted", () => {
    expect(CODER_STUDIO_MEMORY_SKILL).toMatchObject({
      slug: "coder-studio-memory",
      displayName: "Coder Studio Memory",
      defaultEnabled: true,
      autoMountInMvp: true,
    });
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain("coder-studio memory list");
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain("coder-studio memory search");
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain("coder-studio memory add");
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Read workspace memory when you need to understand the project or context better, recover debugging information, verify commands or conventions, or review durable notes before making changes."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Write memory when you learn something durable that should help a future session, such as a confirmed project rule, a stable debugging conclusion, a reusable command, a repository convention, a technical constraint, a real follow-up todo, or an important feature constraint."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Use `feature` for product behavior, `todo` for pending work, `bugfix` for defects, `project` for repository-operating knowledge, and `note` only as a fallback."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      'coder-studio memory add --workspace <workspace-id> --type project --content "This workspace uses pnpm for package scripts." --skill coder-studio-memory --json'
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--tag");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--type decision");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--title");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("mem_");
    expect(BUILTIN_SKILLS).toContain(CODER_STUDIO_MEMORY_SKILL);
  });

  it("materializes built-in SKILL.md files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-memory-"));

    const entries = await materializeBuiltinSkills({
      builtinRoot: tempDir,
      now: () => 1234,
    });

    const openEntry = entries.find((entry) => entry.slug === "coder-studio-open");
    expect(openEntry).toMatchObject({
      slug: "coder-studio-open",
      source: "builtin",
      installState: "installed",
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const openContent = await readFile(join(openEntry!.libraryPath, "SKILL.md"), "utf8");
    expect(openContent).toContain("name: coder-studio-open");
    expect(openContent).toContain("coder-studio ui open-file");
    expect(openContent).toContain("coder-studio ui open-url");

    const memoryEntry = entries.find((entry) => entry.slug === "coder-studio-memory");
    expect(memoryEntry).toMatchObject({
      slug: "coder-studio-memory",
      source: "builtin",
      installState: "installed",
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const content = await readFile(join(memoryEntry!.libraryPath, "SKILL.md"), "utf8");
    expect(content).toContain("name: coder-studio-memory");
    expect(content).toContain(
      "Read workspace memory when you need to understand the project or context better"
    );
    expect(content).not.toContain("Actual workspace memory");
  });

  it("materializes provided built-in SKILL.md files into the state directory", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-skills-"));

    const entries = await materializeBuiltinSkills({
      builtinRoot: tempDir,
      now: () => 1234,
      skills: [TEST_BUILTIN_SKILL],
    });

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      source: "builtin",
      installState: "installed",
      installedAt: 1234,
      updatedAt: 1234,
    });

    const exampleBuiltin = entries.find((entry) => entry.slug === "coder-studio-example-builtin");
    expect(exampleBuiltin).toBeDefined();
    const content = await readFile(join(exampleBuiltin!.libraryPath, "SKILL.md"), "utf8");
    expect(content).toContain("coder-studio-example-builtin");
    expect(content).toContain("Use this fixture only in tests.");
  });
});

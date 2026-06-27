import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN,
  AUTOMATION_CMD_FILE_NAME,
  BUILTIN_AUTOMATION_BRIDGE_SOURCE,
} from "../../skills/builtin/automation-bridge.js";
import { CODER_STUDIO_CANVAS_SKILL } from "../../skills/builtin/definitions/coder-studio-canvas.js";
import { CODER_STUDIO_MEMORY_SKILL } from "../../skills/builtin/definitions/coder-studio-memory.js";
import { CODER_STUDIO_OPEN_SKILL } from "../../skills/builtin/definitions/coder-studio-open.js";
import { CODER_STUDIO_SESSION_ACTIVITY_SKILL } from "../../skills/builtin/definitions/coder-studio-session-activity.js";
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

const TEST_AUTOMATION_BUILTIN_SKILL = {
  slug: "coder-studio-automation-builtin",
  displayName: "Coder Studio Automation Builtin",
  description: "Test fixture for built-in automation bridge materialization.",
  version: "1.0.0",
  defaultEnabled: true,
  autoMountInMvp: false,
  mountRendering: "automation_bridge",
  content: [
    "---",
    "name: coder-studio-automation-builtin",
    "description: Uses a shared automation bridge.",
    "---",
    "",
    `Run \`node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}"\` after mount.`,
    "",
  ].join("\n"),
  files: [
    {
      relativePath: AUTOMATION_CMD_FILE_NAME,
      content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
    },
  ],
} satisfies BuiltinSkillDefinition;

function extractFrontmatterDescription(content: string): string | null {
  const frontmatterMatch = content.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/);
  if (!frontmatterMatch?.[1]) {
    return null;
  }

  for (const line of frontmatterMatch[1].split(/\r?\n/)) {
    const descriptionMatch = line.match(/^description:\s*(.+)$/);
    if (descriptionMatch?.[1]) {
      return descriptionMatch[1].trim();
    }
  }

  return null;
}

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
      description:
        "Use when an agent running inside Coder Studio needs to open or close a workspace file, open or close a localhost URL, or open a canvas for the user.",
      version: "1.0.0",
      defaultEnabled: true,
      autoMountInMvp: true,
      mountRendering: "automation_bridge",
      files: [{ relativePath: AUTOMATION_CMD_FILE_NAME }],
    });
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain("name: coder-studio-open");
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-file`
    );
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-url`
    );
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.close-file`
    );
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.close-url`
    );
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("coder-studio ui open-file");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("coder-studio ui open-url");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("coder-studio ui show-panel");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("coder-studio ui run-command");
    expect(CODER_STUDIO_OPEN_SKILL.files).toEqual([
      {
        relativePath: AUTOMATION_CMD_FILE_NAME,
        content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
      },
    ]);
    expect(BUILTIN_SKILLS).toContain(CODER_STUDIO_OPEN_SKILL);
  });

  it("keeps built-in skill metadata descriptions in sync with SKILL.md frontmatter", () => {
    for (const skill of BUILTIN_SKILLS) {
      expect(extractFrontmatterDescription(skill.content)).toBe(skill.description);
    }
  });

  it("limits the open skill canvas surface to ui.open-canvas only", () => {
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-canvas`
    );
    expect(CODER_STUDIO_OPEN_SKILL.content).toContain(
      "open or close a workspace file, open or close a localhost URL, or open a canvas tab"
    );
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("ui.close-canvas");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain("close a canvas");
    expect(CODER_STUDIO_OPEN_SKILL.content).not.toContain(
      "close a workspace file, localhost URL, or canvas tab"
    );
  });

  it("declares the workspace memory skill as default enabled and auto-mounted", () => {
    expect(CODER_STUDIO_MEMORY_SKILL).toMatchObject({
      slug: "coder-studio-memory",
      displayName: "Coder Studio Memory",
      defaultEnabled: true,
      autoMountInMvp: true,
      mountRendering: "automation_bridge",
      files: [{ relativePath: AUTOMATION_CMD_FILE_NAME }],
    });
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" memory.list`
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" memory.search`
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" memory.create`
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Read workspace memory when you need to understand the project or context better, recover debugging information, verify commands or conventions, or review durable notes before making changes."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Write memory when you learn something durable that should help a future session, such as a confirmed project rule, a stable debugging conclusion, a reusable command, a repository convention, a technical constraint, a real follow-up todo, or an important feature constraint."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Use `wiki` for durable project knowledge, `issue` for defects or verification items, `todo` for concrete follow-up work, and `note` only as a fallback."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      "Status applies only to `issue` and `todo` memories. Use `not_started`, `in_progress`, `pending_verification`, or `completed` when the memory tracks work state."
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      'memory.create --type wiki --content "This workspace uses pnpm for package scripts." --skill coder-studio-memory --json'
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).toContain(
      'memory.create --type issue --content "Verify release notes before publishing." --status pending_verification --skill coder-studio-memory --json'
    );
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("memory add");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("coder-studio memory");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--tag");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--type decision");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--type project");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("Use `feature`");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("--title");
    expect(CODER_STUDIO_MEMORY_SKILL.content).not.toContain("mem_");
    expect(CODER_STUDIO_MEMORY_SKILL.files).toEqual([
      {
        relativePath: AUTOMATION_CMD_FILE_NAME,
        content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
      },
    ]);
    expect(BUILTIN_SKILLS).toContain(CODER_STUDIO_MEMORY_SKILL);
  });

  it("declares the Coder Studio canvas skill as an auto-mounted built-in", () => {
    expect(CODER_STUDIO_CANVAS_SKILL).toMatchObject({
      slug: "coder-studio-canvas",
      displayName: "Coder Studio Canvas",
      version: "1.0.0",
      defaultEnabled: true,
      autoMountInMvp: true,
      mountRendering: "automation_bridge",
      files: [{ relativePath: AUTOMATION_CMD_FILE_NAME }],
    });
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" canvas.create`
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" canvas.update`
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" canvas.render`
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-file --path .coder-studio/canvases/<title-slug>.csc --json`
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" canvas.render --source-path .coder-studio/canvases/<title-slug>.csc --json`
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" ui.open-canvas --canvas <canvas-id> --json`
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain('"version": 1');
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      "raw HTML like `<div>` or `<span>` is invalid in canvas source"
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).toContain(
      "readable `.coder-studio/canvases/<title-slug>.csc` paths"
    );
    expect(CODER_STUDIO_CANVAS_SKILL.content).not.toContain("coder-studio canvas create");
    expect(CODER_STUDIO_CANVAS_SKILL.content).not.toContain("coder-studio ui open-file");
    expect(CODER_STUDIO_CANVAS_SKILL.content).not.toContain(
      ".coder-studio/canvases/<canvas-id>.canvas.json"
    );
    expect(CODER_STUDIO_CANVAS_SKILL.files).toEqual([
      {
        relativePath: AUTOMATION_CMD_FILE_NAME,
        content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
      },
    ]);
    expect(BUILTIN_SKILLS).toContain(CODER_STUDIO_CANVAS_SKILL);
  });

  it("declares the session activity skill as an auto-mounted built-in", () => {
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL).toMatchObject({
      slug: "coder-studio-session-activity",
      displayName: "Coder Studio Session Activity",
      description:
        "Record structured session activity for meaningful milestones during a coding session.",
      version: "1.0.0",
      defaultEnabled: true,
      autoMountInMvp: true,
      mountRendering: "automation_bridge",
      files: [{ relativePath: AUTOMATION_CMD_FILE_NAME }],
    });
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      "name: coder-studio-session-activity"
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain("session.activity.record");
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain("session.activity.list");
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      "record structured session activity"
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      "meaningful milestones, not trivial noise"
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.record --kind plan_update`
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.record --kind command_finish`
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.record --kind edit_finish --files`
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.content).toContain(
      `node "${AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN}" session.activity.list --json`
    );
    expect(CODER_STUDIO_SESSION_ACTIVITY_SKILL.files).toEqual([
      {
        relativePath: AUTOMATION_CMD_FILE_NAME,
        content: BUILTIN_AUTOMATION_BRIDGE_SOURCE,
      },
    ]);
    expect(BUILTIN_SKILLS).toContain(CODER_STUDIO_SESSION_ACTIVITY_SKILL);
  });

  it("materializes built-in SKILL.md files", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-memory-"));

    const entries = await materializeBuiltinSkills({
      builtinRoot: tempDir,
      now: () => 1234,
    });

    expect(entries).toHaveLength(3);

    const openEntry = entries.find((entry) => entry.slug === "coder-studio-open");
    expect(openEntry).toMatchObject({
      slug: "coder-studio-open",
      source: "builtin",
      installState: "installed",
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const openContent = await readFile(join(openEntry!.libraryPath, "SKILL.md"), "utf8");
    expect(openContent).toContain("name: coder-studio-open");
    expect(openContent).toContain(AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN);
    expect(openContent).toContain("ui.open-file");
    expect(openContent).toContain("ui.open-url");
    expect(await readFile(join(openEntry!.libraryPath, AUTOMATION_CMD_FILE_NAME), "utf8")).toBe(
      `${BUILTIN_AUTOMATION_BRIDGE_SOURCE.trimEnd()}\n`
    );

    const memoryEntry = entries.find((entry) => entry.slug === "coder-studio-memory");
    expect(memoryEntry).toMatchObject({
      slug: "coder-studio-memory",
      source: "builtin",
      installState: "installed",
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const content = await readFile(join(memoryEntry!.libraryPath, "SKILL.md"), "utf8");
    expect(content).toContain("name: coder-studio-memory");
    expect(content).toContain(AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN);
    expect(content).toContain("memory.search");
    expect(content).not.toContain("Actual workspace memory");
    expect(await readFile(join(memoryEntry!.libraryPath, AUTOMATION_CMD_FILE_NAME), "utf8")).toBe(
      `${BUILTIN_AUTOMATION_BRIDGE_SOURCE.trimEnd()}\n`
    );

    const canvasEntry = entries.find((entry) => entry.slug === "coder-studio-canvas");
    expect(canvasEntry).toMatchObject({
      slug: "coder-studio-canvas",
      source: "builtin",
      installState: "installed",
      builtin: { defaultEnabled: true, autoMount: true },
    });

    const canvasContent = await readFile(join(canvasEntry!.libraryPath, "SKILL.md"), "utf8");
    expect(canvasContent).toContain(AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN);
    expect(canvasContent).toContain("canvas.create");
    expect(canvasContent).toContain("ui.open-file --path .coder-studio/canvases/<title-slug>.csc");
    expect(canvasContent).toContain(
      "canvas.render --source-path .coder-studio/canvases/<title-slug>.csc"
    );
    expect(canvasContent).toContain("ui.open-canvas --canvas <canvas-id>");
    expect(canvasContent).toContain("readable `.coder-studio/canvases/<title-slug>.csc` paths");
    expect(canvasContent).not.toContain(".coder-studio/canvases/<canvas-id>.canvas.json");
    expect(await readFile(join(canvasEntry!.libraryPath, AUTOMATION_CMD_FILE_NAME), "utf8")).toBe(
      `${BUILTIN_AUTOMATION_BRIDGE_SOURCE.trimEnd()}\n`
    );
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

  it("materializes declared managed files alongside SKILL.md without rewriting placeholders", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-automation-"));

    const entries = await materializeBuiltinSkills({
      builtinRoot: tempDir,
      now: () => 1234,
      skills: [TEST_AUTOMATION_BUILTIN_SKILL],
    });

    expect(entries).toHaveLength(1);

    const skillEntry = entries[0];
    const skillContent = await readFile(join(skillEntry.libraryPath, "SKILL.md"), "utf8");
    const cmdContent = await readFile(
      join(skillEntry.libraryPath, AUTOMATION_CMD_FILE_NAME),
      "utf8"
    );

    expect(skillContent).toContain(AUTOMATION_CMD_ABSOLUTE_PATH_TOKEN);
    expect(skillContent).not.toContain(skillEntry.libraryPath);
    expect(cmdContent).toBe(`${BUILTIN_AUTOMATION_BRIDGE_SOURCE.trimEnd()}\n`);
  });
});

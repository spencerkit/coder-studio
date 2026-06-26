import { describe, expect, it } from "vitest";
import {
  isSkillEditorPath,
  parseSkillEditorPath,
  SKILL_EDITOR_PATH_PREFIX,
  toSkillEditorPath,
} from "./skill-editor-path";

describe("skill editor paths", () => {
  it("builds a stable virtual path from slug and relative path", () => {
    expect(toSkillEditorPath("my-review-skill", "refs/checklist.md")).toBe(
      "skill:my-review-skill/refs/checklist.md"
    );
  });

  it("parses skill virtual paths into slug and relative path", () => {
    expect(parseSkillEditorPath("skill:my-review-skill/SKILL.md")).toEqual({
      skillSlug: "my-review-skill",
      relativePath: "SKILL.md",
    });
    expect(parseSkillEditorPath("skill:my-review-skill/refs/checklist.md")).toEqual({
      skillSlug: "my-review-skill",
      relativePath: "refs/checklist.md",
    });
  });

  it("rejects malformed skill editor paths", () => {
    expect(parseSkillEditorPath("src/app.ts")).toBeNull();
    expect(parseSkillEditorPath(SKILL_EDITOR_PATH_PREFIX)).toBeNull();
    expect(parseSkillEditorPath("skill:missing-relative-path")).toBeNull();
    expect(parseSkillEditorPath("skill:/SKILL.md")).toBeNull();
    expect(parseSkillEditorPath("skill:my-review-skill/")).toBeNull();
  });

  it("detects skill virtual paths", () => {
    expect(isSkillEditorPath("skill:my-review-skill/SKILL.md")).toBe(true);
    expect(isSkillEditorPath("src/app.ts")).toBe(false);
  });
});

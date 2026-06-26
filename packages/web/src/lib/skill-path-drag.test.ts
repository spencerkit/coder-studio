import { describe, expect, it, vi } from "vitest";
import {
  getSkillPathDragPayload,
  hasSkillPathDragType,
  SKILL_PATH_DRAG_MIME,
  setSkillPathDragData,
  toSkillDragEditorPath,
} from "./skill-path-drag";

describe("skill-path-drag", () => {
  it("writes the custom mime payload and plain text absolute path", () => {
    const setData = vi.fn();
    const dataTransfer = {
      effectAllowed: "none",
      setData,
    } as unknown as DataTransfer;

    setSkillPathDragData(dataTransfer, {
      skillSlug: "my-review-skill",
      path: "refs/guide.md",
      absolutePath: "/root/.agents/skills/my-review-skill/refs/guide.md",
      kind: "file",
    });

    expect(dataTransfer.effectAllowed).toBe("copy");
    expect(setData).toHaveBeenNthCalledWith(
      1,
      SKILL_PATH_DRAG_MIME,
      JSON.stringify({
        skillSlug: "my-review-skill",
        path: "refs/guide.md",
        absolutePath: "/root/.agents/skills/my-review-skill/refs/guide.md",
        kind: "file",
      })
    );
    expect(setData).toHaveBeenNthCalledWith(
      2,
      "text/plain",
      "/root/.agents/skills/my-review-skill/refs/guide.md"
    );
  });

  it("reads a valid payload only when the custom mime type is present", () => {
    const dataTransfer = {
      types: [SKILL_PATH_DRAG_MIME, "text/plain"],
      getData: vi.fn((type: string) =>
        type === SKILL_PATH_DRAG_MIME
          ? JSON.stringify({
              skillSlug: "my-review-skill",
              path: "SKILL.md",
              absolutePath: "/root/.agents/skills/my-review-skill/SKILL.md",
              kind: "file",
            })
          : "/root/.agents/skills/my-review-skill/SKILL.md"
      ),
    } as unknown as DataTransfer;

    expect(hasSkillPathDragType(dataTransfer)).toBe(true);
    expect(getSkillPathDragPayload(dataTransfer)).toEqual({
      skillSlug: "my-review-skill",
      path: "SKILL.md",
      absolutePath: "/root/.agents/skills/my-review-skill/SKILL.md",
      kind: "file",
    });
  });

  it("returns null for invalid payloads", () => {
    expect(
      getSkillPathDragPayload({
        types: [SKILL_PATH_DRAG_MIME],
        getData: () => "{bad json",
      } as unknown as DataTransfer)
    ).toBeNull();

    expect(
      getSkillPathDragPayload({
        types: [SKILL_PATH_DRAG_MIME],
        getData: () =>
          JSON.stringify({
            skillSlug: "my-review-skill",
            path: "",
            absolutePath: "/root/.agents/skills/my-review-skill",
            kind: "dir",
          }),
      } as unknown as DataTransfer)
    ).toBeNull();
  });

  it("derives a skill editor path only for file payloads", () => {
    expect(
      toSkillDragEditorPath({
        skillSlug: "my-review-skill",
        path: "refs/guide.md",
        absolutePath: "/root/.agents/skills/my-review-skill/refs/guide.md",
        kind: "file",
      })
    ).toBe("skill:my-review-skill/refs/guide.md");

    expect(
      toSkillDragEditorPath({
        skillSlug: "my-review-skill",
        path: ".",
        absolutePath: "/root/.agents/skills/my-review-skill",
        kind: "dir",
      })
    ).toBeNull();
  });
});

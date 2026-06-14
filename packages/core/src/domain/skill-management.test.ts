import type { SkillRecommendationEntry } from "./skill-management.js";
import {
  isSkillMountStatus,
  SKILL_INSTALL_STATES,
  SKILL_LIBRARY_ITEM_STATES,
  SKILL_LIBRARY_SOURCES,
  SKILL_MOUNT_STATUSES,
  SKILL_TARGET_HEALTH_STATES,
  SKILL_VERSION_CHECK_STATUSES,
} from "./skill-management.js";

describe("skill management domain", () => {
  it("exports stable install states", () => {
    expect(SKILL_INSTALL_STATES).toEqual(["installed", "installing", "failed"]);
  });

  it("exports stable library summary states", () => {
    expect(SKILL_LIBRARY_ITEM_STATES).toEqual([
      "unmounted",
      "partially_mounted",
      "fully_mounted",
      "error",
    ]);
  });

  it("exports stable skill library sources", () => {
    expect(SKILL_LIBRARY_SOURCES).toEqual(["skillhub", "local", "builtin"]);
  });

  it("exports stable mount statuses", () => {
    expect(SKILL_MOUNT_STATUSES).toEqual([
      "mounted",
      "stale",
      "missing_target",
      "missing_source",
      "failed",
    ]);
  });

  it("exports stable skill version check statuses", () => {
    expect(SKILL_VERSION_CHECK_STATUSES).toEqual([
      "up_to_date",
      "update_available",
      "unknown",
      "error",
    ]);
  });

  it("exports stable target health states", () => {
    expect(SKILL_TARGET_HEALTH_STATES).toEqual(["healthy", "warning", "error", "unconfigured"]);
  });

  it("recognizes supported mount statuses only", () => {
    expect(isSkillMountStatus("mounted")).toBe(true);
    expect(isSkillMountStatus("failed")).toBe(true);
    expect(isSkillMountStatus("unknown")).toBe(false);
  });

  it("exports a stable skill recommendation entry shape", () => {
    const entry: SkillRecommendationEntry = {
      slug: "code-review",
      displayName: "Code Review",
      description: "Reviews code changes",
      reason: "Matches the workspace test workflow",
      sourceQuery: "test workflow",
      score: 42,
      installed: false,
    };

    expect(entry.slug).toBe("code-review");
  });
});

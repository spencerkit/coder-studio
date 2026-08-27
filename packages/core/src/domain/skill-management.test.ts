import type {
  SkillLibraryEntry,
  SkillRecommendationEntry,
  SkillRecommendationPage,
} from "./skill-management.js";
import {
  isSkillMountStatus,
  SKILL_INSTALL_STATES,
  SKILL_LIBRARY_ITEM_STATES,
  SKILL_LIBRARY_ORIGINS,
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
    expect(SKILL_LIBRARY_SOURCES).toEqual(["builtin", "installed", "custom"]);
  });

  it("exports stable skill library origins", () => {
    expect(SKILL_LIBRARY_ORIGINS).toEqual(["builtin", "skillhub", "skills-sh", "filesystem"]);
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

  it("exports a stable skill recommendation page shape", () => {
    const page: SkillRecommendationPage = {
      entries: [
        {
          slug: "code-review",
          displayName: "Code Review",
          description: "Reviews code changes",
          reason: "Matches the workspace test workflow",
          sourceQuery: "test workflow",
          score: 42,
          installed: false,
        },
      ],
      hasMore: true,
    };

    expect(page.entries[0]?.slug).toBe("code-review");
    expect(page.hasMore).toBe(true);
  });

  it("exports a stable skill library entry shape with optional origin", () => {
    const entry: SkillLibraryEntry = {
      slug: "code-review",
      displayName: "Code Review",
      description: "Reviews code changes",
      version: "1.0.0",
      source: "installed",
      origin: "skillhub",
      libraryPath: "/skills/code-review",
      installState: "installed",
      installedAt: 1,
      updatedAt: 2,
    };

    expect(entry.source).toBe("installed");
    expect(entry.origin).toBe("skillhub");
  });
});

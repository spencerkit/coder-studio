import {
  isSkillMountStatus,
  SKILL_INSTALL_STATES,
  SKILL_LIBRARY_ITEM_STATES,
  SKILL_MOUNT_STATUSES,
  SKILL_TARGET_HEALTH_STATES,
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

  it("exports stable mount statuses", () => {
    expect(SKILL_MOUNT_STATUSES).toEqual([
      "mounted",
      "stale",
      "missing_target",
      "missing_source",
      "failed",
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
});

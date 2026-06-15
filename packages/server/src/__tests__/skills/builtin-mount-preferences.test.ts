import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BuiltinSkillMountPreferences } from "../../skills/builtin/mount-preferences.js";
import { SettingsRepo } from "../../storage/repositories/settings-repo.js";

describe("BuiltinSkillMountPreferences", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  async function createPreferences() {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-mount-preferences-"));
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });

    return {
      settingsRepo,
      preferences: new BuiltinSkillMountPreferences(settingsRepo),
    };
  }

  it("marks disabled mounts as skipped even for auto-mounted built-ins", async () => {
    const { preferences } = await createPreferences();

    preferences.setMountEnabled("codex", "coder-studio-open", false);

    expect(preferences.getMountDecision("codex", "coder-studio-open", true)).toEqual({
      shouldMount: false,
      reason: "disabled",
    });
    expect(preferences.isMountDisabled("codex", "coder-studio-open")).toBe(true);
  });

  it("requires explicit enable for built-ins that are not auto-mounted in MVP", async () => {
    const { preferences } = await createPreferences();

    expect(preferences.getMountDecision("codex", "example-builtin", false)).toEqual({
      shouldMount: false,
      reason: "not_mvp_auto",
    });

    preferences.setMountEnabled("codex", "example-builtin", true);

    expect(preferences.getMountDecision("codex", "example-builtin", false)).toEqual({
      shouldMount: true,
    });
  });

  it("removes stale skill preference entries from both enabled and disabled maps", async () => {
    const { preferences, settingsRepo } = await createPreferences();

    preferences.setMountEnabled("codex", "old-builtin-skill", false);
    preferences.setMountEnabled("claude", "old-builtin-skill", true);
    preferences.setMountEnabled("codex", "keep-me", false);

    preferences.removeSkill("old-builtin-skill");

    expect(settingsRepo.get("skills.builtin.disabledMounts")).toEqual({
      "codex:keep-me": true,
    });
    expect(settingsRepo.get("skills.builtin.enabledMounts")).toEqual({});
  });
});

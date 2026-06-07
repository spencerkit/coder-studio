import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProviderDefinition } from "@coder-studio/core";
import { afterEach, describe, expect, it } from "vitest";
import { BuiltinSkillSyncManager } from "../../skills/builtin/sync-manager.js";
import { SkillMountManager } from "../../skills/mount-manager.js";
import { SettingsRepo } from "../../storage/repositories/settings-repo.js";
import { SkillLibraryRepo } from "../../storage/repositories/skill-library-repo.js";
import { SkillMountRepo } from "../../storage/repositories/skill-mount-repo.js";

function provider(id: string, skillDir?: string): ProviderDefinition {
  return {
    id,
    displayName: id,
    badge: id,
    kind: "built_in",
    capability: "full",
    capabilities: [],
    install: {
      prerequisites: [],
      manualGuideKeys: [],
      docUrls: { provider: "", prerequisites: {} },
      strategies: {},
    },
    buildCommand: () => ({ argv: [id], env: {}, cwd: "/tmp" }),
    configSchema: { parse: (value: unknown) => value } as never,
    defaultConfig: {},
    requiredCommands: [id],
    skillMountDirectories: skillDir ? [skillDir] : undefined,
  };
}

describe("BuiltinSkillSyncManager", () => {
  let tempDir: string | undefined;

  afterEach(async () => {
    if (tempDir) {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("syncs built-ins into the library and mounts MVP defaults", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-sync-"));
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    const result = await manager.sync();

    expect(result.libraryEntries.map((entry) => entry.slug)).toEqual([
      "coder-studio-automation",
      "coder-studio-browser-verification",
      "coder-studio-review",
    ]);
    expect(mountRepo.get("codex", "coder-studio-automation")).toMatchObject({
      enabled: true,
      status: "mounted",
    });
    expect(mountRepo.get("codex", "coder-studio-review")).toMatchObject({
      enabled: true,
      status: "mounted",
    });
    expect(mountRepo.get("codex", "coder-studio-browser-verification")).toBeUndefined();
  });

  it("does not re-mount a user-disabled built-in skill", async () => {
    tempDir = await mkdtemp(join(tmpdir(), "coder-studio-builtin-disabled-"));
    const skillDir = join(tempDir, "codex-skills");
    const providers = [provider("codex", skillDir)];
    const libraryRepo = new SkillLibraryRepo({
      filePath: join(tempDir, "library-index.json"),
    });
    const mountRepo = new SkillMountRepo({
      filePath: join(tempDir, "mounts.json"),
    });
    const settingsRepo = new SettingsRepo({
      filePath: join(tempDir, "settings.json"),
    });
    settingsRepo.set("skills.builtin.disabledMounts", {
      "codex:coder-studio-review": true,
    });
    const mountManager = new SkillMountManager({
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
    });

    const manager = new BuiltinSkillSyncManager({
      builtinRoot: join(tempDir, "builtin"),
      getProviderRegistry: () => providers,
      skillLibraryRepo: libraryRepo,
      skillMountRepo: mountRepo,
      skillMountMgr: mountManager,
      settingsRepo,
      now: () => 1000,
    });

    await manager.sync();

    expect(mountRepo.get("codex", "coder-studio-automation")).toBeDefined();
    expect(mountRepo.get("codex", "coder-studio-review")).toBeUndefined();
  });
});

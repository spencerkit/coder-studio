import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { DesktopUpdateSettingsRepo } from "./desktop-update-settings.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("DesktopUpdateSettingsRepo", () => {
  it("falls back from malformed settings and reports a warning", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-settings-"));
    tempDirs.push(root);
    const settingsPath = join(root, "desktop-update-settings.json");
    await writeFile(settingsPath, "{broken", "utf8");
    const warnings: string[] = [];
    const repo = new DesktopUpdateSettingsRepo({
      filePath: settingsPath,
      onWarning: (value) => warnings.push(value),
    });

    await expect(repo.get()).resolves.toEqual({
      schemaVersion: 1,
      autoCheckEnabled: true,
      checkIntervalSec: 21600,
    });
    expect(warnings[0]).toContain("desktop-update-settings.json");
  });

  it("round-trips validated settings", async () => {
    const root = await mkdtemp(join(tmpdir(), "desktop-update-settings-"));
    tempDirs.push(root);
    const repo = new DesktopUpdateSettingsRepo({
      filePath: join(root, "desktop-update-settings.json"),
    });

    await expect(repo.set({ autoCheckEnabled: false, checkIntervalSec: 43200 })).resolves.toEqual({
      schemaVersion: 1,
      autoCheckEnabled: false,
      checkIntervalSec: 43200,
    });
    await expect(repo.get()).resolves.toMatchObject({
      autoCheckEnabled: false,
      checkIntervalSec: 43200,
    });
  });
});

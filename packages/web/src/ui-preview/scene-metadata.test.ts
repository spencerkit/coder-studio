// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_IDS } from "../theme";
import { UI_PREVIEW_SCENE_METADATA } from "./scene-metadata";

const source = readFileSync(`${process.cwd()}/src/ui-preview/scene-metadata.ts`, "utf8");

describe("ui preview scene metadata", () => {
  it("registers icon-focused scenes for theme review", () => {
    expect(UI_PREVIEW_SCENE_METADATA.map((scene) => scene.id)).toEqual(
      expect.arrayContaining([
        "workspace-icon-review",
        "toast-icon-review",
        "supervisor-icon-review",
      ])
    );
  });

  it("registers the desktop review scene ids", () => {
    expect(UI_PREVIEW_SCENE_METADATA.map((scene) => scene.id)).toEqual(
      expect.arrayContaining([
        "workspace-topbar-review",
        "workspace-sidebar-files-review",
        "workspace-sidebar-git-review",
        "workspace-editor-review",
        "workspace-diff-review",
        "workspace-terminal-empty-review",
        "settings-density-review",
        "settings-light-theme-review",
        "desktop-overlay-review",
        "desktop-statusbar-review",
      ])
    );
  });

  it("covers every built-in theme for route-backed workspace scenes", () => {
    expect(
      UI_PREVIEW_SCENE_METADATA.filter(
        (scene) =>
          scene.source === "real-route" &&
          (scene.id === "workspace-desktop" || scene.id === "workspace-mobile")
      ).map((scene) => scene.themes)
    ).toEqual([[...THEME_IDS], [...THEME_IDS]]);
  });

  it("enumerates concrete theme ids instead of dark/light buckets", () => {
    expect(source).not.toContain('themeIdsForKinds("dark", "light")');
  });

  it("limits the light-theme review scene to desktop light themes", () => {
    const scene = UI_PREVIEW_SCENE_METADATA.find(
      (entry) => entry.id === "settings-light-theme-review"
    );

    expect(scene?.devices).toEqual(["desktop"]);
    expect(scene?.themes.every((theme) => theme.endsWith("-light"))).toBe(true);
  });

  it("captures the mobile settings homepage from the grouped root container", () => {
    const scene = UI_PREVIEW_SCENE_METADATA.find((entry) => entry.id === "settings-mobile-root");

    expect(scene?.capture?.selector).toBe(".settings-mobile-root");
  });
});

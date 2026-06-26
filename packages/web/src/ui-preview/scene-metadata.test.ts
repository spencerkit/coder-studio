// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { THEME_IDS } from "../theme";
import { UI_PREVIEW_SCENE_METADATA } from "./scene-metadata";

describe("ui preview scene metadata", () => {
  it("registers icon-focused scenes for theme review", () => {
    expect(UI_PREVIEW_SCENE_METADATA.map((scene) => scene.id)).toEqual(
      expect.arrayContaining([
        "workspace-icon-review",
        "toast-icon-review",
        "supervisor-icon-review",
        "supervisor-details-tree-review",
      ])
    );
  });

  it("registers the desktop review scene ids", () => {
    expect(UI_PREVIEW_SCENE_METADATA.map((scene) => scene.id)).toEqual(
      expect.arrayContaining([
        "workspace-custom-skills-review",
        "readme-desktop-hero",
        "readme-desktop-review",
        "readme-mobile-progress",
        "footer-update-rail-review",
        "footer-update-rail-confirm-review",
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
    expect(
      UI_PREVIEW_SCENE_METADATA.every(
        (scene) =>
          scene.themes.length > 0 && scene.themes.every((theme) => THEME_IDS.includes(theme))
      )
    ).toBe(true);
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

  it("registers a dedicated monitoring settings review scene", () => {
    const scene = UI_PREVIEW_SCENE_METADATA.find((entry) => entry.id === "settings-monitoring");

    expect(scene?.devices).toEqual(["desktop", "mobile"]);
    expect(scene?.capture?.selector).toBe(".settings-monitoring-shell");
    expect(scene?.description.toLowerCase()).toContain("monitoring");
  });

  it("captures the supervisor details mind map review from the desktop details dialog", () => {
    const scene = UI_PREVIEW_SCENE_METADATA.find(
      (entry) => entry.id === "supervisor-details-tree-review"
    );

    expect(scene?.devices).toEqual(["desktop"]);
    expect(scene?.capture?.selector).toBe(".supervisor-dialog--details");
    expect(scene?.description.toLowerCase()).toContain("zoomable mind map");
    expect(scene?.description.toLowerCase()).toContain("react flow + elk");
  });

  it("captures the README scenes from their full workspace shells", () => {
    const heroScene = UI_PREVIEW_SCENE_METADATA.find((entry) => entry.id === "readme-desktop-hero");
    const reviewScene = UI_PREVIEW_SCENE_METADATA.find(
      (entry) => entry.id === "readme-desktop-review"
    );
    const mobileScene = UI_PREVIEW_SCENE_METADATA.find(
      (entry) => entry.id === "readme-mobile-progress"
    );

    expect(heroScene?.capture?.selector).toBe(".workspace-page");
    expect(reviewScene?.capture?.selector).toBe(".workspace-page");
    expect(mobileScene?.capture?.selector).toBe("[data-testid='mobile-shell']");
  });

  it("registers appearance review coverage for both route-backed settings and workspace shells", () => {
    const ids = UI_PREVIEW_SCENE_METADATA.map((scene) => scene.id);
    const appearanceScene = UI_PREVIEW_SCENE_METADATA.find(
      (scene) => scene.id === "settings-appearance"
    );
    const desktopWorkspaceScene = UI_PREVIEW_SCENE_METADATA.find(
      (scene) => scene.id === "workspace-desktop"
    );
    const mobileWorkspaceScene = UI_PREVIEW_SCENE_METADATA.find(
      (scene) => scene.id === "workspace-mobile"
    );

    expect(ids).toEqual(
      expect.arrayContaining(["settings-appearance", "workspace-desktop", "workspace-mobile"])
    );
    expect(appearanceScene?.source).toBe("real-route");
    expect(appearanceScene?.capture?.settingsSection).toBe("appearance");
    expect(appearanceScene?.description.toLowerCase()).toContain("appearance");
    expect(desktopWorkspaceScene?.source).toBe("real-route");
    expect(desktopWorkspaceScene?.description.toLowerCase()).toContain("appearance");
    expect(mobileWorkspaceScene?.source).toBe("real-route");
    expect(mobileWorkspaceScene?.description.toLowerCase()).toContain("appearance");
  });

  it("registers a dedicated custom skills workspace review scene", () => {
    const scene = UI_PREVIEW_SCENE_METADATA.find(
      (entry) => entry.id === "workspace-custom-skills-review"
    );

    expect(scene?.devices).toEqual(["desktop"]);
    expect(scene?.themes).toEqual(["mint-dark"]);
    expect(scene?.locales).toEqual(["en"]);
    expect(scene?.capture?.selector).toBe(".workspace-page");
    expect(scene?.description.toLowerCase()).toContain("custom skills");
    expect(scene?.description.toLowerCase()).toContain("create");
    expect(scene?.description.toLowerCase()).toContain("edit");
  });
});

// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { THEME_IDS } from "../theme";
import { UI_PREVIEW_SCENE_METADATA } from "./scene-metadata";

const source = readFileSync(`${process.cwd()}/src/ui-preview/scene-metadata.ts`, "utf8");

describe("ui preview scene metadata", () => {
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
});

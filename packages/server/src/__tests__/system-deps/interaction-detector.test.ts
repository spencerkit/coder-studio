import { describe, expect, it } from "vitest";
import { detectSystemDependencyInteraction } from "../../system-deps/interaction-detector.js";

describe("detectSystemDependencyInteraction", () => {
  it("detects sudo password prompts without enabling echo", () => {
    expect(detectSystemDependencyInteraction("[sudo] password for spencer:")).toEqual({
      kind: "sudo_password",
      promptExcerpt: "[sudo] password for spencer:",
      echo: false,
    });
  });

  it("detects confirmation prompts", () => {
    expect(detectSystemDependencyInteraction("Proceed? [Y/n]")).toEqual({
      kind: "confirm",
      promptExcerpt: "Proceed? [Y/n]",
      echo: true,
    });
  });

  it("returns none when output is not interactive", () => {
    expect(detectSystemDependencyInteraction("installed git")).toEqual({
      kind: "none",
      echo: false,
    });
  });
});

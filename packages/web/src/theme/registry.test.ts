import { describe, expect, it } from "vitest";
import { THEME_IDS, THEMES } from "./index";

describe("theme registry", () => {
  it("contains the first-phase theme ids", () => {
    expect(THEME_IDS).toEqual(
      expect.arrayContaining([
        "mint-dark",
        "mint-light",
        "graphite-dark",
        "graphite-light",
        "nord-dark",
        "nord-light",
        "hc-dark",
        "hc-light",
      ])
    );
  });

  it("uses unique theme ids", () => {
    expect(new Set(THEME_IDS).size).toBe(THEME_IDS.length);
  });

  it("defines the required fields for every theme", () => {
    for (const theme of THEMES) {
      expect(theme).toEqual(
        expect.objectContaining({
          family: expect.any(String),
          kind: expect.any(String),
          documentThemeAttr: expect.any(String),
          terminalTheme: expect.any(Object),
          monaco: expect.any(Object),
        })
      );
    }
  });

  it("only references real paired themes", () => {
    const ids = new Set(THEME_IDS);

    for (const theme of THEMES) {
      expect(ids.has(theme.pairedThemeId)).toBe(true);
    }
  });

  it("flags high contrast themes explicitly", () => {
    const highContrastThemes = THEMES.filter((theme) => theme.family === "hc");

    expect(highContrastThemes).toHaveLength(2);

    for (const theme of highContrastThemes) {
      expect(theme.isHighContrast).toBe(true);
    }
  });
});

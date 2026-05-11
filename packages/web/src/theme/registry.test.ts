import { describe, expect, it } from "vitest";
import { THEME_IDS, THEMES } from "./index";

describe("theme registry", () => {
  it("contains the first-phase theme ids", () => {
    expect(THEMES).toHaveLength(8);
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
      expect(THEMES.find((candidate) => candidate.id === theme.pairedThemeId)?.pairedThemeId).toBe(
        theme.id
      );
    }
  });

  it("defines one dark and one light theme for each family", () => {
    expect(
      THEMES.reduce<Record<string, string[]>>((families, theme) => {
        const variants = families[theme.family] ?? [];
        variants.push(theme.kind);
        families[theme.family] = variants;
        return families;
      }, {})
    ).toEqual({
      mint: ["dark", "light"],
      graphite: ["dark", "light"],
      nord: ["dark", "light"],
      hc: ["dark", "light"],
    });
  });

  it("keeps derived attributes aligned with ids and families", () => {
    for (const theme of THEMES) {
      expect(theme.documentThemeAttr).toBe(theme.id);
      expect(theme.isHighContrast).toBe(theme.family === "hc");
    }
  });
});

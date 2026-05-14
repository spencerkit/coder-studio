import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh.json";
import { THEME_IDS, THEMES } from "./index";

function getTranslationValue(messages: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, messages);
}

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
          iconTheme: expect.objectContaining({
            icons: expect.any(Object),
          }),
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

  it("uses translation keys that exist in every bundled locale", () => {
    for (const theme of THEMES) {
      expect(getTranslationValue(en as Record<string, unknown>, theme.labelKey)).toEqual(
        expect.any(String)
      );
      expect(getTranslationValue(zh as Record<string, unknown>, theme.labelKey)).toEqual(
        expect.any(String)
      );
    }
  });

  it("keeps light terminal palettes separated by theme family", () => {
    const mintLight = THEMES.find((theme) => theme.id === "mint-light");
    const graphiteLight = THEMES.find((theme) => theme.id === "graphite-light");
    const nordLight = THEMES.find((theme) => theme.id === "nord-light");

    expect(mintLight?.terminalTheme).toEqual(
      expect.objectContaining({
        background: "#fcfffd",
        cursor: "#148a7a",
        blue: "#148a7a",
        cyan: "#0f766e",
        selectionBackground: "#ddefe5",
      })
    );

    expect(graphiteLight?.terminalTheme).toEqual(
      expect.objectContaining({
        background: "#f5f7fa",
        cursor: "#315fdd",
        blue: "#315fdd",
        cyan: "#1f6f8b",
        selectionBackground: "#d4dce5",
      })
    );

    expect(nordLight?.terminalTheme).toEqual(
      expect.objectContaining({
        background: "#f1f5fa",
        cursor: "#5b7fa8",
        blue: "#5b7fa8",
        cyan: "#4c7f99",
        selectionBackground: "#d2ddea",
      })
    );
  });

  it("keeps light monaco palettes separated by theme family", () => {
    const mintLight = THEMES.find((theme) => theme.id === "mint-light");
    const graphiteLight = THEMES.find((theme) => theme.id === "graphite-light");
    const nordLight = THEMES.find((theme) => theme.id === "nord-light");

    expect(mintLight?.monaco.colors).toEqual(
      expect.objectContaining({
        "editor.background": "#fcfffd",
        "editorCursor.foreground": "#148a7a",
        "editor.selectionBackground": "#ddefe5",
      })
    );
    expect(mintLight?.monaco.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "string", foreground: "18794e" }),
        expect.objectContaining({ token: "keyword", foreground: "148a7a" }),
      ])
    );

    expect(graphiteLight?.monaco.colors).toEqual(
      expect.objectContaining({
        "editor.background": "#f5f7fa",
        "editorCursor.foreground": "#315fdd",
        "editor.selectionBackground": "#d4dce5",
      })
    );
    expect(graphiteLight?.monaco.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "string", foreground: "2f6f44" }),
        expect.objectContaining({ token: "keyword", foreground: "315fdd" }),
      ])
    );

    expect(nordLight?.monaco.colors).toEqual(
      expect.objectContaining({
        "editor.background": "#f1f5fa",
        "editorCursor.foreground": "#5b7fa8",
        "editor.selectionBackground": "#d2ddea",
      })
    );
    expect(nordLight?.monaco.rules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ token: "string", foreground: "5d7a66" }),
        expect.objectContaining({ token: "keyword", foreground: "5b7fa8" }),
      ])
    );
  });
});

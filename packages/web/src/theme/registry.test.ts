import { describe, expect, it } from "vitest";
import en from "../locales/en.json";
import zh from "../locales/zh.json";
import { BASE_ICON_THEME, createWorkspaceMonacoTheme, THEME_IDS, THEMES } from "./index";

const SEASONAL_THEME_EXPECTATIONS = [
  {
    id: "spring-light",
    family: "spring",
    kind: "light",
    pairedThemeId: "spring-dark",
    terminal: {
      background: "#fff7f8",
      cursor: "#c84b6a",
      selectionBackground: "#f3d9e2",
    },
    monaco: {
      base: "vs",
      string: "#2f7a57",
      keyword: "#c84b6a",
      lineNumber: "#a3848d",
    },
    icon: {
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    id: "spring-dark",
    family: "spring",
    kind: "dark",
    pairedThemeId: "spring-light",
    terminal: {
      background: "#1a1116",
      cursor: "#d95f7e",
      selectionBackground: "#3b1f2a",
    },
    monaco: {
      base: "vs-dark",
      string: "#63b988",
      keyword: "#d95f7e",
      lineNumber: "#6c505a",
    },
    icon: {
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    id: "summer-light",
    family: "summer",
    kind: "light",
    pairedThemeId: "summer-dark",
    terminal: {
      background: "#f6fbf7",
      cursor: "#2f9560",
      selectionBackground: "#d7eadc",
    },
    monaco: {
      base: "vs",
      string: "#3f8457",
      keyword: "#2f9560",
      lineNumber: "#8d9d95",
    },
    icon: {
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    id: "summer-dark",
    family: "summer",
    kind: "dark",
    pairedThemeId: "summer-light",
    terminal: {
      background: "#111917",
      cursor: "#4db57a",
      selectionBackground: "#1d3328",
    },
    monaco: {
      base: "vs-dark",
      string: "#8acb6f",
      keyword: "#4db57a",
      lineNumber: "#55665e",
    },
    icon: {
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    id: "autumn-light",
    family: "autumn",
    kind: "light",
    pairedThemeId: "autumn-dark",
    terminal: {
      background: "#fdf8ef",
      cursor: "#b7791f",
      selectionBackground: "#f0dfbf",
    },
    monaco: {
      base: "vs",
      string: "#8a5a44",
      keyword: "#b7791f",
      lineNumber: "#ab9988",
    },
    icon: {
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    id: "autumn-dark",
    family: "autumn",
    kind: "dark",
    pairedThemeId: "autumn-light",
    terminal: {
      background: "#17120f",
      cursor: "#c08a3c",
      selectionBackground: "#34261b",
    },
    monaco: {
      base: "vs-dark",
      string: "#9ca171",
      keyword: "#c08a3c",
      lineNumber: "#665545",
    },
    icon: {
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    id: "winter-light",
    family: "winter",
    kind: "light",
    pairedThemeId: "winter-dark",
    terminal: {
      background: "#f5f8fc",
      cursor: "#6f89ad",
      selectionBackground: "#dbe4ef",
    },
    monaco: {
      base: "vs",
      string: "#6f9ab0",
      keyword: "#6f89ad",
      lineNumber: "#95a3b3",
    },
    icon: {
      terminalActionTone: "info",
      gitTone: "info",
    },
  },
  {
    id: "winter-dark",
    family: "winter",
    kind: "dark",
    pairedThemeId: "winter-light",
    terminal: {
      background: "#0f141b",
      cursor: "#8aa4c8",
      selectionBackground: "#1e2b3a",
    },
    monaco: {
      base: "vs-dark",
      string: "#9bb8d3",
      keyword: "#8aa4c8",
      lineNumber: "#5c6a79",
    },
    icon: {
      terminalActionTone: "info",
      gitTone: "info",
    },
  },
] as const;

function getTranslationValue(messages: Record<string, unknown>, key: string): unknown {
  return key.split(".").reduce<unknown>((current, segment) => {
    if (current && typeof current === "object" && segment in current) {
      return (current as Record<string, unknown>)[segment];
    }

    return undefined;
  }, messages);
}

describe("theme registry", () => {
  it("contains the built-in theme ids", () => {
    expect(THEMES).toHaveLength(16);
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
        "spring-light",
        "spring-dark",
        "summer-light",
        "summer-dark",
        "autumn-light",
        "autumn-dark",
        "winter-light",
        "winter-dark",
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
      spring: ["light", "dark"],
      summer: ["light", "dark"],
      autumn: ["light", "dark"],
      winter: ["light", "dark"],
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

  it("keeps the seasonal theme contract aligned across all 8 themes", () => {
    for (const expected of SEASONAL_THEME_EXPECTATIONS) {
      const theme = THEMES.find((candidate) => candidate.id === expected.id);

      expect(theme).toEqual(
        expect.objectContaining({
          id: expected.id,
          family: expected.family,
          kind: expected.kind,
          pairedThemeId: expected.pairedThemeId,
          isHighContrast: false,
          documentThemeAttr: expected.id,
        })
      );

      expect(theme?.terminalTheme).toEqual(
        expect.objectContaining({
          background: expected.terminal.background,
          cursor: expected.terminal.cursor,
          selectionBackground: expected.terminal.selectionBackground,
        })
      );

      expect(theme?.monaco.base).toBe(expected.monaco.base);
      expect(theme?.monaco.colors).toEqual(
        expect.objectContaining({
          "editor.background": expected.terminal.background,
          "editorCursor.foreground": expected.terminal.cursor,
          "editor.selectionBackground": expected.terminal.selectionBackground,
          "editorLineNumber.foreground": expected.monaco.lineNumber,
        })
      );
      expect(theme?.monaco.rules).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ token: "string", foreground: expected.monaco.string }),
          expect.objectContaining({ token: "keyword", foreground: expected.monaco.keyword }),
        ])
      );

      expect(theme?.iconTheme.icons["agent.provider.codex"]).toEqual(
        expect.objectContaining({ tone: "accent" })
      );
      expect(theme?.iconTheme.icons["terminal.action.new"]).toEqual(
        expect.objectContaining({ tone: expected.icon.terminalActionTone })
      );
      expect(theme?.iconTheme.icons["git.branch"]).toEqual(
        expect.objectContaining({ tone: expected.icon.gitTone })
      );
      expect(theme?.iconTheme.icons["git.action.diff"]).toEqual(
        expect.objectContaining({ tone: expected.icon.gitTone })
      );
      expect(theme?.iconTheme.icons["git.action.push"]).toEqual(
        expect.objectContaining({ tone: expected.icon.gitTone })
      );
      expect(theme?.iconTheme.icons["git.action.pull"]).toEqual(
        expect.objectContaining({ tone: expected.icon.gitTone })
      );
      expect(theme?.iconTheme.icons["git.action.refresh"]).toEqual(
        expect.objectContaining({ tone: expected.icon.gitTone })
      );
      expect(theme?.iconTheme.icons["git.commit"]).toEqual(
        expect.objectContaining({ tone: expected.icon.gitTone })
      );
    }
  });

  it("keeps semantic state icons unchanged for seasonal themes", () => {
    for (const expected of SEASONAL_THEME_EXPECTATIONS) {
      const theme = THEMES.find((candidate) => candidate.id === expected.id);

      expect(theme?.iconTheme.icons["state.info"]).toEqual(BASE_ICON_THEME.icons["state.info"]);
      expect(theme?.iconTheme.icons["state.welcome.terminal"]).toEqual(
        BASE_ICON_THEME.icons["state.welcome.terminal"]
      );
      expect(theme?.iconTheme.icons["state.welcome.workspace"]).toEqual(
        BASE_ICON_THEME.icons["state.welcome.workspace"]
      );
      expect(theme?.iconTheme.icons["state.welcome.git"]).toEqual(
        BASE_ICON_THEME.icons["state.welcome.git"]
      );
      expect(theme?.iconTheme.icons["state.welcome.lightning"]).toEqual(
        BASE_ICON_THEME.icons["state.welcome.lightning"]
      );
    }
  });

  it("creates workspace monaco themes with transparent editor backgrounds", () => {
    for (const theme of THEMES) {
      expect(createWorkspaceMonacoTheme(theme.monaco).colors["editor.background"]).toBe(
        "#00000000"
      );
      expect(theme.monaco.colors["editor.background"]).not.toBe("#00000000");
    }
  });
});

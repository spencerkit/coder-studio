export type ThemeFamily = "mint" | "graphite" | "nord" | "hc";
export type ThemeKind = "dark" | "light";

export interface TerminalThemeDefinition {
  background: string;
  foreground: string;
  cursor: string;
  cursorAccent: string;
  selectionBackground: string;
  selectionForeground: string;
  black: string;
  red: string;
  green: string;
  yellow: string;
  blue: string;
  magenta: string;
  cyan: string;
  white: string;
  brightBlack: string;
  brightRed: string;
  brightGreen: string;
  brightYellow: string;
  brightBlue: string;
  brightMagenta: string;
  brightCyan: string;
  brightWhite: string;
}

export interface MonacoThemeDefinition {
  base: "vs" | "vs-dark" | "hc-black" | "hc-light";
  inherit: boolean;
  rules: ReadonlyArray<{
    token: string;
    foreground?: string;
    background?: string;
    fontStyle?: string;
  }>;
  colors: Readonly<Record<string, string>>;
}

export interface AppThemeDefinition {
  id: string;
  family: ThemeFamily;
  kind: ThemeKind;
  labelKey: string;
  pairedThemeId: string;
  isHighContrast: boolean;
  documentThemeAttr: string;
  terminalTheme: TerminalThemeDefinition;
  monaco: MonacoThemeDefinition;
}

const mintDarkTerminal: TerminalThemeDefinition = {
  background: "#0b1218",
  foreground: "#e5edf3",
  cursor: "#78d7b2",
  cursorAccent: "#0b1218",
  selectionBackground: "#1e3040",
  selectionForeground: "#e5edf3",
  black: "#22303c",
  red: "#ff8f9f",
  green: "#5fd7a3",
  yellow: "#f1b86a",
  blue: "#6cb6ff",
  magenta: "#c792ea",
  cyan: "#78d7b2",
  white: "#cdd9e5",
  brightBlack: "#4a5b6a",
  brightRed: "#ff9eb0",
  brightGreen: "#78d7b2",
  brightYellow: "#f1b86a",
  brightBlue: "#6cb6ff",
  brightMagenta: "#c792ea",
  brightCyan: "#78d7b2",
  brightWhite: "#e5edf3",
};

const mintLightTerminal: TerminalThemeDefinition = {
  background: "#fafbfc",
  foreground: "#1f2328",
  cursor: "#0969da",
  cursorAccent: "#fafbfc",
  selectionBackground: "#dde4ea",
  selectionForeground: "#1f2328",
  black: "#24292f",
  red: "#cf222e",
  green: "#1a7f37",
  yellow: "#9a6700",
  blue: "#0969da",
  magenta: "#8250df",
  cyan: "#1b7c83",
  white: "#57606a",
  brightBlack: "#8b949e",
  brightRed: "#cf222e",
  brightGreen: "#1a7f37",
  brightYellow: "#9a6700",
  brightBlue: "#0969da",
  brightMagenta: "#8250df",
  brightCyan: "#1b7c83",
  brightWhite: "#1f2328",
};

const THEMES_REGISTRY: ReadonlyArray<AppThemeDefinition> = [
  {
    id: "mint-dark",
    family: "mint",
    kind: "dark",
    labelKey: "settings.appearance.theme.mint_dark",
    pairedThemeId: "mint-light",
    isHighContrast: false,
    documentThemeAttr: "mint-dark",
    terminalTheme: mintDarkTerminal,
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "8b9bab" },
        { token: "string", foreground: "78d7b2" },
        { token: "keyword", foreground: "6cb6ff" },
      ],
      colors: {
        "editor.background": "#0b1218",
        "editor.foreground": "#e5edf3",
        "editorLineNumber.foreground": "#4a5b6a",
        "editorCursor.foreground": "#78d7b2",
        "editor.selectionBackground": "#1e3040",
      },
    },
  },
  {
    id: "mint-light",
    family: "mint",
    kind: "light",
    labelKey: "settings.appearance.theme.mint_light",
    pairedThemeId: "mint-dark",
    isHighContrast: false,
    documentThemeAttr: "mint-light",
    terminalTheme: mintLightTerminal,
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6e7781" },
        { token: "string", foreground: "1a7f37" },
        { token: "keyword", foreground: "0969da" },
      ],
      colors: {
        "editor.background": "#fafbfc",
        "editor.foreground": "#1f2328",
        "editorLineNumber.foreground": "#8b949e",
        "editorCursor.foreground": "#0969da",
        "editor.selectionBackground": "#dde4ea",
      },
    },
  },
  {
    id: "graphite-dark",
    family: "graphite",
    kind: "dark",
    labelKey: "settings.appearance.theme.graphite_dark",
    pairedThemeId: "graphite-light",
    isHighContrast: false,
    documentThemeAttr: "graphite-dark",
    terminalTheme: {
      background: "#111317",
      foreground: "#e6e6e6",
      cursor: "#9aa4b2",
      cursorAccent: "#111317",
      selectionBackground: "#2b3038",
      selectionForeground: "#f5f7fa",
      black: "#1d2127",
      red: "#ff7b72",
      green: "#8ddb8c",
      yellow: "#dcb86a",
      blue: "#7aa2f7",
      magenta: "#c099ff",
      cyan: "#76c7c0",
      white: "#c9d1d9",
      brightBlack: "#6e7681",
      brightRed: "#ffa198",
      brightGreen: "#a5e39a",
      brightYellow: "#eacb91",
      brightBlue: "#9bb8ff",
      brightMagenta: "#d2b5ff",
      brightCyan: "#93ddd8",
      brightWhite: "#f0f3f6",
    },
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "7d8590" },
        { token: "string", foreground: "8ddb8c" },
        { token: "keyword", foreground: "7aa2f7" },
      ],
      colors: {
        "editor.background": "#111317",
        "editor.foreground": "#e6e6e6",
        "editorLineNumber.foreground": "#6e7681",
        "editorCursor.foreground": "#9aa4b2",
        "editor.selectionBackground": "#2b3038",
      },
    },
  },
  {
    id: "graphite-light",
    family: "graphite",
    kind: "light",
    labelKey: "settings.appearance.theme.graphite_light",
    pairedThemeId: "graphite-dark",
    isHighContrast: false,
    documentThemeAttr: "graphite-light",
    terminalTheme: {
      background: "#f3f4f6",
      foreground: "#1f2933",
      cursor: "#4b5563",
      cursorAccent: "#f3f4f6",
      selectionBackground: "#d6d9df",
      selectionForeground: "#111317",
      black: "#111827",
      red: "#c2410c",
      green: "#15803d",
      yellow: "#a16207",
      blue: "#1d4ed8",
      magenta: "#7c3aed",
      cyan: "#0f766e",
      white: "#6b7280",
      brightBlack: "#9ca3af",
      brightRed: "#ea580c",
      brightGreen: "#16a34a",
      brightYellow: "#ca8a04",
      brightBlue: "#2563eb",
      brightMagenta: "#8b5cf6",
      brightCyan: "#14b8a6",
      brightWhite: "#111827",
    },
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6b7280" },
        { token: "string", foreground: "15803d" },
        { token: "keyword", foreground: "1d4ed8" },
      ],
      colors: {
        "editor.background": "#f3f4f6",
        "editor.foreground": "#1f2933",
        "editorLineNumber.foreground": "#9ca3af",
        "editorCursor.foreground": "#4b5563",
        "editor.selectionBackground": "#d6d9df",
      },
    },
  },
  {
    id: "nord-dark",
    family: "nord",
    kind: "dark",
    labelKey: "settings.appearance.theme.nord_dark",
    pairedThemeId: "nord-light",
    isHighContrast: false,
    documentThemeAttr: "nord-dark",
    terminalTheme: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#88c0d0",
      cursorAccent: "#2e3440",
      selectionBackground: "#434c5e",
      selectionForeground: "#eceff4",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#d08770",
      brightGreen: "#b1d196",
      brightYellow: "#f0d399",
      brightBlue: "#8fbcbb",
      brightMagenta: "#c895bf",
      brightCyan: "#93ccdc",
      brightWhite: "#eceff4",
    },
    monaco: {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment", foreground: "616e88" },
        { token: "string", foreground: "a3be8c" },
        { token: "keyword", foreground: "81a1c1" },
      ],
      colors: {
        "editor.background": "#2e3440",
        "editor.foreground": "#d8dee9",
        "editorLineNumber.foreground": "#616e88",
        "editorCursor.foreground": "#88c0d0",
        "editor.selectionBackground": "#434c5e",
      },
    },
  },
  {
    id: "nord-light",
    family: "nord",
    kind: "light",
    labelKey: "settings.appearance.theme.nord_light",
    pairedThemeId: "nord-dark",
    isHighContrast: false,
    documentThemeAttr: "nord-light",
    terminalTheme: {
      background: "#eceff4",
      foreground: "#2e3440",
      cursor: "#5e81ac",
      cursorAccent: "#eceff4",
      selectionBackground: "#d8dee9",
      selectionForeground: "#2e3440",
      black: "#3b4252",
      red: "#bf616a",
      green: "#4c7a5b",
      yellow: "#a77f2f",
      blue: "#5e81ac",
      magenta: "#8f5b9c",
      cyan: "#3f7c8b",
      white: "#4c566a",
      brightBlack: "#7b88a1",
      brightRed: "#d08770",
      brightGreen: "#5f8f70",
      brightYellow: "#b08d49",
      brightBlue: "#6b8fb8",
      brightMagenta: "#9b6aa8",
      brightCyan: "#4c8e9f",
      brightWhite: "#2e3440",
    },
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "7b88a1" },
        { token: "string", foreground: "4c7a5b" },
        { token: "keyword", foreground: "5e81ac" },
      ],
      colors: {
        "editor.background": "#eceff4",
        "editor.foreground": "#2e3440",
        "editorLineNumber.foreground": "#7b88a1",
        "editorCursor.foreground": "#5e81ac",
        "editor.selectionBackground": "#d8dee9",
      },
    },
  },
  {
    id: "hc-dark",
    family: "hc",
    kind: "dark",
    labelKey: "settings.appearance.theme.hc_dark",
    pairedThemeId: "hc-light",
    isHighContrast: true,
    documentThemeAttr: "hc-dark",
    terminalTheme: {
      background: "#000000",
      foreground: "#ffffff",
      cursor: "#ffff00",
      cursorAccent: "#000000",
      selectionBackground: "#264f78",
      selectionForeground: "#ffffff",
      black: "#000000",
      red: "#ff4d4d",
      green: "#00ff7f",
      yellow: "#ffff66",
      blue: "#66b3ff",
      magenta: "#ff7fff",
      cyan: "#66ffff",
      white: "#ffffff",
      brightBlack: "#808080",
      brightRed: "#ff8080",
      brightGreen: "#66ffb3",
      brightYellow: "#ffff99",
      brightBlue: "#99ccff",
      brightMagenta: "#ffb3ff",
      brightCyan: "#99ffff",
      brightWhite: "#ffffff",
    },
    monaco: {
      base: "hc-black",
      inherit: true,
      rules: [
        { token: "comment", foreground: "c0c0c0" },
        { token: "string", foreground: "00ff7f" },
        { token: "keyword", foreground: "66b3ff" },
      ],
      colors: {
        "editor.background": "#000000",
        "editor.foreground": "#ffffff",
        "editorLineNumber.foreground": "#c0c0c0",
        "editorCursor.foreground": "#ffff00",
        "editor.selectionBackground": "#264f78",
      },
    },
  },
  {
    id: "hc-light",
    family: "hc",
    kind: "light",
    labelKey: "settings.appearance.theme.hc_light",
    pairedThemeId: "hc-dark",
    isHighContrast: true,
    documentThemeAttr: "hc-light",
    terminalTheme: {
      background: "#ffffff",
      foreground: "#000000",
      cursor: "#0000ff",
      cursorAccent: "#ffffff",
      selectionBackground: "#add6ff",
      selectionForeground: "#000000",
      black: "#000000",
      red: "#b00020",
      green: "#006b3c",
      yellow: "#7a5c00",
      blue: "#0037da",
      magenta: "#7a00cc",
      cyan: "#006f8f",
      white: "#5c5c5c",
      brightBlack: "#767676",
      brightRed: "#d00032",
      brightGreen: "#008f50",
      brightYellow: "#997500",
      brightBlue: "#2455ff",
      brightMagenta: "#9900ff",
      brightCyan: "#0088aa",
      brightWhite: "#000000",
    },
    monaco: {
      base: "hc-light",
      inherit: true,
      rules: [
        { token: "comment", foreground: "5c5c5c" },
        { token: "string", foreground: "006b3c" },
        { token: "keyword", foreground: "0037da" },
      ],
      colors: {
        "editor.background": "#ffffff",
        "editor.foreground": "#000000",
        "editorLineNumber.foreground": "#5c5c5c",
        "editorCursor.foreground": "#0037da",
        "editor.selectionBackground": "#add6ff",
      },
    },
  },
];

export const THEMES = THEMES_REGISTRY;
export const THEME_IDS = THEMES_REGISTRY.map((theme) => theme.id) as readonly string[];

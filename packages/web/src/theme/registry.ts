import {
  BASE_ICON_THEME,
  createIconTheme,
  type IconThemeDefinition,
  registerIconThemes,
} from "./icon-theme";

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
  iconTheme: IconThemeDefinition;
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
  background: "#fcfffd",
  foreground: "#1f2328",
  cursor: "#148a7a",
  cursorAccent: "#fcfffd",
  selectionBackground: "#ddefe5",
  selectionForeground: "#1f2328",
  black: "#24292f",
  red: "#cf222e",
  green: "#18794e",
  yellow: "#9a6700",
  blue: "#148a7a",
  magenta: "#8250df",
  cyan: "#0f766e",
  white: "#57606a",
  brightBlack: "#8b949e",
  brightRed: "#cf222e",
  brightGreen: "#1f9360",
  brightYellow: "#9a6700",
  brightBlue: "#148a7a",
  brightMagenta: "#8250df",
  brightCyan: "#14877d",
  brightWhite: "#1f2328",
};

const THEMES_REGISTRY: ReadonlyArray<AppThemeDefinition> = [
  {
    id: "mint-dark",
    family: "mint",
    kind: "dark",
    labelKey: "settings.theme.mint_dark",
    pairedThemeId: "mint-light",
    isHighContrast: false,
    documentThemeAttr: "mint-dark",
    terminalTheme: mintDarkTerminal,
    iconTheme: createIconTheme({
      "file.folder.closed": {
        ...BASE_ICON_THEME.icons["file.folder.closed"],
        strokeWidth: 1.8,
      },
      "file.folder.open": {
        ...BASE_ICON_THEME.icons["file.folder.open"],
        strokeWidth: 1.8,
      },
      "agent.provider.codex": {
        ...BASE_ICON_THEME.icons["agent.provider.codex"],
        tone: "accent",
      },
      "mobile.dock.agent": {
        ...BASE_ICON_THEME.icons["mobile.dock.agent"],
        tone: "accent",
      },
      "mobile.dock.files": {
        ...BASE_ICON_THEME.icons["mobile.dock.files"],
        tone: "info",
      },
      "mobile.dock.terminal": {
        ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
        tone: "info",
      },
      "terminal.action.new": {
        ...BASE_ICON_THEME.icons["terminal.action.new"],
        tone: "info",
      },
      "git.branch": {
        ...BASE_ICON_THEME.icons["git.branch"],
        tone: "info",
      },
      "git.action.diff": {
        ...BASE_ICON_THEME.icons["git.action.diff"],
        tone: "info",
      },
      "git.action.push": {
        ...BASE_ICON_THEME.icons["git.action.push"],
        tone: "info",
      },
      "git.action.pull": {
        ...BASE_ICON_THEME.icons["git.action.pull"],
        tone: "info",
      },
      "git.action.refresh": {
        ...BASE_ICON_THEME.icons["git.action.refresh"],
        tone: "info",
      },
      "git.commit": {
        ...BASE_ICON_THEME.icons["git.commit"],
        tone: "info",
      },
    }),
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
    labelKey: "settings.theme.mint_light",
    pairedThemeId: "mint-dark",
    isHighContrast: false,
    documentThemeAttr: "mint-light",
    terminalTheme: mintLightTerminal,
    iconTheme: createIconTheme({
      "file.folder.closed": {
        ...BASE_ICON_THEME.icons["file.folder.closed"],
        strokeWidth: 1.8,
      },
      "file.folder.open": {
        ...BASE_ICON_THEME.icons["file.folder.open"],
        strokeWidth: 1.8,
      },
      "agent.provider.codex": {
        ...BASE_ICON_THEME.icons["agent.provider.codex"],
        tone: "accent",
      },
      "mobile.dock.agent": {
        ...BASE_ICON_THEME.icons["mobile.dock.agent"],
        tone: "accent",
      },
      "mobile.dock.files": {
        ...BASE_ICON_THEME.icons["mobile.dock.files"],
        tone: "info",
      },
      "mobile.dock.terminal": {
        ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
        tone: "info",
      },
      "terminal.action.new": {
        ...BASE_ICON_THEME.icons["terminal.action.new"],
        tone: "info",
      },
      "git.branch": {
        ...BASE_ICON_THEME.icons["git.branch"],
        tone: "info",
      },
      "git.action.diff": {
        ...BASE_ICON_THEME.icons["git.action.diff"],
        tone: "info",
      },
      "git.action.push": {
        ...BASE_ICON_THEME.icons["git.action.push"],
        tone: "info",
      },
      "git.action.pull": {
        ...BASE_ICON_THEME.icons["git.action.pull"],
        tone: "info",
      },
      "git.action.refresh": {
        ...BASE_ICON_THEME.icons["git.action.refresh"],
        tone: "info",
      },
      "git.commit": {
        ...BASE_ICON_THEME.icons["git.commit"],
        tone: "info",
      },
    }),
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6e7781" },
        { token: "string", foreground: "18794e" },
        { token: "keyword", foreground: "148a7a" },
      ],
      colors: {
        "editor.background": "#fcfffd",
        "editor.foreground": "#1f2328",
        "editorLineNumber.foreground": "#8b949e",
        "editorCursor.foreground": "#148a7a",
        "editor.selectionBackground": "#ddefe5",
      },
    },
  },
  {
    id: "graphite-dark",
    family: "graphite",
    kind: "dark",
    labelKey: "settings.theme.graphite_dark",
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
    iconTheme: createIconTheme({
      "agent.provider.codex": {
        ...BASE_ICON_THEME.icons["agent.provider.codex"],
        tone: "accent",
      },
      "mobile.dock.agent": {
        ...BASE_ICON_THEME.icons["mobile.dock.agent"],
        tone: "accent",
      },
      "mobile.dock.files": {
        ...BASE_ICON_THEME.icons["mobile.dock.files"],
        tone: "secondary",
      },
      "mobile.dock.terminal": {
        ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
        tone: "secondary",
      },
      "git.branch": {
        ...BASE_ICON_THEME.icons["git.branch"],
        tone: "info",
      },
      "git.action.diff": {
        ...BASE_ICON_THEME.icons["git.action.diff"],
        tone: "info",
      },
      "git.action.push": {
        ...BASE_ICON_THEME.icons["git.action.push"],
        tone: "info",
      },
      "git.action.pull": {
        ...BASE_ICON_THEME.icons["git.action.pull"],
        tone: "info",
      },
      "git.action.refresh": {
        ...BASE_ICON_THEME.icons["git.action.refresh"],
        tone: "info",
      },
    }),
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
    labelKey: "settings.theme.graphite_light",
    pairedThemeId: "graphite-dark",
    isHighContrast: false,
    documentThemeAttr: "graphite-light",
    terminalTheme: {
      background: "#f5f7fa",
      foreground: "#1f2933",
      cursor: "#315fdd",
      cursorAccent: "#f5f7fa",
      selectionBackground: "#d4dce5",
      selectionForeground: "#111317",
      black: "#111827",
      red: "#c2410c",
      green: "#2f6f44",
      yellow: "#a16207",
      blue: "#315fdd",
      magenta: "#7c3aed",
      cyan: "#1f6f8b",
      white: "#6b7280",
      brightBlack: "#9ca3af",
      brightRed: "#ea580c",
      brightGreen: "#3f8457",
      brightYellow: "#ca8a04",
      brightBlue: "#4672e7",
      brightMagenta: "#8b5cf6",
      brightCyan: "#2e86a5",
      brightWhite: "#111827",
    },
    iconTheme: createIconTheme({
      "agent.provider.codex": {
        ...BASE_ICON_THEME.icons["agent.provider.codex"],
        tone: "accent",
      },
      "mobile.dock.agent": {
        ...BASE_ICON_THEME.icons["mobile.dock.agent"],
        tone: "accent",
      },
      "mobile.dock.files": {
        ...BASE_ICON_THEME.icons["mobile.dock.files"],
        tone: "secondary",
      },
      "mobile.dock.terminal": {
        ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
        tone: "secondary",
      },
      "git.branch": {
        ...BASE_ICON_THEME.icons["git.branch"],
        tone: "info",
      },
      "git.action.diff": {
        ...BASE_ICON_THEME.icons["git.action.diff"],
        tone: "info",
      },
      "git.action.push": {
        ...BASE_ICON_THEME.icons["git.action.push"],
        tone: "info",
      },
      "git.action.pull": {
        ...BASE_ICON_THEME.icons["git.action.pull"],
        tone: "info",
      },
      "git.action.refresh": {
        ...BASE_ICON_THEME.icons["git.action.refresh"],
        tone: "info",
      },
    }),
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "6b7280" },
        { token: "string", foreground: "2f6f44" },
        { token: "keyword", foreground: "315fdd" },
      ],
      colors: {
        "editor.background": "#f5f7fa",
        "editor.foreground": "#1f2933",
        "editorLineNumber.foreground": "#9ca3af",
        "editorCursor.foreground": "#315fdd",
        "editor.selectionBackground": "#d4dce5",
      },
    },
  },
  {
    id: "nord-dark",
    family: "nord",
    kind: "dark",
    labelKey: "settings.theme.nord_dark",
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
    iconTheme: createIconTheme({
      "agent.provider.codex": {
        ...BASE_ICON_THEME.icons["agent.provider.codex"],
        tone: "accent",
      },
      "mobile.dock.agent": {
        ...BASE_ICON_THEME.icons["mobile.dock.agent"],
        tone: "accent",
      },
      "mobile.dock.files": {
        ...BASE_ICON_THEME.icons["mobile.dock.files"],
        tone: "info",
      },
      "mobile.dock.terminal": {
        ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
        tone: "info",
      },
      "terminal.action.new": {
        ...BASE_ICON_THEME.icons["terminal.action.new"],
        tone: "info",
      },
      "git.branch": {
        ...BASE_ICON_THEME.icons["git.branch"],
        tone: "accent",
      },
      "git.action.diff": {
        ...BASE_ICON_THEME.icons["git.action.diff"],
        tone: "accent",
      },
      "git.action.push": {
        ...BASE_ICON_THEME.icons["git.action.push"],
        tone: "accent",
      },
      "git.action.pull": {
        ...BASE_ICON_THEME.icons["git.action.pull"],
        tone: "accent",
      },
      "git.action.refresh": {
        ...BASE_ICON_THEME.icons["git.action.refresh"],
        tone: "accent",
      },
      "git.commit": {
        ...BASE_ICON_THEME.icons["git.commit"],
        tone: "accent",
      },
      "nav.settings.providers": {
        ...BASE_ICON_THEME.icons["nav.settings.providers"],
        tone: "info",
      },
      "state.warning": {
        ...BASE_ICON_THEME.icons["state.warning"],
      },
      "state.info": {
        ...BASE_ICON_THEME.icons["state.info"],
        tone: "accent",
        surface: "subtle",
      },
    }),
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
    labelKey: "settings.theme.nord_light",
    pairedThemeId: "nord-dark",
    isHighContrast: false,
    documentThemeAttr: "nord-light",
    terminalTheme: {
      background: "#f1f5fa",
      foreground: "#2e3440",
      cursor: "#5b7fa8",
      cursorAccent: "#f1f5fa",
      selectionBackground: "#d2ddea",
      selectionForeground: "#2e3440",
      black: "#3b4252",
      red: "#bf616a",
      green: "#5d7a66",
      yellow: "#a77f2f",
      blue: "#5b7fa8",
      magenta: "#8f5b9c",
      cyan: "#4c7f99",
      white: "#4c566a",
      brightBlack: "#7b88a1",
      brightRed: "#d08770",
      brightGreen: "#6a8d76",
      brightYellow: "#b08d49",
      brightBlue: "#6c90b7",
      brightMagenta: "#9b6aa8",
      brightCyan: "#5b90a6",
      brightWhite: "#2e3440",
    },
    iconTheme: createIconTheme({
      "agent.provider.codex": {
        ...BASE_ICON_THEME.icons["agent.provider.codex"],
        tone: "accent",
      },
      "mobile.dock.agent": {
        ...BASE_ICON_THEME.icons["mobile.dock.agent"],
        tone: "accent",
      },
      "mobile.dock.files": {
        ...BASE_ICON_THEME.icons["mobile.dock.files"],
        tone: "info",
      },
      "mobile.dock.terminal": {
        ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
        tone: "info",
      },
      "terminal.action.new": {
        ...BASE_ICON_THEME.icons["terminal.action.new"],
        tone: "info",
      },
      "git.branch": {
        ...BASE_ICON_THEME.icons["git.branch"],
        tone: "accent",
      },
      "git.action.diff": {
        ...BASE_ICON_THEME.icons["git.action.diff"],
        tone: "accent",
      },
      "git.action.push": {
        ...BASE_ICON_THEME.icons["git.action.push"],
        tone: "accent",
      },
      "git.action.pull": {
        ...BASE_ICON_THEME.icons["git.action.pull"],
        tone: "accent",
      },
      "git.action.refresh": {
        ...BASE_ICON_THEME.icons["git.action.refresh"],
        tone: "accent",
      },
      "git.commit": {
        ...BASE_ICON_THEME.icons["git.commit"],
        tone: "accent",
      },
      "nav.settings.providers": {
        ...BASE_ICON_THEME.icons["nav.settings.providers"],
        tone: "info",
      },
      "state.warning": {
        ...BASE_ICON_THEME.icons["state.warning"],
      },
      "state.info": {
        ...BASE_ICON_THEME.icons["state.info"],
        tone: "accent",
        surface: "subtle",
      },
    }),
    monaco: {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "7b88a1" },
        { token: "string", foreground: "5d7a66" },
        { token: "keyword", foreground: "5b7fa8" },
      ],
      colors: {
        "editor.background": "#f1f5fa",
        "editor.foreground": "#2e3440",
        "editorLineNumber.foreground": "#7b88a1",
        "editorCursor.foreground": "#5b7fa8",
        "editor.selectionBackground": "#d2ddea",
      },
    },
  },
  {
    id: "hc-dark",
    family: "hc",
    kind: "dark",
    labelKey: "settings.theme.hc_dark",
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
    iconTheme: createIconTheme({
      "file.folder.closed": {
        ...BASE_ICON_THEME.icons["file.folder.closed"],
        tone: "warning",
        strokeWidth: 2.25,
      },
      "file.folder.open": {
        ...BASE_ICON_THEME.icons["file.folder.open"],
        tone: "warning",
        strokeWidth: 2.25,
      },
      "state.warning": {
        ...BASE_ICON_THEME.icons["state.warning"],
        strokeWidth: 2.25,
      },
    }),
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
    labelKey: "settings.theme.hc_light",
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
    iconTheme: createIconTheme({
      "file.folder.closed": {
        ...BASE_ICON_THEME.icons["file.folder.closed"],
        tone: "warning",
        strokeWidth: 2.25,
      },
      "file.folder.open": {
        ...BASE_ICON_THEME.icons["file.folder.open"],
        tone: "warning",
        strokeWidth: 2.25,
      },
      "state.warning": {
        ...BASE_ICON_THEME.icons["state.warning"],
        strokeWidth: 2.25,
      },
    }),
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

registerIconThemes(THEMES_REGISTRY);

export const THEMES = THEMES_REGISTRY;
export const THEME_IDS = THEMES_REGISTRY.map((theme) => theme.id) as readonly string[];

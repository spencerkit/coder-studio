import {
  BASE_ICON_THEME,
  createIconTheme,
  type IconThemeDefinition,
  type IconTone,
  registerIconThemes,
} from "./icon-theme";

export type ThemeFamily =
  | "mint"
  | "graphite"
  | "nord"
  | "hc"
  | "spring"
  | "summer"
  | "autumn"
  | "winter";
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

const springLightTerminal: TerminalThemeDefinition = {
  background: "#fff7f8",
  foreground: "#35252b",
  cursor: "#c84b6a",
  cursorAccent: "#fff7f8",
  selectionBackground: "#f3d9e2",
  selectionForeground: "#35252b",
  black: "#3d2a31",
  red: "#c84b6a",
  green: "#2f7a57",
  yellow: "#c68a2b",
  blue: "#8b6fcf",
  magenta: "#b85c9b",
  cyan: "#4e9f93",
  white: "#8d6d76",
  brightBlack: "#a3848d",
  brightRed: "#d95f7e",
  brightGreen: "#3e8d67",
  brightYellow: "#d39a46",
  brightBlue: "#9b80d9",
  brightMagenta: "#c971a8",
  brightCyan: "#62afa5",
  brightWhite: "#35252b",
};

const summerDarkTerminal: TerminalThemeDefinition = {
  background: "#111917",
  foreground: "#dbe7df",
  cursor: "#4db57a",
  cursorAccent: "#111917",
  selectionBackground: "#1d3328",
  selectionForeground: "#edf5ef",
  black: "#1d2522",
  red: "#d96c6c",
  green: "#4db57a",
  yellow: "#c8a55a",
  blue: "#5fa38f",
  magenta: "#8d7ccf",
  cyan: "#56b39c",
  white: "#c3d2c7",
  brightBlack: "#55665e",
  brightRed: "#e58383",
  brightGreen: "#68c58d",
  brightYellow: "#d6b772",
  brightBlue: "#78b5a3",
  brightMagenta: "#a08fda",
  brightCyan: "#71c3af",
  brightWhite: "#edf5ef",
};

const autumnLightTerminal: TerminalThemeDefinition = {
  background: "#fdf8ef",
  foreground: "#3f3125",
  cursor: "#b7791f",
  cursorAccent: "#fdf8ef",
  selectionBackground: "#f0dfbf",
  selectionForeground: "#3f3125",
  black: "#4a3828",
  red: "#b85c38",
  green: "#7b8558",
  yellow: "#b7791f",
  blue: "#8c6b49",
  magenta: "#9a5f80",
  cyan: "#7c8b74",
  white: "#8a7766",
  brightBlack: "#ab9988",
  brightRed: "#c96d47",
  brightGreen: "#8d9668",
  brightYellow: "#cb8f36",
  brightBlue: "#a07f5d",
  brightMagenta: "#ad7393",
  brightCyan: "#8f9d87",
  brightWhite: "#3f3125",
};

const winterDarkTerminal: TerminalThemeDefinition = {
  background: "#0f141b",
  foreground: "#d8e1ec",
  cursor: "#8aa4c8",
  cursorAccent: "#0f141b",
  selectionBackground: "#1e2b3a",
  selectionForeground: "#eef4fb",
  black: "#1a222d",
  red: "#c47a86",
  green: "#7ea6a1",
  yellow: "#c0ab73",
  blue: "#8aa4c8",
  magenta: "#9a8cc0",
  cyan: "#7fb3c8",
  white: "#c5d0dd",
  brightBlack: "#5c6a79",
  brightRed: "#d18d98",
  brightGreen: "#90b7b1",
  brightYellow: "#ceb987",
  brightBlue: "#9bb4d6",
  brightMagenta: "#ac9dd0",
  brightCyan: "#92c1d3",
  brightWhite: "#eef4fb",
};

const springDarkTerminal: TerminalThemeDefinition = {
  background: "#1a1116",
  foreground: "#f0e1e7",
  cursor: "#d95f7e",
  cursorAccent: "#1a1116",
  selectionBackground: "#3b1f2a",
  selectionForeground: "#fff1f5",
  black: "#271920",
  red: "#d95f7e",
  green: "#4ca773",
  yellow: "#d5a054",
  blue: "#a78ce8",
  magenta: "#cf7eb3",
  cyan: "#5db6ab",
  white: "#dbc7cf",
  brightBlack: "#6c505a",
  brightRed: "#ea7592",
  brightGreen: "#63b988",
  brightYellow: "#e2b16a",
  brightBlue: "#b69bf1",
  brightMagenta: "#dd90c0",
  brightCyan: "#75c5bb",
  brightWhite: "#fff1f5",
};

const summerLightTerminal: TerminalThemeDefinition = {
  background: "#f6fbf7",
  foreground: "#23312a",
  cursor: "#2f9560",
  cursorAccent: "#f6fbf7",
  selectionBackground: "#d7eadc",
  selectionForeground: "#23312a",
  black: "#23312a",
  red: "#c15f5f",
  green: "#2f9560",
  yellow: "#a6853c",
  blue: "#4f8f79",
  magenta: "#7e73b2",
  cyan: "#3d9181",
  white: "#66786f",
  brightBlack: "#8d9d95",
  brightRed: "#d37272",
  brightGreen: "#44a871",
  brightYellow: "#bb9852",
  brightBlue: "#63a08b",
  brightMagenta: "#9085c4",
  brightCyan: "#53a193",
  brightWhite: "#23312a",
};

const autumnDarkTerminal: TerminalThemeDefinition = {
  background: "#17120f",
  foreground: "#eadfce",
  cursor: "#c08a3c",
  cursorAccent: "#17120f",
  selectionBackground: "#34261b",
  selectionForeground: "#fff6ea",
  black: "#231b16",
  red: "#c86d4b",
  green: "#8a8f62",
  yellow: "#c08a3c",
  blue: "#9b7c57",
  magenta: "#a26e90",
  cyan: "#87947f",
  white: "#cebea9",
  brightBlack: "#665545",
  brightRed: "#d9815f",
  brightGreen: "#9ca171",
  brightYellow: "#d1a055",
  brightBlue: "#ae906b",
  brightMagenta: "#b681a1",
  brightCyan: "#99a68f",
  brightWhite: "#fff6ea",
};

const winterLightTerminal: TerminalThemeDefinition = {
  background: "#f5f8fc",
  foreground: "#273241",
  cursor: "#6f89ad",
  cursorAccent: "#f5f8fc",
  selectionBackground: "#dbe4ef",
  selectionForeground: "#273241",
  black: "#273241",
  red: "#b96f7a",
  green: "#668a8a",
  yellow: "#a6925d",
  blue: "#6f89ad",
  magenta: "#8d7fa8",
  cyan: "#6f9ab0",
  white: "#6d7c8d",
  brightBlack: "#95a3b3",
  brightRed: "#c7828c",
  brightGreen: "#7a9d9d",
  brightYellow: "#b5a46f",
  brightBlue: "#829cbc",
  brightMagenta: "#9c90b5",
  brightCyan: "#82abbe",
  brightWhite: "#273241",
};

type SeasonalThemeFamily = Extract<ThemeFamily, "spring" | "summer" | "autumn" | "winter">;
type SeasonalAccentTone = Extract<IconTone, "accent" | "info" | "secondary">;

interface SeasonalMonacoConfig {
  base: MonacoThemeDefinition["base"];
  background: string;
  foreground: string;
  lineNumber: string;
  cursor: string;
  selection: string;
  string: string;
  keyword: string;
  comment: string;
}

interface SeasonalIconConfig {
  mobileAgentTone: SeasonalAccentTone;
  mobileFilesTone?: SeasonalAccentTone;
  mobileTerminalTone?: SeasonalAccentTone;
  terminalActionTone: SeasonalAccentTone;
  gitTone: SeasonalAccentTone;
}

interface SeasonalThemeConfig {
  family: SeasonalThemeFamily;
  kind: ThemeKind;
  terminalTheme: TerminalThemeDefinition;
  monaco: SeasonalMonacoConfig;
  icon: SeasonalIconConfig;
}

function createSeasonalMonacoTheme(config: SeasonalMonacoConfig): MonacoThemeDefinition {
  return {
    base: config.base,
    inherit: true,
    rules: [
      { token: "comment", foreground: config.comment },
      { token: "string", foreground: config.string },
      { token: "keyword", foreground: config.keyword },
    ],
    colors: {
      "editor.background": config.background,
      "editor.foreground": config.foreground,
      "editorLineNumber.foreground": config.lineNumber,
      "editorCursor.foreground": config.cursor,
      "editor.selectionBackground": config.selection,
    },
  };
}

function createSeasonalIconTheme(config: SeasonalIconConfig): IconThemeDefinition {
  return createIconTheme({
    "agent.provider.codex": {
      ...BASE_ICON_THEME.icons["agent.provider.codex"],
      tone: "accent",
    },
    "mobile.dock.agent": {
      ...BASE_ICON_THEME.icons["mobile.dock.agent"],
      tone: config.mobileAgentTone,
    },
    ...(config.mobileFilesTone
      ? {
          "mobile.dock.files": {
            ...BASE_ICON_THEME.icons["mobile.dock.files"],
            tone: config.mobileFilesTone,
          },
        }
      : {}),
    ...(config.mobileTerminalTone
      ? {
          "mobile.dock.terminal": {
            ...BASE_ICON_THEME.icons["mobile.dock.terminal"],
            tone: config.mobileTerminalTone,
          },
        }
      : {}),
    "terminal.action.new": {
      ...BASE_ICON_THEME.icons["terminal.action.new"],
      tone: config.terminalActionTone,
    },
    "git.branch": {
      ...BASE_ICON_THEME.icons["git.branch"],
      tone: config.gitTone,
    },
    "git.action.diff": {
      ...BASE_ICON_THEME.icons["git.action.diff"],
      tone: config.gitTone,
    },
    "git.action.push": {
      ...BASE_ICON_THEME.icons["git.action.push"],
      tone: config.gitTone,
    },
    "git.action.pull": {
      ...BASE_ICON_THEME.icons["git.action.pull"],
      tone: config.gitTone,
    },
    "git.action.refresh": {
      ...BASE_ICON_THEME.icons["git.action.refresh"],
      tone: config.gitTone,
    },
    "git.commit": {
      ...BASE_ICON_THEME.icons["git.commit"],
      tone: config.gitTone,
    },
  });
}

function createSeasonalThemeDefinition(config: SeasonalThemeConfig): AppThemeDefinition {
  const id = `${config.family}-${config.kind}`;
  const pairedKind = config.kind === "light" ? "dark" : "light";

  return {
    id,
    family: config.family,
    kind: config.kind,
    labelKey: `settings.theme.${config.family}_${config.kind}`,
    pairedThemeId: `${config.family}-${pairedKind}`,
    isHighContrast: false,
    documentThemeAttr: id,
    terminalTheme: config.terminalTheme,
    iconTheme: createSeasonalIconTheme(config.icon),
    monaco: createSeasonalMonacoTheme(config.monaco),
  };
}

const SEASONAL_THEME_CONFIGS: ReadonlyArray<SeasonalThemeConfig> = [
  {
    family: "spring",
    kind: "light",
    terminalTheme: springLightTerminal,
    monaco: {
      base: "vs",
      background: "#fff7f8",
      foreground: "#35252b",
      lineNumber: "#a3848d",
      cursor: "#c84b6a",
      selection: "#f3d9e2",
      string: "#2f7a57",
      keyword: "#c84b6a",
      comment: "#a3848d",
    },
    icon: {
      mobileAgentTone: "accent",
      mobileFilesTone: "secondary",
      mobileTerminalTone: "secondary",
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    family: "spring",
    kind: "dark",
    terminalTheme: springDarkTerminal,
    monaco: {
      base: "vs-dark",
      background: "#1a1116",
      foreground: "#f0e1e7",
      lineNumber: "#6c505a",
      cursor: "#d95f7e",
      selection: "#3b1f2a",
      string: "#63b988",
      keyword: "#d95f7e",
      comment: "#8f6f7b",
    },
    icon: {
      mobileAgentTone: "accent",
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    family: "summer",
    kind: "light",
    terminalTheme: summerLightTerminal,
    monaco: {
      base: "vs",
      background: "#f6fbf7",
      foreground: "#23312a",
      lineNumber: "#8d9d95",
      cursor: "#2f9560",
      selection: "#d7eadc",
      string: "#3f8457",
      keyword: "#2f9560",
      comment: "#8d9d95",
    },
    icon: {
      mobileAgentTone: "accent",
      mobileFilesTone: "secondary",
      mobileTerminalTone: "secondary",
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    family: "summer",
    kind: "dark",
    terminalTheme: summerDarkTerminal,
    monaco: {
      base: "vs-dark",
      background: "#111917",
      foreground: "#dbe7df",
      lineNumber: "#55665e",
      cursor: "#4db57a",
      selection: "#1d3328",
      string: "#8acb6f",
      keyword: "#4db57a",
      comment: "#55665e",
    },
    icon: {
      mobileAgentTone: "accent",
      mobileFilesTone: "secondary",
      mobileTerminalTone: "secondary",
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    family: "autumn",
    kind: "light",
    terminalTheme: autumnLightTerminal,
    monaco: {
      base: "vs",
      background: "#fdf8ef",
      foreground: "#3f3125",
      lineNumber: "#ab9988",
      cursor: "#b7791f",
      selection: "#f0dfbf",
      string: "#8a5a44",
      keyword: "#b7791f",
      comment: "#ab9988",
    },
    icon: {
      mobileAgentTone: "accent",
      mobileFilesTone: "secondary",
      mobileTerminalTone: "secondary",
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    family: "autumn",
    kind: "dark",
    terminalTheme: autumnDarkTerminal,
    monaco: {
      base: "vs-dark",
      background: "#17120f",
      foreground: "#eadfce",
      lineNumber: "#665545",
      cursor: "#c08a3c",
      selection: "#34261b",
      string: "#9ca171",
      keyword: "#c08a3c",
      comment: "#665545",
    },
    icon: {
      mobileAgentTone: "accent",
      terminalActionTone: "accent",
      gitTone: "accent",
    },
  },
  {
    family: "winter",
    kind: "light",
    terminalTheme: winterLightTerminal,
    monaco: {
      base: "vs",
      background: "#f5f8fc",
      foreground: "#273241",
      lineNumber: "#95a3b3",
      cursor: "#6f89ad",
      selection: "#dbe4ef",
      string: "#6f9ab0",
      keyword: "#6f89ad",
      comment: "#95a3b3",
    },
    icon: {
      mobileAgentTone: "info",
      mobileFilesTone: "secondary",
      mobileTerminalTone: "secondary",
      terminalActionTone: "info",
      gitTone: "info",
    },
  },
  {
    family: "winter",
    kind: "dark",
    terminalTheme: winterDarkTerminal,
    monaco: {
      base: "vs-dark",
      background: "#0f141b",
      foreground: "#d8e1ec",
      lineNumber: "#5c6a79",
      cursor: "#8aa4c8",
      selection: "#1e2b3a",
      string: "#9bb8d3",
      keyword: "#8aa4c8",
      comment: "#5c6a79",
    },
    icon: {
      mobileAgentTone: "info",
      mobileFilesTone: "secondary",
      mobileTerminalTone: "secondary",
      terminalActionTone: "info",
      gitTone: "info",
    },
  },
] as const;

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
        tone: "info",
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
        tone: "info",
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
        tone: "secondary",
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
        tone: "secondary",
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
        tone: "info",
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
        tone: "info",
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
  ...SEASONAL_THEME_CONFIGS.map((config) => createSeasonalThemeDefinition(config)),
];

registerIconThemes(THEMES_REGISTRY);

export function createWorkspaceMonacoTheme(theme: MonacoThemeDefinition): MonacoThemeDefinition {
  return {
    ...theme,
    colors: {
      ...theme.colors,
      "editor.background": "#00000000",
    },
  };
}

export const THEMES = THEMES_REGISTRY;
export const THEME_IDS = THEMES_REGISTRY.map((theme) => theme.id) as readonly string[];

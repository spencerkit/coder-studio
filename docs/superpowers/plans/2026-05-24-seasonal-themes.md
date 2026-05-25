# Seasonal Themes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add eight built-in seasonal themes (`spring|summer|autumn|winter` x `light|dark`) to the existing app theme system so Web UI, Monaco, terminal, icon tone, and the settings picker all express the approved four-season design without changing theme persistence or switching rules.

**Architecture:** Extend the existing registry-driven theme model instead of introducing a second theming layer. The implementation should keep semantic status colors stable, add seasonal color definition at the registry/token level, and let all existing consumers continue resolving the active theme through `themeId`.

**Tech Stack:** React 19, TypeScript 6, Jotai, Vite, Vitest + Testing Library, Monaco editor, xterm.js, CSS custom properties, existing theme registry/settings infrastructure.

**Spec reference:** `docs/superpowers/specs/2026-05-24-seasonal-themes-design.md`

---

## File Structure

**Modified files:**
- `packages/web/src/theme/registry.ts`
- `packages/web/src/theme/resolve.ts`
- `packages/web/src/theme/registry.test.ts`
- `packages/web/src/theme/resolve.test.ts`
- `packages/web/src/theme/icon-theme.test.ts`
- `packages/web/src/styles/tokens.css`
- `packages/web/src/styles/tokens-touch.test.ts`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/locales/en.json`
- `packages/web/src/locales/zh.json`
- `packages/web/src/ui-preview/catalog.test.tsx`
- `packages/web/src/ui-preview/scene-metadata.test.ts`

**Likely no new files needed:**
- The current theme system already supports additional theme IDs, Monaco definitions, terminal palettes, and icon theme overrides through `registry.ts`.
- The current `Select` already supports disabled options in both desktop listbox and mobile sheet, so seasonal grouping can be implemented without changing the shared component API.

**Primary ownership boundaries during execution:**
- Registry/resolution/test work stays in `packages/web/src/theme/*`
- Token/theme CSS work stays in `packages/web/src/styles/*`
- Settings picker, i18n, and picker tests stay in `packages/web/src/features/settings/*` plus locale JSON
- Preview/test fallout stays in `packages/web/src/ui-preview/*`

## Task 1: Extend Theme Registry and Resolvers for Seasonal Families

**Files:**
- Modify: `packages/web/src/theme/registry.ts`
- Modify: `packages/web/src/theme/resolve.ts`
- Modify: `packages/web/src/theme/registry.test.ts`
- Modify: `packages/web/src/theme/resolve.test.ts`

- [ ] **Step 1: Write failing registry and resolver tests for the seasonal theme contract**

Update `packages/web/src/theme/registry.test.ts` so the theme inventory test expects 16 built-in IDs and full family coverage:

```ts
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
```

Update the family coverage assertion to require:

```ts
{
  mint: ["dark", "light"],
  graphite: ["dark", "light"],
  nord: ["dark", "light"],
  hc: ["dark", "light"],
  spring: ["light", "dark"],
  summer: ["light", "dark"],
  autumn: ["light", "dark"],
  winter: ["light", "dark"],
}
```

Add targeted palette checks to prove the new themes are distinct and aligned with the approved design:

```ts
const springLight = THEMES.find((theme) => theme.id === "spring-light");
const summerDark = THEMES.find((theme) => theme.id === "summer-dark");
const autumnLight = THEMES.find((theme) => theme.id === "autumn-light");
const winterDark = THEMES.find((theme) => theme.id === "winter-dark");

expect(springLight?.terminalTheme).toEqual(
  expect.objectContaining({
    background: expect.any(String),
    cursor: expect.any(String),
    selectionBackground: expect.any(String),
  })
);
expect(summerDark?.monaco.colors).toEqual(
  expect.objectContaining({
    "editor.background": expect.any(String),
    "editorCursor.foreground": expect.any(String),
    "editor.selectionBackground": expect.any(String),
  })
);
expect(autumnLight?.family).toBe("autumn");
expect(winterDark?.family).toBe("winter");
```

Update `packages/web/src/theme/resolve.test.ts` with direct resolver assertions:

```ts
expect(getThemeById("spring-light").id).toBe("spring-light");
expect(getThemeFamily("summer-dark")).toBe("summer");
expect(getThemeVariant("autumn-light")).toBe("light");
expect(getThemeIdForFamilyVariant("winter", "dark")).toBe("winter-dark");
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts
```

Expected: failures because the registry still exposes only the original eight themes and `ThemeFamily` does not yet include the seasonal families.

- [ ] **Step 3: Extend `ThemeFamily` and add the eight seasonal registry entries**

In `packages/web/src/theme/registry.ts`, widen the family union:

```ts
export type ThemeFamily =
  | "mint"
  | "graphite"
  | "nord"
  | "hc"
  | "spring"
  | "summer"
  | "autumn"
  | "winter";
```

Then define eight new `AppThemeDefinition` entries in `THEMES_REGISTRY`, keeping the existing model unchanged:

```ts
{
  id: "spring-light",
  family: "spring",
  kind: "light",
  labelKey: "settings.theme.spring_light",
  pairedThemeId: "spring-dark",
  isHighContrast: false,
  documentThemeAttr: "spring-light",
  terminalTheme: springLightTerminal,
  iconTheme: springLightIconTheme,
  monaco: springLightMonaco,
},
{
  id: "spring-dark",
  family: "spring",
  kind: "dark",
  labelKey: "settings.theme.spring_dark",
  pairedThemeId: "spring-light",
  isHighContrast: false,
  documentThemeAttr: "spring-dark",
  terminalTheme: springDarkTerminal,
  iconTheme: springDarkIconTheme,
  monaco: springDarkMonaco,
},
```

Add the remaining six entries with the same field structure and these exact pairings:

```ts
"summer-light"  <-> "summer-dark"
"autumn-light"  <-> "autumn-dark"
"winter-light"  <-> "winter-dark"
```

Implementation rules:
- Keep `pairedThemeId` symmetrical.
- Keep `documentThemeAttr === id`.
- Keep `isHighContrast` false for all seasonal families.
- Keep terminal ANSI roles stable; use seasonal intent mainly in `cursor`, `selectionBackground`, and chosen accent channels.
- Keep Monaco backgrounds readable and neutral enough for long editing sessions; use seasonal accent mostly in cursor, selection, `keyword`, and `string`.

- [ ] **Step 4: Add concrete seasonal terminal, Monaco, and icon definitions**

Still in `packages/web/src/theme/registry.ts`, define focused constants near the existing palette constants:

```ts
const springLightTerminal: TerminalThemeDefinition = {
  background: "#fff8f7",
  foreground: "#34282a",
  cursor: "#c85c72",
  cursorAccent: "#fff8f7",
  selectionBackground: "#f3d9de",
  selectionForeground: "#34282a",
  black: "#2f2628",
  red: "#c94f63",
  green: "#5f8f63",
  yellow: "#b98a48",
  blue: "#8d7bb2",
  magenta: "#b66d9b",
  cyan: "#6d8eb1",
  white: "#b7a6aa",
  brightBlack: "#8f7e82",
  brightRed: "#d96579",
  brightGreen: "#74a576",
  brightYellow: "#caa15b",
  brightBlue: "#9e8cc1",
  brightMagenta: "#c47da9",
  brightCyan: "#82a3c5",
  brightWhite: "#34282a",
};

const summerDarkTerminal: TerminalThemeDefinition = {
  background: "#101813",
  foreground: "#e2ede5",
  cursor: "#5ea97a",
  cursorAccent: "#101813",
  selectionBackground: "#22372a",
  selectionForeground: "#e2ede5",
  black: "#263029",
  red: "#c96c72",
  green: "#5ea97a",
  yellow: "#c1a25e",
  blue: "#6f95c6",
  magenta: "#8a84c6",
  cyan: "#5f9e98",
  white: "#b6c8bb",
  brightBlack: "#5a6c5f",
  brightRed: "#d78286",
  brightGreen: "#79c191",
  brightYellow: "#d7b974",
  brightBlue: "#86aada",
  brightMagenta: "#9f98d7",
  brightCyan: "#78b7b0",
  brightWhite: "#e2ede5",
};
```

Define concrete Monaco constants the same way:

```ts
const springLightMonaco: MonacoThemeDefinition = {
  base: "vs",
  inherit: true,
  rules: [
    { token: "comment", foreground: "8b7f83" },
    { token: "string", foreground: "8c7852" },
    { token: "keyword", foreground: "c85c72" },
  ],
  colors: {
    "editor.background": "#fff8f7",
    "editor.foreground": "#34282a",
    "editorLineNumber.foreground": "#b29ca1",
    "editorCursor.foreground": "#c85c72",
    "editor.selectionBackground": "#f3d9de",
  },
};

const winterDarkMonaco: MonacoThemeDefinition = {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "comment", foreground: "7f8c99" },
    { token: "string", foreground: "9aa8b8" },
    { token: "keyword", foreground: "7da2c7" },
  ],
  colors: {
    "editor.background": "#11161b",
    "editor.foreground": "#e7edf4",
    "editorLineNumber.foreground": "#66717d",
    "editorCursor.foreground": "#7da2c7",
    "editor.selectionBackground": "#233244",
  },
};
```

For icon themes, define concrete constants and keep glyphs stable while shifting only accent-heavy semantics:

```ts
const springLightIconTheme = createIconTheme({
  "agent.provider.codex": {
    ...BASE_ICON_THEME.icons["agent.provider.codex"],
    tone: "accent",
  },
  "mobile.dock.agent": {
    ...BASE_ICON_THEME.icons["mobile.dock.agent"],
    tone: "accent",
  },
  "terminal.action.new": {
    ...BASE_ICON_THEME.icons["terminal.action.new"],
    tone: "accent",
  },
  "git.branch": {
    ...BASE_ICON_THEME.icons["git.branch"],
    tone: "accent",
  },
  "git.commit": {
    ...BASE_ICON_THEME.icons["git.commit"],
    tone: "accent",
  },
});

const winterDarkIconTheme = createIconTheme({
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
  "git.commit": {
    ...BASE_ICON_THEME.icons["git.commit"],
    tone: "accent",
  },
});
```

Keep semantic state icons (`state.success`, `state.warning`, `state.error`, `state.info`) unchanged so seasonal accent does not swallow status meaning.

- [ ] **Step 5: Keep resolver behavior unchanged except for the new families**

In `packages/web/src/theme/resolve.ts`, do not change fallback behavior. The only functional extension should be that the existing helpers can now resolve the seasonal families:

```ts
export function getThemeIdForFamilyVariant(
  family: ThemeFamily,
  variant: "dark" | "light"
): string | null {
  return THEMES.find((theme) => theme.family === family && theme.kind === variant)?.id ?? null;
}
```

No new persistence format, no new legacy mappings, and the default fallback remains `mint-dark`.

- [ ] **Step 6: Run the focused registry verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts
```

Expected: all assertions pass with the new 16-theme registry.

- [ ] **Step 7: Commit Task 1**

Run:

```bash
git add \
  packages/web/src/theme/registry.ts \
  packages/web/src/theme/resolve.ts \
  packages/web/src/theme/registry.test.ts \
  packages/web/src/theme/resolve.test.ts
git commit -m "feat: add seasonal theme registry definitions"
```

## Task 2: Add Seasonal CSS Token Blocks and Style Coverage

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Modify: `packages/web/src/theme/icon-theme.test.ts`

- [ ] **Step 1: Write failing tests for token coverage across all built-in themes**

In `packages/web/src/styles/tokens-touch.test.ts`, extend `builtInThemes`:

```ts
const builtInThemes = [
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
] as const;
```

Update the named theme block assertion to require the new selectors:

```ts
expect(stylesheet).toContain('[data-theme="spring-light"]');
expect(stylesheet).toContain('[data-theme="spring-dark"]');
expect(stylesheet).toContain('[data-theme="summer-light"]');
expect(stylesheet).toContain('[data-theme="summer-dark"]');
expect(stylesheet).toContain('[data-theme="autumn-light"]');
expect(stylesheet).toContain('[data-theme="autumn-dark"]');
expect(stylesheet).toContain('[data-theme="winter-light"]');
expect(stylesheet).toContain('[data-theme="winter-dark"]');
```

Add token assertions for the per-theme overlay overrides block near the bottom of the file:

```ts
expect(getRuleBlock('[data-theme="spring-light"]')).toContain("--state-focus-ring-color");
expect(getRuleBlock('[data-theme="summer-dark"]')).toContain("--surface-overlay-bg");
expect(getRuleBlock('[data-theme="autumn-light"]')).toContain("--radius-overlay");
expect(getRuleBlock('[data-theme="winter-dark"]')).toContain("--gap-content");
```

In `packages/web/src/theme/icon-theme.test.ts`, extend every explicit built-in theme loop to include the seasonal theme IDs, and add a focused assertion that seasonal themes keep shared status/icon hierarchy stable:

```ts
for (const themeId of [
  "spring-light",
  "spring-dark",
  "summer-light",
  "summer-dark",
  "autumn-light",
  "autumn-dark",
  "winter-light",
  "winter-dark",
] as const) {
  expect(getIconPresentation(themeId, "git.footer.diff")).toEqual(
    expect.objectContaining({ tone: "warning" })
  );
  expect(getIconPresentation(themeId, "git.footer.push")).toEqual(
    expect.objectContaining({ tone: "success" })
  );
}
```

- [ ] **Step 2: Run the focused style/icon tests to verify they fail**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/tokens-touch.test.ts \
  src/theme/icon-theme.test.ts
```

Expected: failures because the new theme selectors and seasonal icon-theme coverage do not yet exist.

- [ ] **Step 3: Add the eight seasonal `[data-theme="..."]` token blocks**

In `packages/web/src/styles/tokens.css`, add one full token block for each seasonal theme, following the same structure used by the existing theme families:

```css
[data-theme="spring-light"] {
  --bg-page: #fff4f3;
  --bg-surface: #fffaf9;
  --bg-sidebar: #f9eceb;
  --bg-terminal: #fff7f6;
  --bg-hover: #f5e2e0;
  --bg-active: #efd1d0;
  --bg-disabled: #f4efef;
  --bg-input: #ffffff;

  --border: #e5c9cc;
  --border-light: #edd8da;
  --border-focus: #c85c72;
  --border-error: #d85d74;

  --text-primary: #34282a;
  --text-secondary: #6f585d;
  --text-tertiary: #9a8388;
  --text-disabled: #baa7ab;
  --text-inverse: #fffaf9;

  --accent-blue: #9d7fa8;
  --accent-green: #7a9a6f;
  --accent-amber: #bf8b4d;
  --accent-pink: #c85c72;
  --accent-red: var(--color-error);
  --accent-purple: #a36aa2;

  --color-success: #4f8a66;
  --color-warning: #b68442;
  --color-error: #d85d74;
  --color-info: #6d8eb1;
  --bg-panel: color-mix(in srgb, var(--bg-surface) 92%, var(--bg-sidebar));
  --bg-elevated: color-mix(in srgb, var(--bg-surface) 96%, white 4%);
  --state-focus-ring-color: var(--border-focus);
  --state-focus-ring-offset: 2px;
  --state-focus-ring-width: 2px;
  --state-hover-bg: var(--bg-hover);
  --state-hover-border: var(--border-light);
  --state-hover-text: var(--text-primary);
  --state-active-bg: var(--bg-active);
  --state-selected-bg: color-mix(in srgb, var(--accent-pink) 18%, var(--bg-surface));
  --state-selected-border: color-mix(in srgb, var(--accent-pink) 48%, var(--border));
  --state-selected-text: var(--text-primary);
  --state-disabled-bg: var(--bg-disabled);
  --state-disabled-border: var(--border);
  --state-disabled-text: var(--text-disabled);
  --state-success-bg: color-mix(in srgb, var(--color-success) 18%, var(--bg-surface));
  --state-success-border: color-mix(in srgb, var(--color-success) 48%, var(--border));
  --state-success-text: var(--color-success);
  --state-warning-bg: color-mix(in srgb, var(--color-warning) 18%, var(--bg-surface));
  --state-warning-border: color-mix(in srgb, var(--color-warning) 48%, var(--border));
  --state-warning-text: var(--color-warning);
  --state-error-bg: color-mix(in srgb, var(--color-error) 18%, var(--bg-surface));
  --state-error-border: color-mix(in srgb, var(--color-error) 48%, var(--border));
  --state-error-text: var(--color-error);
  --state-info-bg: color-mix(in srgb, var(--color-info) 18%, var(--bg-surface));
  --state-info-border: color-mix(in srgb, var(--color-info) 48%, var(--border));
  --state-info-text: var(--color-info);
  --surface-canvas: var(--bg-page);
  --surface-panel: var(--bg-panel);
  --surface-panel-border: var(--border);
  --surface-elevated: var(--bg-elevated);
  --surface-elevated-border: var(--border-light);
  --surface-input: var(--bg-input);
  --surface-input-border: var(--border);
  --surface-muted: var(--bg-sidebar);
  --surface-inverse: var(--text-primary);
  --overlay-backdrop: color-mix(in srgb, var(--bg-page) 68%, transparent);
  --overlay-scrim: color-mix(in srgb, var(--bg-page) 82%, transparent);
  --overlay-panel: var(--bg-elevated);
  --overlay-panel-border: var(--border-light);
  --overlay-local-backdrop: color-mix(in srgb, var(--bg-page) 54%, transparent);
  --overlay-local-panel: var(--bg-panel);
  --overlay-local-panel-border: var(--border);
  --icon-primary: var(--text-primary);
  --icon-secondary: var(--text-secondary);
  --icon-muted: var(--text-tertiary);
  --icon-accent: var(--accent-pink);
  --icon-success: var(--color-success);
  --icon-warning: var(--color-warning);
  --icon-error: var(--color-error);
  --icon-info: var(--color-info);
  --icon-file-folder: #d8848d;
  --icon-file-code: var(--accent-blue);
  --icon-file-data: var(--accent-purple);
  --icon-file-doc: #a98f93;
  --icon-file-media: #da98a1;
  --icon-file-default: var(--text-secondary);
  --icon-git-staged: var(--color-success);
  --icon-git-modified: var(--color-warning);
  --icon-git-deleted: var(--color-error);
  --icon-git-untracked: var(--color-info);
  --icon-surface-subtle: color-mix(in srgb, var(--text-secondary) 16%, var(--bg-surface));
  --icon-surface-accent: color-mix(in srgb, var(--accent-pink) 18%, var(--bg-surface));
  --icon-surface-success: color-mix(in srgb, var(--color-success) 18%, var(--bg-surface));
  --icon-surface-warning: color-mix(in srgb, var(--color-warning) 18%, var(--bg-surface));
  --icon-surface-error: color-mix(in srgb, var(--color-error) 18%, var(--bg-surface));
  --icon-surface-info: color-mix(in srgb, var(--color-info) 18%, var(--bg-surface));
  --shadow-sm: 0 1px 2px rgba(63, 38, 42, 0.08);
  --shadow-md: 0 4px 12px rgba(63, 38, 42, 0.1);
  --shadow-lg: 0 8px 32px rgba(63, 38, 42, 0.12);
  --shadow-xl: 0 16px 48px rgba(63, 38, 42, 0.16);
  --shadow-glow: 0 0 12px rgba(200, 92, 114, 0.18);
  --scrollbar-thumb: #dbc1c5;
}
```

Use these exact seasonal accent targets when filling the other seven blocks:
- `spring-dark`: `--border-focus: #d77488`, `--accent-pink: #d77488`, `--icon-accent: #d77488`, `--surface-overlay-bg: color-mix(in srgb, #211618 96%, transparent)`
- `summer-light`: `--border-focus: #5f9a67`, `--accent-green: #5f9a67`, `--icon-accent: #5f9a67`, `--surface-overlay-bg: color-mix(in srgb, #fbfdf9 96%, transparent)`
- `summer-dark`: `--border-focus: #79c191`, `--accent-green: #79c191`, `--icon-accent: #79c191`, `--surface-overlay-bg: color-mix(in srgb, #162019 96%, transparent)`
- `autumn-light`: `--border-focus: #b98946`, `--accent-amber: #b98946`, `--icon-accent: #b98946`, `--surface-overlay-bg: color-mix(in srgb, #fffaf2 96%, transparent)`
- `autumn-dark`: `--border-focus: #d0a35a`, `--accent-amber: #d0a35a`, `--icon-accent: #d0a35a`, `--surface-overlay-bg: color-mix(in srgb, #221a12 96%, transparent)`
- `winter-light`: `--border-focus: #7d9fbe`, `--color-info: #7d9fbe`, `--icon-accent: #7d9fbe`, `--surface-overlay-bg: color-mix(in srgb, #fbfcfe 96%, transparent)`
- `winter-dark`: `--border-focus: #8bb0d3`, `--color-info: #8bb0d3`, `--icon-accent: #8bb0d3`, `--surface-overlay-bg: color-mix(in srgb, #161b22 96%, transparent)`

Use the existing theme blocks as the exact token template. Every seasonal block must define the same background, border, text, accent, semantic, icon, and shadow tokens already defined by the non-seasonal themes.

- [ ] **Step 4: Add the matching per-theme overlay/focus override blocks**

Near the bottom override section that currently contains:

```css
[data-theme="mint-dark"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #6cb6ff;
  --surface-overlay-bg: color-mix(in srgb, #131b22 96%, transparent);
}

[data-theme="mint-light"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #158f77;
  --surface-overlay-bg: color-mix(in srgb, #ffffff 96%, transparent);
}
```

add entries for all eight seasonal themes:

```css
[data-theme="spring-light"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #c85c72;
  --surface-overlay-bg: color-mix(in srgb, #fffaf9 96%, transparent);
}
```

Add these exact sibling override blocks as well:

```css
[data-theme="spring-dark"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #d77488;
  --surface-overlay-bg: color-mix(in srgb, #211618 96%, transparent);
}

[data-theme="summer-light"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #5f9a67;
  --surface-overlay-bg: color-mix(in srgb, #fbfdf9 96%, transparent);
}

[data-theme="summer-dark"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #79c191;
  --surface-overlay-bg: color-mix(in srgb, #162019 96%, transparent);
}

[data-theme="autumn-light"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #b98946;
  --surface-overlay-bg: color-mix(in srgb, #fffaf2 96%, transparent);
}

[data-theme="autumn-dark"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #d0a35a;
  --surface-overlay-bg: color-mix(in srgb, #221a12 96%, transparent);
}

[data-theme="winter-light"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #7d9fbe;
  --surface-overlay-bg: color-mix(in srgb, #fbfcfe 96%, transparent);
}

[data-theme="winter-dark"] {
  --gap-content: var(--sp-3);
  --radius-overlay: var(--radius-xl);
  --state-focus-ring-color: #8bb0d3;
  --surface-overlay-bg: color-mix(in srgb, #161b22 96%, transparent);
}
```

- [ ] **Step 5: Ensure seasonal icon accents are driven by token colors, not semantic state colors**

While editing `tokens.css`, make the seasonal accent direction visible mainly through:

```css
--icon-accent: var(--accent-pink);   /* spring */
--icon-accent: var(--accent-green);  /* summer */
--icon-accent: var(--accent-amber);  /* autumn */
--icon-accent: var(--color-info);    /* winter */
--icon-surface-accent: color-mix(in srgb, var(--icon-accent) 18%, var(--bg-surface));
--shadow-glow: 0 0 12px rgba(200, 92, 114, 0.18);  /* spring reference */
--shadow-glow: 0 0 12px rgba(121, 193, 145, 0.2);  /* summer reference */
--shadow-glow: 0 0 12px rgba(208, 163, 90, 0.2);   /* autumn reference */
--shadow-glow: 0 0 12px rgba(139, 176, 211, 0.18); /* winter reference */
--state-selected-bg: color-mix(in srgb, var(--icon-accent) 18%, var(--bg-surface));
--state-selected-border: color-mix(in srgb, var(--icon-accent) 48%, var(--border));
```

Do not change these semantic mappings:

```css
--icon-success: var(--color-success);
--icon-warning: var(--color-warning);
--icon-error: var(--color-error);
--icon-info: var(--color-info);
```

This preserves the spec’s boundary between seasonal accent and system status semantics.

- [ ] **Step 6: Run the focused style/icon verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/tokens-touch.test.ts \
  src/theme/icon-theme.test.ts
```

Expected: token coverage and icon hierarchy tests pass for all 16 themes.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add \
  packages/web/src/styles/tokens.css \
  packages/web/src/styles/tokens-touch.test.ts \
  packages/web/src/theme/icon-theme.test.ts
git commit -m "feat: add seasonal theme tokens"
```

## Task 3: Update Theme Picker Ordering, Grouping, and Locale Strings

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/en.json`
- Modify: `packages/web/src/locales/zh.json`

- [ ] **Step 1: Write failing settings tests for seasonal options and grouping**

In `packages/web/src/features/settings/components/settings-page.test.tsx`, extend the appearance picker coverage with explicit seasonal expectations:

```ts
const picker = await screen.findByRole("button", { name: "Theme Mint Dark" });
fireEvent.click(picker);

const listbox = await screen.findByRole("listbox", { name: "Theme" });
expect(within(listbox).getByRole("option", { name: "Spring Light" })).toBeInTheDocument();
expect(within(listbox).getByRole("option", { name: "Spring Dark" })).toBeInTheDocument();
expect(within(listbox).getByRole("option", { name: "Summer Light" })).toBeInTheDocument();
expect(within(listbox).getByRole("option", { name: "Autumn Dark" })).toBeInTheDocument();
expect(within(listbox).getByRole("option", { name: "Winter Dark" })).toBeInTheDocument();
```

Add assertions for disabled section headers rendered as non-selectable options:

```ts
expect(within(listbox).getByRole("option", { name: "Core Themes" })).toHaveAttribute(
  "aria-disabled",
  "true"
);
expect(within(listbox).getByRole("option", { name: "Seasonal Themes" })).toHaveAttribute(
  "aria-disabled",
  "true"
);
```

Add a selection assertion proving seasonal themes can still be chosen:

```ts
fireEvent.click(within(listbox).getByRole("option", { name: "Winter Dark" }));

await waitFor(() => {
  expect(sendCommand).toHaveBeenCalledWith(
    "settings.update",
    {
      settings: {
        appearance: {
          themeId: "winter-dark",
        },
      },
    },
    undefined
  );
});
```

- [ ] **Step 2: Run the focused settings test to verify it fails**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx
```

Expected: failures because the theme picker still maps directly from `THEMES` with no seasonal labels or grouping.

- [ ] **Step 3: Add locale strings for seasonal themes and picker groups**

In both locale files, extend `settings.theme` with:

```json
"family_spring": "Spring",
"family_summer": "Summer",
"family_autumn": "Autumn",
"family_winter": "Winter",
"group_core": "Core Themes",
"group_seasonal": "Seasonal Themes",
"spring_light": "Spring Light",
"spring_dark": "Spring Dark",
"summer_light": "Summer Light",
"summer_dark": "Summer Dark",
"autumn_light": "Autumn Light",
"autumn_dark": "Autumn Dark",
"winter_light": "Winter Light",
"winter_dark": "Winter Dark"
```

And the Chinese equivalents:

```json
"family_spring": "春",
"family_summer": "夏",
"family_autumn": "秋",
"family_winter": "冬",
"group_core": "基础主题",
"group_seasonal": "四季主题",
"spring_light": "春·浅色",
"spring_dark": "春·深色",
"summer_light": "夏·浅色",
"summer_dark": "夏·深色",
"autumn_light": "秋·浅色",
"autumn_dark": "秋·深色",
"winter_light": "冬·浅色",
"winter_dark": "冬·深色"
```

- [ ] **Step 4: Replace direct `THEMES.map(...)` picker generation with ordered grouped options**

In `packages/web/src/features/settings/components/settings-page.tsx`, replace:

```ts
const themeOptions = THEMES.map((registeredTheme) => ({
  value: registeredTheme.id,
  label: t(registeredTheme.labelKey),
}));
```

with an explicit ordered option builder:

```ts
const CORE_THEME_IDS = [
  "mint-dark",
  "mint-light",
  "graphite-dark",
  "graphite-light",
  "nord-dark",
  "nord-light",
  "hc-dark",
  "hc-light",
] as const;

const SEASONAL_THEME_IDS = [
  "spring-light",
  "spring-dark",
  "summer-light",
  "summer-dark",
  "autumn-light",
  "autumn-dark",
  "winter-light",
  "winter-dark",
] as const;

const themeDefinitionsById = new Map(THEMES.map((theme) => [theme.id, theme]));

const themeOptions = [
  { value: "__group_core", label: t("settings.theme.group_core"), disabled: true },
  ...CORE_THEME_IDS.map((themeId) => ({
    value: themeId,
    label: t(themeDefinitionsById.get(themeId)!.labelKey),
  })),
  { value: "__group_seasonal", label: t("settings.theme.group_seasonal"), disabled: true },
  ...SEASONAL_THEME_IDS.map((themeId) => ({
    value: themeId,
    label: t(themeDefinitionsById.get(themeId)!.labelKey),
  })),
];
```

Implementation rules:
- Keep the existing `Select` component API unchanged.
- Use disabled options for section headers so they appear in both desktop listbox and mobile sheet.
- Preserve the existing `handleThemeSelection` behavior; only real theme options should call it.
- Keep the current selected label based on the stored theme ID, not the header rows.

- [ ] **Step 5: Run the focused settings verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx
```

Expected: the appearance picker renders seasonal items, shows disabled group headers, and updates `appearance.themeId` correctly for seasonal choices.

- [ ] **Step 6: Commit Task 3**

Run:

```bash
git add \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/locales/en.json \
  packages/web/src/locales/zh.json
git commit -m "feat: add seasonal themes to settings picker"
```

## Task 4: Fix Secondary Test and Preview Fallout

**Files:**
- Modify: `packages/web/src/ui-preview/catalog.test.tsx`
- Modify: `packages/web/src/ui-preview/scene-metadata.test.ts`
- Modify: `packages/web/src/theme/icon-theme.test.ts`

- [ ] **Step 1: Write/adjust failing tests for theme-typed preview helpers**

In `packages/web/src/ui-preview/catalog.test.tsx`, widen the `renderScene` helper from the hard-coded mint union:

```ts
import type { UiPreviewSceneTheme } from "./scene-metadata";

function renderScene(
  sceneId: string,
  device: "desktop" | "mobile" = "desktop",
  theme: UiPreviewSceneTheme = "mint-dark"
) {
  const scene = getUiPreviewScene(sceneId);
  if (!scene) {
    throw new Error(`Missing scene ${sceneId}`);
  }

  installMatchMedia(device);
  const context = { theme, locale: "en" as const, device };
  const store = buildUiPreviewStore(scene.seed(context));
  const router = scene.router(context);

  document.documentElement.setAttribute("data-theme", getThemeById(theme).documentThemeAttr);
  document.documentElement.setAttribute("lang", "en");
  document.body.dataset.uiPreviewDevice = device;

  return render(
    <Provider store={store}>
      <MemoryRouter initialEntries={router.initialEntries}>
        <Routes>
          <Route path={router.path} element={scene.render(context)} />
        </Routes>
      </MemoryRouter>
    </Provider>
  );
}
```

If the file still uses literal unions elsewhere, replace them with `UiPreviewSceneTheme` or `(typeof THEME_IDS)[number]`.

Add or keep assertions that route-backed scenes still enumerate all built-in themes through `THEME_IDS`, so the new seasonal themes are automatically covered:

```ts
expect(
  UI_PREVIEW_SCENE_METADATA.filter(
    (scene) =>
      scene.source === "real-route" &&
      (scene.id === "workspace-desktop" || scene.id === "workspace-mobile")
  ).map((scene) => scene.themes)
).toEqual([[...THEME_IDS], [...THEME_IDS]]);
```

- [ ] **Step 2: Run the affected preview/theme tests to verify any fallout**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/ui-preview/catalog.test.tsx \
  src/ui-preview/scene-metadata.test.ts \
  src/theme/icon-theme.test.ts
```

Expected: at least `catalog.test.tsx` fails before the helper type is widened if the literal union is still present.

- [ ] **Step 3: Fix preview typing and any remaining explicit built-in theme lists**

Apply the narrowest changes necessary:
- Replace explicit `"mint-dark" | "mint-light"` helper unions with the real built-in theme type.
- Update any remaining hard-coded theme arrays in tests so they include all seasonal IDs or derive from `THEME_IDS`.
- Do not change scene metadata behavior unless a test proves a real mismatch.

Preferred patterns:

```ts
for (const themeId of THEME_IDS) {
  expect(getThemeById(themeId).documentThemeAttr).toBe(themeId);
}
```

or:

```ts
type BuiltInThemeId = (typeof THEME_IDS)[number];
```

- [ ] **Step 4: Run the fallout verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/ui-preview/catalog.test.tsx \
  src/ui-preview/scene-metadata.test.ts \
  src/theme/icon-theme.test.ts
```

Expected: preview/theme tests pass without special-casing the old eight-theme inventory.

- [ ] **Step 5: Commit Task 4**

Run:

```bash
git add \
  packages/web/src/ui-preview/catalog.test.tsx \
  packages/web/src/ui-preview/scene-metadata.test.ts \
  packages/web/src/theme/icon-theme.test.ts
git commit -m "test: align preview coverage with seasonal themes"
```

## Task 5: Final Verification and Implementation Review

**Files:**
- Review all files changed by Tasks 1-4

- [ ] **Step 1: Run the full focused verification suite**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts \
  src/theme/icon-theme.test.ts \
  src/styles/tokens-touch.test.ts \
  src/features/settings/components/settings-page.test.tsx \
  src/ui-preview/catalog.test.tsx \
  src/ui-preview/scene-metadata.test.ts
```

Expected: all focused theme-related tests pass.

- [ ] **Step 2: Run package-level web tests if the focused suite is green**

Run:

```bash
pnpm --filter @coder-studio/web test
```

Expected: package-level web tests pass. If unrelated pre-existing failures appear, record them with exact test names before deciding whether any are caused by the seasonal-theme changes.

- [ ] **Step 3: Run lint on the touched files or repo-wide check if required by the workspace**

Run:

```bash
pnpm ci:lint
```

Expected: no lint violations introduced by the seasonal-theme changes.

- [ ] **Step 4: Re-read the spec and verify the implementation against each requirement**

Use this checklist:
- eight seasonal built-in themes exist
- existing theme-switching mechanism is unchanged
- Web UI, Monaco, terminal, and icon theme all have seasonal definitions
- spring uses flower-red accent without collapsing into error
- summer uses life-green accent without collapsing into success
- autumn uses amber/wheat/yellow family without becoming warning yellow
- winter uses quiet white/cold gray-blue without becoming normal info blue
- settings UI clearly exposes seasonal themes and light/dark pairing

If any item fails, fix it before concluding.

- [ ] **Step 5: Commit final cleanup if needed**

Run:

```bash
git add packages/web/src
git commit -m "chore: polish seasonal theme coverage"
```

Only create this commit if verification uncovered real follow-up fixes after Tasks 1-4.

## Execution Notes

- Follow TDD within each task: write the failing test, run it to confirm the failure, then implement the smallest code change that makes it pass.
- Keep seasonal accent expression stronger in `accent` / `selection` / `focus` / `icon accent` than in large surfaces.
- Do not change persisted settings shape, fallback theme behavior, or shared `Select` component API.
- Do not introduce a second seasonal settings model, automatic season switching, background images, or animation-based season effects.

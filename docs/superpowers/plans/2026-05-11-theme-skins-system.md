# Theme Skins System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the current dark/light appearance toggle into a multi-skin theme system driven by a single persisted `themeId`, with shared theme metadata powering Web UI tokens, xterm terminal themes, Monaco editor themes, and preview/e2e infrastructure.

**Architecture:** Keep the user-facing settings model simple by persisting only `appearance.themeId`, then centralize all actual theme behavior behind a shared web theme registry. Each theme definition carries metadata (`family`, `kind`, high-contrast flags, paired theme ID) plus explicit UI/xterm/Monaco definitions. Web bootstrap, settings UI, xterm, Monaco, and preview tools all resolve the active theme through the same registry instead of branching directly on `dark | light`.

**Tech Stack:** React 19, TypeScript 6, Jotai, Vite, Vitest + Testing Library, Playwright, xterm.js, Monaco editor, CSS custom properties, Zod.

**Spec reference:** `docs/superpowers/specs/2026-05-11-theme-skins-design.md`

---

## File Structure

**New files:**
- `packages/web/src/theme/index.ts`
- `packages/web/src/theme/registry.ts`
- `packages/web/src/theme/resolve.ts`
- `packages/web/src/theme/registry.test.ts`
- `packages/web/src/theme/resolve.test.ts`
- `docs/superpowers/specs/2026-05-11-theme-skins-design.md` already exists; do not modify unless plan execution exposes a spec bug

**Modified files:**
- `packages/core/src/domain/types.ts`
- `packages/server/src/commands/settings.ts`
- `packages/server/src/commands/settings.test.ts`
- `packages/web/src/atoms/app-ui.ts`
- `packages/web/src/app/providers.tsx`
- `packages/web/src/app/providers.lifecycle.test.tsx`
- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/features/code-editor/components/monaco-host.tsx`
- `packages/web/src/features/code-editor/components/monaco-host.test.tsx`
- `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- `packages/web/src/styles/tokens.css`
- `packages/web/src/styles/tokens-touch.test.ts`
- `packages/web/src/styles/components.theme.test.ts`
- `packages/web/src/locales/zh.json`
- `packages/web/src/locales/en.json`
- `packages/web/src/ui-preview/app.tsx`
- `packages/web/src/ui-preview/app.test.tsx`
- `packages/web/src/ui-preview/catalog.ts`
- `packages/web/src/ui-preview/preview-store.ts`
- `packages/web/src/ui-preview/scene-metadata.ts`
- `packages/web/src/ui-preview/scenes/page-scenes.tsx`
- `e2e-ui/scenes/index.ts`
- `e2e-ui/fixtures/prefs.ts`
- `e2e-ui/fixtures/scene-runner.ts`
- `e2e-ui/report/build-report.ts`
- `e2e-ui/report/build-report.test.ts`
- `e2e/specs/settings/general.spec.ts`
- `e2e/specs/quality/general.spec.ts`

**Likely no changes in this plan:**
- `packages/web/src/styles/components.css` beyond token consumption behavior that already exists
- server database schema or migrations
- provider/runtime code
- auth flows
- route structure

## Task 1: Establish Shared Theme Types and Registry

**Files:**
- Create: `packages/web/src/theme/index.ts`
- Create: `packages/web/src/theme/registry.ts`
- Create: `packages/web/src/theme/resolve.ts`
- Create: `packages/web/src/theme/registry.test.ts`
- Create: `packages/web/src/theme/resolve.test.ts`
- Modify: `packages/core/src/domain/types.ts`

- [ ] **Step 1: Write failing registry and resolver tests**

Add tests that codify the first-phase contract:

```ts
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

expect(resolveStoredThemeId("dark")).toBe("mint-dark");
expect(resolveStoredThemeId("light")).toBe("mint-light");
expect(resolveStoredThemeId("mint-dark")).toBe("mint-dark");
expect(resolveStoredThemeId("missing-theme")).toBe("mint-dark");
```

Also assert:

- all IDs are unique
- every theme has `family`, `kind`, `documentThemeAttr`, `terminalTheme`, `monaco`
- all `pairedThemeId` values point to real themes
- high contrast themes are flagged with `isHighContrast: true`

- [ ] **Step 2: Introduce shared theme types**

Update `packages/core/src/domain/types.ts` to export the web-consumed settings type shape needed by the rest of the app. At minimum, stop baking `appearance.theme: "dark"` into the shared `Settings` interface. Replace it with a string-based theme ID field:

```ts
appearance: {
  themeId: string;
  terminalRenderer: "standard" | "compatibility";
  locale: "zh" | "en";
};
```

Keep this change additive and pragmatic:

- do not attempt to model all theme IDs as a cross-package literal union yet
- do not remove unrelated settings fields

- [ ] **Step 3: Implement the central theme registry**

In `packages/web/src/theme/registry.ts`, define:

- `ThemeFamily`
- `ThemeKind`
- `AppThemeDefinition`
- the eight first-phase theme definitions

Each theme definition must include:

- `id`
- `family`
- `kind`
- `labelKey`
- `pairedThemeId`
- `isHighContrast`
- `documentThemeAttr`
- explicit xterm palette
- Monaco base theme metadata and colors

In `packages/web/src/theme/resolve.ts`, implement focused helpers:

- `getThemeById(themeId: string): AppThemeDefinition`
- `resolveStoredThemeId(value: unknown): string`
- `getThemeFamily(themeId: string): ThemeFamily`
- `getThemeVariant(themeId: string): "dark" | "light"`
- `getThemeIdForFamilyVariant(family: ThemeFamily, variant: "dark" | "light"): string | null`

Default behavior:

- unknown values resolve to `mint-dark`
- legacy `dark` resolves to `mint-dark`
- legacy `light` resolves to `mint-light`

- [ ] **Step 4: Export the theme utilities**

From `packages/web/src/theme/index.ts`, export the registry constants and resolver helpers. Keep consumers importing from the barrel, not deep internal file paths.

- [ ] **Step 5: Run the focused registry verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts
```

Expected: all new tests fail before implementation, then pass after the registry and resolver are in place.

## Task 2: Migrate Settings Persistence and Bootstrap to `themeId`

**Files:**
- Modify: `packages/server/src/commands/settings.ts`
- Modify: `packages/server/src/commands/settings.test.ts`
- Modify: `packages/web/src/atoms/app-ui.ts`
- Modify: `packages/web/src/app/providers.tsx`
- Modify: `packages/web/src/app/providers.lifecycle.test.tsx`

- [ ] **Step 1: Write failing server settings tests for `appearance.themeId`**

Add tests that lock in:

```ts
await dispatch({
  kind: "command",
  id: "settings-update-theme-id",
  op: "settings.update",
  args: { settings: { appearance: { themeId: "graphite-light" } } },
}, ctx);

expect(
  db.prepare("SELECT value FROM user_settings WHERE key = ?").get("appearance.themeId")
).toEqual({ value: '"graphite-light"' });
```

Also add a `settings.get` test that:

- inserts `appearance.themeId = "nord-dark"` into `user_settings`
- confirms `settings.get` returns `"appearance.themeId": "nord-dark"`

- [ ] **Step 2: Extend server settings schema without breaking migration**

In `packages/server/src/commands/settings.ts`:

- add `appearance.themeId: z.string().optional()`
- keep `appearance.theme: z.enum(["dark"]).optional()` or widen it to accept `"dark" | "light"` only if existing tests require it
- do not remove existing `terminalRenderer`, `terminalCopyOnSelect`, or `locale`

Requirements:

- `settings.update` accepts new `themeId`
- flattening continues to persist `appearance.themeId` as a dot-path key
- migration remains “read old, write new” at the app layer; the server only needs to accept both

- [ ] **Step 3: Replace the web theme atom with `themeId` storage**

In `packages/web/src/atoms/app-ui.ts`:

- migrate `themeAtom` from `atomWithStorage<"dark" | "light">("ui.theme", "dark")`
- to `atomWithStorage<string>("ui.themeId", "mint-dark")`

Also introduce a compatibility helper in the theme module if the atom bootstrap needs to normalize legacy values after load.

- [ ] **Step 4: Apply theme resolution during app bootstrap**

In `packages/web/src/app/providers.tsx`:

- replace the localStorage bootstrap that reads `ui.theme`
- read `ui.themeId` first
- if absent, read legacy `ui.theme`
- normalize via `resolveStoredThemeId`
- set `document.documentElement.setAttribute("data-theme", resolvedTheme.documentThemeAttr)`

When `settings.get` data is available:

- prefer `settings["appearance.themeId"]`
- else fall back to `settings["appearance.theme"]`
- normalize through the resolver
- update the theme atom
- write the normalized `ui.themeId` cache back to localStorage

Do not rewrite unrelated connection logic.

- [ ] **Step 5: Add bootstrap lifecycle tests**

Expand `packages/web/src/app/providers.lifecycle.test.tsx` to verify:

- legacy `ui.theme = "light"` bootstraps the document to `mint-light`
- `settings.get` returning `appearance.themeId = "graphite-dark"` updates the document theme and atom
- server-provided `appearance.themeId` wins over local legacy storage

Use existing mocked `sendCommand` plumbing; do not add browser-integration-only assertions.

- [ ] **Step 6: Run the persistence/bootstrap verification set**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts
```

and:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/app/providers.lifecycle.test.tsx \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts
```

Expected: `appearance.themeId` persists and the app bootstraps a normalized theme ID from new or legacy settings.

## Task 3: Refactor Settings UI to Family + Variant While Saving One `themeId`

**Files:**
- Modify: `packages/web/src/features/settings/components/settings-page.tsx`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx`
- Modify: `packages/web/src/locales/zh.json`
- Modify: `packages/web/src/locales/en.json`

- [ ] **Step 1: Write failing appearance-settings tests for theme families**

Replace current two-pill assumptions with tests like:

```tsx
expect(await screen.findByRole("button", { name: "Mint" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Graphite" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Nord" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "High Contrast" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Dark" })).toBeInTheDocument();
expect(screen.getByRole("button", { name: "Light" })).toBeInTheDocument();
```

Add interaction assertions that:

- starting from `mint-dark`, clicking `Graphite` triggers `settings.update({ appearance: { themeId: "graphite-dark" } })`
- clicking `Light` afterwards triggers `settings.update({ appearance: { themeId: "graphite-light" } })`
- `document.documentElement` updates to the resolved `data-theme`

- [ ] **Step 2: Add localization keys for theme families and variants**

Update `packages/web/src/locales/zh.json` and `packages/web/src/locales/en.json` with keys such as:

- `settings.theme.title`
- `settings.theme.hint`
- `settings.theme.family`
- `settings.theme.variant`
- `settings.theme.family_mint`
- `settings.theme.family_graphite`
- `settings.theme.family_nord`
- `settings.theme.family_hc`
- `settings.theme.variant_dark`
- `settings.theme.variant_light`

Keep the existing translation key namespace instead of inventing a parallel one.

- [ ] **Step 3: Rework the settings page appearance section**

In `packages/web/src/features/settings/components/settings-page.tsx`:

- treat the theme atom as `themeId`
- derive `family` and `variant` through the resolver
- replace the current two-pill dark/light group with:
  - one group for family
  - one group for variant
- keep the language controls unchanged

Implementation requirements:

- `handleThemeChange` should accept a final `themeId`, not `dark | light`
- setting family should preserve the current variant when possible
- setting variant should preserve the current family
- all saves still call `settings.update({ appearance: { themeId } })`
- update `document.documentElement` with the resolved `documentThemeAttr`

- [ ] **Step 4: Update settings load behavior**

In the same file’s `settings.get` hydration logic:

- read `appearance.themeId` first
- else read legacy `appearance.theme`
- normalize before calling `setTheme`

Do not entangle this with locale or terminal renderer version counters unless needed to avoid stale writes.

- [ ] **Step 5: Run focused settings tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/settings/components/settings-page.test.tsx
```

Expected: the appearance section uses family/variant controls, still persists one `themeId`, and no locale/terminal preference tests regress.

## Task 4: Upgrade CSS Tokens to Named Themes

**Files:**
- Modify: `packages/web/src/styles/tokens.css`
- Modify: `packages/web/src/styles/tokens-touch.test.ts`
- Modify: `packages/web/src/styles/components.theme.test.ts`

- [ ] **Step 1: Add failing token tests for multiple `data-theme` blocks**

Extend the node-based stylesheet tests to assert:

```ts
expect(stylesheet).toContain('[data-theme="mint-light"]');
expect(stylesheet).toContain('[data-theme="graphite-dark"]');
expect(stylesheet).toContain('[data-theme="graphite-light"]');
expect(stylesheet).toContain('[data-theme="nord-dark"]');
expect(stylesheet).toContain('[data-theme="nord-light"]');
expect(stylesheet).toContain('[data-theme="hc-dark"]');
expect(stylesheet).toContain('[data-theme="hc-light"]');
```

Also preserve current touch-token assertions unchanged.

- [ ] **Step 2: Restructure `tokens.css` around named themes**

In `packages/web/src/styles/tokens.css`:

- keep base non-color tokens on `:root`
- move current dark-theme colors into `:root, [data-theme="mint-dark"]`
- convert current light override into `[data-theme="mint-light"]`
- add first-pass color values for:
  - `graphite-dark`
  - `graphite-light`
  - `nord-dark`
  - `nord-light`
  - `hc-dark`
  - `hc-light`

Requirements:

- maintain existing semantic token names
- do not introduce component-specific hardcoded colors here
- preserve current scrollbar/touch/sizing tokens
- ensure no theme block depends on another theme block’s presence

- [ ] **Step 3: Verify token-aware component tests**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/styles/tokens-touch.test.ts \
  src/styles/components.theme.test.ts
```

Expected: current token-consuming component tests still pass and new theme block existence checks pass.

## Task 5: Route xterm and Monaco Through the Shared Theme Resolver

**Files:**
- Modify: `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`
- Modify: `packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.tsx`
- Modify: `packages/web/src/features/code-editor/components/monaco-host.test.tsx`

- [ ] **Step 1: Write failing terminal/editor tests against theme IDs**

Update Monaco tests to stop assuming `themeAtom = "light"` and instead set:

```ts
store.set(themeAtom, "mint-light");
```

Assert that:

- Monaco creates the editor with a named theme ID such as `coder-studio-mint-light`
- `monaco.editor.setTheme()` is called with the named theme, not raw `vs`

Update xterm tests to verify:

- `mint-light` produces the light terminal palette
- changing from `mint-dark` to `graphite-light` updates the live terminal options theme
- a non-default theme such as `hc-dark` uses the registry-provided palette

- [ ] **Step 2: Refactor `MonacoHost` to named Monaco themes**

In `packages/web/src/features/code-editor/components/monaco-host.tsx`:

- resolve the current theme via the shared theme module
- ensure the Monaco theme definition is registered once with `monaco.editor.defineTheme`
- create the editor with `theme: resolvedTheme.monaco.id`
- on changes, call `monaco.editor.setTheme(resolvedTheme.monaco.id)`

Keep language detection and save-command behavior unchanged.

- [ ] **Step 3: Refactor `XtermHost` to registry-provided palettes**

In `packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx`:

- remove the hardcoded `AURORA_MINT_THEMES.dark/light` branching as the active source of truth
- use `getThemeById(themeId).terminalTheme`
- initialize the terminal with the resolved palette
- update live instances on theme changes through the same resolver

Do not disturb unrelated hydration, replay, mobile input, or copy-on-select logic.

- [ ] **Step 4: Run focused terminal/editor verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/features/code-editor/components/monaco-host.test.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx
```

Expected: Monaco and xterm both consume theme IDs through the registry and still react to runtime theme changes.

## Task 6: Upgrade UI Preview and E2E-UI Theme Dimensions

**Files:**
- Modify: `packages/web/src/ui-preview/catalog.ts`
- Modify: `packages/web/src/ui-preview/preview-store.ts`
- Modify: `packages/web/src/ui-preview/scene-metadata.ts`
- Modify: `packages/web/src/ui-preview/scenes/page-scenes.tsx`
- Modify: `packages/web/src/ui-preview/app.tsx`
- Modify: `packages/web/src/ui-preview/app.test.tsx`
- Modify: `e2e-ui/scenes/index.ts`
- Modify: `e2e-ui/fixtures/prefs.ts`
- Modify: `e2e-ui/fixtures/scene-runner.ts`
- Modify: `e2e-ui/report/build-report.ts`
- Modify: `e2e-ui/report/build-report.test.ts`

- [ ] **Step 1: Write failing preview and report tests for named theme IDs**

Update `packages/web/src/ui-preview/app.test.tsx` to use:

```tsx
renderPreview("?scene=welcome&theme=mint-light&locale=en&device=desktop");
expect(document.documentElement).toHaveAttribute("data-theme", "mint-light");
```

Update e2e-ui report tests to expect screenshot paths like:

```ts
"screenshots/page/welcome/desktop__mint-light__zh.png"
```

- [ ] **Step 2: Upgrade preview-store theme typing**

In `packages/web/src/ui-preview/preview-store.ts`:

- replace `UiPreviewTheme = "dark" | "light"` with string-based theme IDs or a first-phase literal union
- seed `themeAtom` with the final theme ID

In `packages/web/src/ui-preview/catalog.ts` and `app.tsx`:

- update `UiPreviewSceneContext` and request parsing to accept named theme IDs
- normalize unknown or legacy values through the shared resolver
- set `document.documentElement.dataset.theme` from the resolved theme definition

- [ ] **Step 3: Update preview scene metadata and seeded settings**

In `packages/web/src/ui-preview/scene-metadata.ts`:

- change `themes` arrays from `["dark", "light"]`
- to representative named theme lists, defaulting to:
  - `mint-dark`
  - `mint-light`
  - `hc-dark`

In `packages/web/src/ui-preview/scenes/page-scenes.tsx`:

- make `settingsGet` seed `appearance.themeId = context.theme`
- stop seeding legacy `appearance.theme` for new preview scenarios unless a specific migration test needs it

- [ ] **Step 4: Update e2e-ui fixtures and report generation**

In `e2e-ui/fixtures/prefs.ts`:

- persist `ui.themeId`
- optionally seed legacy `ui.theme` only if backward-compat preview coverage is desired

In `e2e-ui/scenes/index.ts`, `scene-runner.ts`, `build-report.ts`, and `build-report.test.ts`:

- update theme typing and screenshot naming to use the final theme ID string
- keep device/locale grouping intact

- [ ] **Step 5: Run focused preview/e2e-ui verification**

Run:

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/ui-preview/app.test.tsx
```

and:

```bash
pnpm --filter e2e-ui exec vitest run report/build-report.test.ts
```

Expected: preview and e2e-ui now model themes as named IDs and preserve stable filtering/report behavior.

## Task 7: Update End-to-End Theme Assertions and Backward Compatibility Coverage

**Files:**
- Modify: `e2e/specs/settings/general.spec.ts`
- Modify: `e2e/specs/quality/general.spec.ts`
- Modify: `packages/web/src/features/settings/components/settings-page.test.tsx` if needed for migration assertions

- [ ] **Step 1: Update acceptance tests for the new appearance UI**

In `e2e/specs/settings/general.spec.ts`, replace the “dark/light buttons visible” assumption with:

- Theme section visible
- family controls visible
- variant controls visible

Keep the test bounded; it does not need to click every theme.

- [ ] **Step 2: Update localStorage persistence checks**

In `e2e/specs/quality/general.spec.ts`, migrate checks from `ui.theme` to `ui.themeId`:

```ts
const themeId = await page.evaluate(() => localStorage.getItem("ui.themeId"));
expect(themeId === null || themeId === '"mint-dark"' || themeId === "mint-dark").toBe(true);
```

Add a compatibility assertion that seeding legacy `ui.theme = "light"` still yields the expected document theme or normalized `themeId` after app startup.

- [ ] **Step 3: Run the bounded Playwright coverage**

Run:

```bash
pnpm --filter e2e exec playwright test \
  specs/settings/general.spec.ts \
  specs/quality/general.spec.ts
```

Expected: settings and quality acceptance specs pass with the new `themeId` model.

## Task 8: Full Verification and Cleanup

**Files:** no new product code; touch only if verification reveals issues

- [ ] **Step 1: Run the full focused unit/integration verification set**

Run:

```bash
pnpm --filter @coder-studio/server exec vitest run src/commands/settings.test.ts
```

```bash
pnpm --filter @coder-studio/web exec vitest run \
  src/theme/registry.test.ts \
  src/theme/resolve.test.ts \
  src/app/providers.lifecycle.test.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/code-editor/components/monaco-host.test.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/ui-preview/app.test.tsx \
  src/styles/tokens-touch.test.ts \
  src/styles/components.theme.test.ts
```

```bash
pnpm --filter e2e-ui exec vitest run report/build-report.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 2: Run formatting and static checks on touched files**

Run:

```bash
pnpm --filter @coder-studio/web exec biome check \
  src/theme \
  src/atoms/app-ui.ts \
  src/app/providers.tsx \
  src/app/providers.lifecycle.test.tsx \
  src/features/settings/components/settings-page.tsx \
  src/features/settings/components/settings-page.test.tsx \
  src/features/code-editor/components/monaco-host.tsx \
  src/features/code-editor/components/monaco-host.test.tsx \
  src/features/terminal-panel/views/shared/xterm-host.tsx \
  src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  src/styles/tokens.css \
  src/styles/tokens-touch.test.ts \
  src/styles/components.theme.test.ts \
  src/locales/zh.json \
  src/locales/en.json \
  src/ui-preview/app.tsx \
  src/ui-preview/app.test.tsx \
  src/ui-preview/catalog.ts \
  src/ui-preview/preview-store.ts \
  src/ui-preview/scene-metadata.ts \
  src/ui-preview/scenes/page-scenes.tsx
```

and:

```bash
pnpm --filter @coder-studio/server exec biome check \
  src/commands/settings.ts \
  src/commands/settings.test.ts
```

Expected: no Biome issues.

- [ ] **Step 3: Re-scan for direct `dark | light` theme branching in theme consumers**

Run:

```bash
rg -n 'ui\\.theme|appearance\\.theme|theme === "light"|theme === "dark"|data-theme="light"|data-theme="dark"' \
  packages/web \
  packages/server \
  e2e \
  e2e-ui
```

Expected:

- remaining matches are either explicit migration-compatibility code paths or documented test fixtures
- no core UI/xterm/Monaco runtime path should still branch directly on `dark | light`

- [ ] **Step 4: Commit the implementation**

Run:

```bash
git add \
  packages/core/src/domain/types.ts \
  packages/server/src/commands/settings.ts \
  packages/server/src/commands/settings.test.ts \
  packages/web/src/theme \
  packages/web/src/atoms/app-ui.ts \
  packages/web/src/app/providers.tsx \
  packages/web/src/app/providers.lifecycle.test.tsx \
  packages/web/src/features/settings/components/settings-page.tsx \
  packages/web/src/features/settings/components/settings-page.test.tsx \
  packages/web/src/features/code-editor/components/monaco-host.tsx \
  packages/web/src/features/code-editor/components/monaco-host.test.tsx \
  packages/web/src/features/terminal-panel/views/shared/xterm-host.tsx \
  packages/web/src/features/terminal-panel/__tests__/xterm-host.test.tsx \
  packages/web/src/styles/tokens.css \
  packages/web/src/styles/tokens-touch.test.ts \
  packages/web/src/styles/components.theme.test.ts \
  packages/web/src/locales/zh.json \
  packages/web/src/locales/en.json \
  packages/web/src/ui-preview/app.tsx \
  packages/web/src/ui-preview/app.test.tsx \
  packages/web/src/ui-preview/catalog.ts \
  packages/web/src/ui-preview/preview-store.ts \
  packages/web/src/ui-preview/scene-metadata.ts \
  packages/web/src/ui-preview/scenes/page-scenes.tsx \
  e2e-ui/scenes/index.ts \
  e2e-ui/fixtures/prefs.ts \
  e2e-ui/fixtures/scene-runner.ts \
  e2e-ui/report/build-report.ts \
  e2e-ui/report/build-report.test.ts \
  e2e/specs/settings/general.spec.ts \
  e2e/specs/quality/general.spec.ts \
  docs/superpowers/plans/2026-05-11-theme-skins-system.md
git commit -m "feat: add multi-skin theme system"
```

Expected: one clean feature commit containing the theme system implementation and its plan doc.

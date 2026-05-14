# Theme-Integrated Icon Theme Design

> Status: Draft
> Date: 2026-05-14
> Scope: `packages/web/src/theme/*`, `packages/web/src/components/ui/themed-icon/*`, icon-heavy workspace and shared UI surfaces

## Goal

Extend the existing theme system so a single `themeId` can drive not only colors, terminal, and Monaco, but also the main icon presentation used across the app.

The first phase should let each built-in theme define:

- which icon glyph is used for a semantic meaning
- which icon tone it defaults to
- whether that icon uses a light surface treatment
- small presentational differences such as stroke width when useful

The product should still expose one appearance choice to users. This phase does not introduce a separate user-facing icon theme switch.

## Problem

The current project already has two meaningful layers:

- a central theme registry under [`packages/web/src/theme/registry.ts`](../../../packages/web/src/theme/registry.ts)
- an icon token layer in [`packages/web/src/styles/tokens.css`](../../../packages/web/src/styles/tokens.css)

That is enough for icon color theming, but not enough for icon identity theming.

Today, the decision chain is split:

- feature components directly import and choose Lucide icons
- CSS classes in [`packages/web/src/styles/components.css`](../../../packages/web/src/styles/components.css) decide icon colors and some icon container styling
- themes can influence tokens, but cannot change which glyph a semantic icon uses

This creates several limits:

- file tree icons can change color per theme, but themes cannot define a different folder or file glyph style
- top-level navigation icons can inherit color correctly, but their visual language is still globally fixed
- empty states, toast icons, warning callouts, and welcome feature icons cannot be managed as a unified theme-controlled presentation layer
- future support for a VS Code-like icon theme model would require touching many business components because there is no stable semantic icon entry point yet

The core gap is not just color token coverage. The core gap is the absence of a shared icon semantic layer between features and themes.

## Decision

Adopt a `C-lite` architecture:

- keep a single user-facing `themeId`
- add an `iconTheme` definition inside each application theme
- introduce a stable semantic icon registry and resolver
- render theme-controlled icons through a thin `ThemedIcon` component

This gives the theme system control over icon glyph, tone, and light surface styling without immediately expanding product settings into a separate `iconThemeId` model.

## Scope

### In Scope For Phase 1

The first phase covers the main icon-heavy surfaces where theme-specific glyph and style differences are visually meaningful.

#### 1. File and workspace surfaces

- file tree folder closed and folder open icons
- file type icons for code, data, doc, media, and default files
- file tree action icons such as new file and new folder
- file tree search icon

Primary entry point:

- [`packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx)

#### 2. Git and worktree surfaces

- git status icons for staged, modified, deleted, and untracked
- git action icons such as diff, pull, push, refresh
- warning states inside git status surfaces
- worktree-related entry icons where the icon carries product meaning

Primary entry points:

- [`packages/web/src/features/workspace/views/shared/git-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/git-panel.tsx)
- [`packages/web/src/features/workspace/views/shared/git-status-bar.tsx`](../../../packages/web/src/features/workspace/views/shared/git-status-bar.tsx)

#### 3. Navigation and primary-entry surfaces

- settings navigation icons
- topbar primary action icons such as search, settings, new workspace, show files, show terminal
- mobile dock icons for agent, files, and terminal
- mobile topbar entry icons where they represent a stable route or product area

Primary entry points:

- [`packages/web/src/features/topbar/index.tsx`](../../../packages/web/src/features/topbar/index.tsx)
- [`packages/web/src/features/settings/components/settings-page.tsx`](../../../packages/web/src/features/settings/components/settings-page.tsx)
- [`packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`](../../../packages/web/src/features/workspace/views/mobile/mobile-dock.tsx)
- [`packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx`](../../../packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx)

#### 4. Feedback and empty-state surfaces

- welcome feature icons
- empty-state icons in terminal and config editor surfaces
- toast icons for success, warning, error, and info
- supervisor warning and danger callout icons

Primary entry points:

- [`packages/web/src/features/welcome/index.tsx`](../../../packages/web/src/features/welcome/index.tsx)
- [`packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx)
- [`packages/web/src/features/settings/components/config-editor.tsx`](../../../packages/web/src/features/settings/components/config-editor.tsx)
- [`packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`](../../../packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx)
- [`packages/web/src/components/ui/toast/index.tsx`](../../../packages/web/src/components/ui/toast/index.tsx)

### Explicitly Out Of Scope For Phase 1

This phase intentionally does not cover:

- a separate user-facing `iconThemeId`
- uploading or editing icon themes from the UI
- plugin or external JSON registration for icon themes
- full third-party icon pack switching
- automatic migration of every icon in the codebase
- foundation-control icons such as generic chevrons in `Select`, `Tabs`, and disclosure primitives
- all close buttons, generic plus/minus icons, or icons whose meaning is too weak to justify semantic registration
- Monaco, xterm, browser-native, or third-party internal icons

## Architecture

The design introduces a dedicated icon semantic layer between business components and theme definitions.

### Layer 1: Feature semantics

Feature code should describe icon meaning, not icon implementation.

Examples:

- `file.folder.closed`
- `file.folder.open`
- `file.type.code`
- `git.status.modified`
- `nav.settings`
- `state.warning`

Feature components are still responsible for deciding business meaning. They are no longer responsible for choosing the final icon glyph.

### Layer 2: Theme-owned icon presentation

Each theme definition gains an `iconTheme` section that maps semantic keys to concrete presentation.

That presentation may include:

- icon glyph component
- tone
- optional surface
- optional stroke width override

This is the main architectural shift. Themes become the owner of icon presentation. Features remain the owner of icon meaning.

### Layer 3: Shared rendering

A shared resolver and thin rendering component turn semantic keys into rendered icons.

This layer keeps feature code simple and gives future icon-theme evolution one centralized extension point.

## Data Model

### Theme Registry Extension

[`packages/web/src/theme/registry.ts`](../../../packages/web/src/theme/registry.ts) should be extended so `AppThemeDefinition` includes an `iconTheme`.

Recommended shape:

```ts
import type { LucideIcon } from "lucide-react";

export type IconSemantic =
  | "file.folder.closed"
  | "file.folder.open"
  | "file.type.code"
  | "file.type.data"
  | "file.type.doc"
  | "file.type.media"
  | "file.type.default"
  | "file.action.new"
  | "file.action.newFolder"
  | "file.action.search"
  | "git.status.staged"
  | "git.status.modified"
  | "git.status.deleted"
  | "git.status.untracked"
  | "git.action.diff"
  | "git.action.pull"
  | "git.action.push"
  | "git.action.refresh"
  | "nav.settings"
  | "nav.search"
  | "nav.newWorkspace"
  | "nav.panelFiles"
  | "nav.panelTerminal"
  | "nav.agent"
  | "state.success"
  | "state.warning"
  | "state.error"
  | "state.info"
  | "state.emptyTerminal"
  | "state.emptyConfig"
  | "state.welcome.terminal"
  | "state.welcome.workspace"
  | "state.welcome.git"
  | "state.welcome.lightning";

export type IconTone =
  | "current"
  | "primary"
  | "secondary"
  | "muted"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info"
  | "file-folder"
  | "file-code"
  | "file-data"
  | "file-doc"
  | "file-media"
  | "file-default"
  | "git-staged"
  | "git-modified"
  | "git-deleted"
  | "git-untracked";

export type IconSurface =
  | "none"
  | "subtle"
  | "accent"
  | "success"
  | "warning"
  | "error"
  | "info";

export interface IconGlyphDefinition {
  component: LucideIcon;
  strokeWidth?: number;
}

export interface IconPresentationDefinition {
  glyph: IconGlyphDefinition;
  tone: IconTone;
  surface?: IconSurface;
}

export interface IconThemeDefinition {
  icons: Record<IconSemantic, IconPresentationDefinition>;
}

export interface AppThemeDefinition {
  ...
  iconTheme: IconThemeDefinition;
}
```

### Semantic Rules

Semantic keys must follow these rules:

- they describe meaning, not implementation
- they do not include component names
- they do not include theme names
- they are stable across themes

Good:

- `file.type.code`
- `nav.settings`
- `state.warning`

Bad:

- `lucide.folder.green`
- `settings-page-icon`
- `mintDarkFolder`

The purpose is to create a stable contract that survives icon pack changes later.

## Code Structure

### 1. Theme icon module

Create a dedicated icon-theme module:

- `packages/web/src/theme/icon-theme.ts`

This module should own:

- semantic types
- tone and surface types
- the base icon theme
- validation helpers if needed
- `resolveIconPresentation()`

The main goal is to keep icon-theme logic out of business components and out of generic UI primitives.

### 2. Shared UI renderer

Create a new UI primitive:

- `packages/web/src/components/ui/themed-icon/`

Recommended API:

```tsx
interface ThemedIconProps {
  semantic: IconSemantic;
  size?: number;
  className?: string;
  decorative?: boolean;
}
```

Responsibilities:

- read the active theme through existing theme state
- resolve the icon presentation for the requested semantic
- render the correct icon component
- emit stable tone and surface classes or data attributes
- default decorative icons to `aria-hidden`

This component should stay thin. It should not contain feature-specific semantic logic.

### 3. Feature semantic helpers

Only features that need semantic mapping logic should get local helper functions.

Examples:

- `getFileNodeSemantic(node, isExpanded)`
- `getGitStatusSemantic(type)`

These helpers should live alongside the feature that owns the business rules, not inside the shared icon component.

## Rendering Model

Themed icon rendering should separate identity from color.

`ThemedIcon` should determine:

- which glyph to render
- which tone class to apply
- which optional surface class to apply

CSS tokens remain responsible for final color values.

Example rendered structure:

```tsx
<span
  className="
    themed-icon
    themed-icon--tone-file-code
    themed-icon--surface-none
  "
  data-icon-semantic="file.type.code"
>
  <FileCode2 />
</span>
```

This keeps two independent extension paths:

- change registry data to change glyph or presentation rules
- change CSS tokens to change theme color output

## CSS And Token Strategy

This design reuses the existing icon token investment instead of replacing it.

### Responsibilities

`iconTheme` owns:

- glyph choice
- tone choice
- surface choice
- optional stroke width choice

CSS token layers own:

- final foreground color values for each tone
- final background values for each surface

Recommended class mapping:

```css
.themed-icon--tone-primary { color: var(--icon-primary); }
.themed-icon--tone-secondary { color: var(--icon-secondary); }
.themed-icon--tone-muted { color: var(--icon-muted); }
.themed-icon--tone-accent { color: var(--icon-accent); }
.themed-icon--tone-success { color: var(--icon-success); }
.themed-icon--tone-warning { color: var(--icon-warning); }
.themed-icon--tone-error { color: var(--icon-error); }
.themed-icon--tone-info { color: var(--icon-info); }
.themed-icon--tone-file-folder { color: var(--icon-file-folder); }
.themed-icon--tone-file-code { color: var(--icon-file-code); }
.themed-icon--tone-file-data { color: var(--icon-file-data); }
.themed-icon--tone-file-doc { color: var(--icon-file-doc); }
.themed-icon--tone-file-media { color: var(--icon-file-media); }
.themed-icon--tone-file-default { color: var(--icon-file-default); }
.themed-icon--tone-git-staged { color: var(--icon-git-staged); }
.themed-icon--tone-git-modified { color: var(--icon-git-modified); }
.themed-icon--tone-git-deleted { color: var(--icon-git-deleted); }
.themed-icon--tone-git-untracked { color: var(--icon-git-untracked); }

.themed-icon--surface-subtle { background: var(--icon-surface-subtle); }
.themed-icon--surface-accent { background: var(--icon-surface-accent); }
.themed-icon--surface-success { background: var(--icon-surface-success); }
.themed-icon--surface-warning { background: var(--icon-surface-warning); }
.themed-icon--surface-error { background: var(--icon-surface-error); }
.themed-icon--surface-info { background: var(--icon-surface-info); }
```

### Surface Usage Rules

Only icons with a deliberate chip or badge presentation should render a surface wrapper.

Good surface candidates:

- welcome feature icons
- toast icons
- empty-state icons
- warning and danger callouts

Bad surface candidates:

- file tree glyphs
- git row status markers
- ordinary topbar and dock icons

This keeps the DOM small and prevents decorative surface treatments from leaking into structural UI icons.

## Migration Plan

Migration should happen in bounded batches rather than across the whole repository at once.

### Batch 1: File and Git

Start with:

- [`packages/web/src/features/workspace/views/shared/file-tree-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/file-tree-panel.tsx)
- [`packages/web/src/features/workspace/views/shared/git-panel.tsx`](../../../packages/web/src/features/workspace/views/shared/git-panel.tsx)
- [`packages/web/src/features/workspace/views/shared/git-status-bar.tsx`](../../../packages/web/src/features/workspace/views/shared/git-status-bar.tsx)

These surfaces have the strongest icon semantics and the clearest theme payoff.

### Batch 2: Navigation surfaces

Then migrate:

- [`packages/web/src/features/topbar/index.tsx`](../../../packages/web/src/features/topbar/index.tsx)
- [`packages/web/src/features/workspace/views/mobile/mobile-dock.tsx`](../../../packages/web/src/features/workspace/views/mobile/mobile-dock.tsx)
- [`packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx`](../../../packages/web/src/features/workspace/views/mobile/mobile-topbar.tsx)
- [`packages/web/src/features/settings/components/settings-page.tsx`](../../../packages/web/src/features/settings/components/settings-page.tsx)

The goal here is theme-controlled product entry icon language.

### Batch 3: Feedback and empty-state surfaces

Finally migrate:

- [`packages/web/src/components/ui/toast/index.tsx`](../../../packages/web/src/components/ui/toast/index.tsx)
- [`packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx`](../../../packages/web/src/features/terminal-panel/views/shared/terminal-panel.tsx)
- [`packages/web/src/features/settings/components/config-editor.tsx`](../../../packages/web/src/features/settings/components/config-editor.tsx)
- [`packages/web/src/features/welcome/index.tsx`](../../../packages/web/src/features/welcome/index.tsx)
- [`packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx`](../../../packages/web/src/features/supervisor/views/shared/objective-dialog-content.tsx)

This batch finishes the main feedback and branded icon surfaces.

## CurrentColor Boundary

Not every icon should enter the semantic registry in this phase.

Keep direct `currentColor` behavior for:

- ordinary icons inside `IconButton`
- foundational disclosure chevrons
- spinner and low-semantic utility icons
- icons whose visual role is fully controlled by the surrounding text or button color
- weak-meaning controls such as generic close, plus, and minus in low-value contexts

Decision rule:

- if the icon should vary with the surrounding text layer, keep `currentColor`
- if the icon should express its own visual identity or semantic tone, register it

## Why ThemedIcon Should Stay Separate From IconButton

[`packages/web/src/components/ui/icon-button/index.tsx`](../../../packages/web/src/components/ui/icon-button/index.tsx) should remain a button-shell primitive.

It should not become the icon-theme decision center.

Reasons:

- the same `IconButton` shell can host many unrelated semantics
- the semantic meaning belongs to the caller, not to the button primitive
- non-button surfaces such as toast, welcome, settings navigation, and empty states need the same icon system
- pushing icon semantics into `IconButton` would tightly couple business meaning to a presentational button primitive

The correct composition is:

```tsx
<IconButton
  aria-label={t("settings.title")}
  icon={<ThemedIcon semantic="nav.settings" size={14} />}
/>
```

Not:

```tsx
<IconButton semantic="nav.settings" />
```

## Resolver Fallback Strategy

The shared resolver should protect the UI against partial or missing registrations.

Recommended fallback order:

1. active theme `iconTheme`
2. shared `baseIconTheme`
3. last-resort generic icon for the semantic family

In development, missing registrations should emit warnings so gaps are discovered quickly.

This ensures that theme growth does not introduce runtime crashes or blank icon surfaces.

## Testing

Phase 1 should add four categories of verification.

### 1. Resolver tests

Add unit tests that verify:

- every declared `IconSemantic` resolves
- themes can return different glyphs or tones for the same semantic
- fallback behavior works when a theme omits an override

### 2. ThemedIcon rendering tests

Add component tests that verify:

- the resolved glyph renders
- tone and surface classes or data attributes are stable
- `surface="none"` and surfaced icons produce the expected DOM structure
- decorative icons default to non-announced output

### 3. CSS and token tests

Existing theme-sensitive CSS coverage in [`packages/web/src/styles/components.theme.test.ts`](../../../packages/web/src/styles/components.theme.test.ts) should be extended or partially redirected so the main assertion becomes:

- themed icon classes map to `--icon-*` and `--icon-surface-*` tokens
- main migrated surfaces no longer depend on scattered hardcoded icon color rules

### 4. Visual regression coverage

Multi-theme preview or e2e captures should include at least:

- file tree
- git panel and git status bar
- topbar and mobile dock
- toast, welcome, and empty-state surfaces

This is important because icon-theme regressions are often visual rather than behavioral.

## Future Expansion Path

This design intentionally keeps the semantic icon entry point stable so the product can later evolve toward a full VS Code-like icon theme model.

Today:

```ts
theme.iconTheme
```

Potential later model:

```ts
resolveActiveIconTheme({ themeId, iconThemeId })
```

Business code should not care which source model is active. It should continue to call:

```tsx
<ThemedIcon semantic="file.folder.open" />
```

That is the main reason to establish semantic indirection now. Once callers depend on semantics rather than glyph imports, a future split into standalone `iconThemeId` becomes a data-source change instead of a repository-wide rendering rewrite.

## Risks

### Risk: semantic key sprawl

If semantic registration becomes too fine-grained, the icon system becomes difficult to maintain.

Mitigation:

- only register stable, product-level icon meanings
- do not register one-off component-local icon names unless the icon truly carries reusable meaning

### Risk: over-migrating low-value icons

If the first phase tries to absorb every icon, implementation cost will balloon without meaningful user value.

Mitigation:

- keep a strict boundary around the four main surface groups
- leave foundation-control and weak-semantic icons on `currentColor`

### Risk: registry and CSS responsibilities blur

If glyph choice and color choice are both managed in too many places, the system becomes hard to reason about.

Mitigation:

- registry decides glyph, tone, and surface intent
- CSS tokens decide final colors
- feature code decides only business meaning

## Verification

Before implementation planning begins, confirm:

1. the scope covers the intended main icon surfaces and excludes low-value control icons
2. the semantic-key model is stable enough for future theme expansion
3. the `ThemedIcon` boundary stays separate from `IconButton`
4. the future path to standalone `iconThemeId` remains open without changing feature call sites

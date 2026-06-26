# Terminal Settings Route Design

> Status: Draft for review

## Goal

Move all terminal-related settings into a dedicated `Terminal` section under `More > Settings`, remove the legacy `/settings` route, and update terminal entry points to use the canonical `/more/settings/...` paths.

## Scope

This design covers:

- a new `Terminal` settings section placed below `Agents`
- moving terminal renderer, copy-on-select, terminal profiles, and desktop/mobile terminal font sizes into that section
- removing the old `/settings` route and any `/settings?...` navigation
- updating terminal profile entry links and update-details links to canonical `/more/...` routes
- clarifying terminal profile copy so it reads like a reusable launch preset
- keeping the settings and more-route tests aligned with the new route map

This design does not cover:

- unrelated settings refactors
- changes to terminal runtime behavior outside the settings UI
- new terminal profile features beyond wording and layout cleanup

## Current Architecture

Settings are split across `packages/web/src/features/settings/components/settings-page.tsx`, `settings-sections.tsx`, and `packages/web/src/features/more/*`.

Today, terminal controls are spread across two sections:

- `General` owns terminal renderer, copy-on-select, and terminal profiles
- `Appearance` owns desktop and mobile terminal font sizes

Route handling is also split:

- `/more/settings/...` is the newer canonical settings surface
- `/settings` still exists in the shells and a few in-app links

## Requirements

### Functional

1. `Terminal` appears in the settings sidebar after `Agents` and before `Appearance`.
2. `Terminal` contains terminal renderer, copy-on-select, terminal profiles, and desktop/mobile terminal font sizes.
3. `General` no longer shows terminal-specific controls.
4. `/more/settings/terminal` is a valid canonical route.
5. `/settings` is removed from the shells and no longer used for navigation.
6. The terminal profile configuration link opens the terminal settings section and anchors to the profile editor.
7. The update-details footer link opens the canonical about route under `/more`.
8. The terminal profile default selector stays single-line by using a fixed-width control.
9. The terminal profile help text explains that custom configs are reusable terminal launch presets.

### Non-functional

1. Route behavior must stay consistent on desktop and mobile.
2. Existing tests should fail loudly if `/settings` is reintroduced.
3. The section order must remain stable across the desktop sidebar and mobile section list.

## Proposed Design

### 1. Route model

Make `/more/settings/general`, `/more/settings/terminal`, `/more/settings/appearance`, and `/more/settings/shortcuts` the only public settings routes.

Remove `/settings` from:

- `packages/web/src/shells/desktop-shell.tsx`
- `packages/web/src/shells/mobile-shell/index.tsx`
- any in-app links that still point at `/settings`

No redirect alias is retained. A direct `/settings` visit should no longer be treated as a valid settings entrypoint.

### 2. Settings section map

Add `terminal` to the `SettingsSection` union and visible settings registry.

Final visible order:

1. `general`
2. `providers`
3. `terminal`
4. `appearance`
5. `shortcuts`

`SettingsPage` should render a dedicated `TerminalSettings` section component that owns:

- terminal renderer pills
- copy-on-select switch
- terminal profile editor
- desktop terminal font size input
- mobile terminal font size input

`GeneralSettings` should keep only general runtime items such as notifications, supervisor controls, language, and LSP mode.

`AppearanceSettings` should keep theme and personalization controls, but no terminal sizing fields.

### 3. More route integration

Add `terminal` to `packages/web/src/features/more/routes.ts` and `page.tsx` so the settings category can resolve `/more/settings/terminal`.

The settings category should keep the same default section behavior:

- `/more/settings` canonicalizes to `/more/settings/general`
- invalid settings sections canonicalize back to `/more/settings/general`

Update the embedded settings section allow-list so `terminal` can render inside the `More` shell.

### 4. Terminal profile UX

Keep the profile editor anchored at `#terminal-profiles`, but make the entrypoint link point to `/more/settings/terminal#terminal-profiles`.

Update the terminal profile help text so it explicitly explains that custom profiles are reusable terminal launch presets.

Keep the default-profile selector constrained to a fixed width so long labels do not wrap and compress the row layout.

### 5. Related navigation

Update the update rail action that currently opens about details to the canonical `/more/about/update-status` route.

Any other stale `/settings?section=...` links should be converted to `/more/settings/...`.

## Data Flow

1. User opens `More > Settings > Terminal`.
2. `MoreFeaturesPage` resolves the canonical `/more/settings/terminal` route.
3. `SettingsPage` renders the terminal section instead of general or appearance terminal controls.
4. Terminal profile edits persist through the existing settings update flow.
5. The terminal profile entry link jumps directly to the terminal profile anchor.
6. Footer update details open the canonical about route under `/more`.

## Error Handling

- If an invalid settings section is requested, route canonicalization should fall back to `/more/settings/general`.
- If the terminal settings section is missing from the visible registry, the mobile and desktop section-order checks should fail in tests.
- If the legacy `/settings` route is accidentally reintroduced, shell tests should catch it.

## Testing Strategy

- update `settings-sections` tests to cover the new terminal section order
- update `settings-page` tests to verify terminal controls live under `Terminal`, not `General` or `Appearance`
- update `more/page` tests to cover `/more/settings/terminal`
- update shell tests to assert `/settings` is gone
- update terminal profile link tests to assert `/more/settings/terminal#terminal-profiles`
- update footer update rail tests to assert `/more/about/update-status`

## Risks

1. The settings page is large, so moving controls between section components can introduce prop churn if the split is done mechanically.
2. Removing `/settings` outright may surface stale links in less frequently used flows.
3. The terminal profile selector width fix can regress if the control is later reused in a narrower container without the fixed-width wrapper.

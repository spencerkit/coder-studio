# Mobile-Friendly Phase 4A Design

> Date: 2026-05-01
> Status: Approved for planning
> Scope: Mobile page-level secondary surfaces only

## 1. Goal

Phase 4A adapts the page-level secondary surfaces for mobile without changing workspace shell behavior. The target is to make `Welcome`, `Auth`, and `Settings` behave as true full-screen mobile routes, while keeping desktop behavior stable and deferring modal-to-sheet work to Phase 4B.

This phase exists because Phase 3 already established the mobile workspace shell, but the remaining page-level routes still behave like desktop-first screens. On phones, that creates two problems:

- route pages do not feel visually separated from the workspace shell
- `Settings` still uses a desktop sidebar/content split instead of a mobile `category -> detail` navigation model

## 2. In Scope

- Mobile full-screen treatment for `/` via `WelcomePage`
- Mobile full-screen treatment for `/login` via `LoginPage`
- Mobile full-screen treatment for `/settings` via `SettingsPage`
- Mobile-only `Settings` navigation stack inside the existing `/settings` route
- Mobile-safe return behavior from `Settings`
- Mobile layout adjustments for embedded settings content such as `ConfigDriftBanner`
- Tests covering mobile `Settings` flow and desktop regression boundaries

## 3. Out of Scope

Phase 4A explicitly does not include the floating-surface conversions reserved for Phase 4B:

- `CommandPalette`
- `WorkspaceLaunchModal`
- `WorktreeModal`
- `ObjectiveDialog`
- toast repositioning
- config-drift banner compaction outside the `Settings` page context

This phase also does not change:

- desktop shell routing structure
- mobile workspace shell behavior from Phases 0-3
- settings data loading or websocket command contracts
- provider configuration semantics

## 4. Design Constraints

- Route paths remain unchanged: `/`, `/login`, `/workspace`, `/settings`
- `MobileShell` remains responsible for shell selection, not for introducing mobile-only routes
- Desktop `SettingsPage` keeps the current sidebar + content layout
- Mobile `SettingsPage` must meet the spec requirement of `category -> detail`
- `WelcomePage` and `LoginPage` should reuse existing business logic and only adapt their page container/layout
- `Settings` navigation changes must stay component-local unless a small shared helper materially improves clarity

## 5. Route and Container Model

### 5.1 Route Ownership

The existing route model stays intact:

- `/` -> `WelcomePage`
- `/login` -> `LoginPage`
- `/workspace` -> `WorkspacePage` on desktop, `MobileWorkspaceScaffold` on mobile
- `/settings` -> `SettingsPage`

The difference in Phase 4A is presentation, not route topology. On mobile, `WelcomePage`, `LoginPage`, and `SettingsPage` are treated as standalone full-screen screens that do not show workspace chrome such as the mobile dock, workspace drawer, or workspace sheets.

### 5.2 Full-Screen Page Treatment

On mobile:

- `WelcomePage` fills the viewport and respects safe-area insets
- `LoginPage` fills the viewport and respects safe-area insets
- `SettingsPage` fills the viewport and respects safe-area insets
- page spacing is tuned for phone reading and thumb reach rather than desktop centered-card composition

On desktop, current page layouts remain the source of truth.

## 6. Welcome and Auth Adaptation

### 6.1 Welcome

`WelcomePage` keeps its current CTA flow:

- primary action opens workspace launch
- secondary action opens settings

For mobile, the work is presentational:

- reduce oversized desktop card framing
- allow the content block to occupy the screen naturally
- stack feature cards into a single-column rhythm if needed
- ensure the primary CTA remains visible without requiring horizontal compression

No route or state changes are required.

### 6.2 Auth

`LoginPage` keeps its current auth status check and submit behavior. For mobile, the page becomes a dedicated full-screen auth surface rather than a desktop-style centered panel with large surrounding empty space.

The page must preserve:

- auth status loading states
- auth disabled bypass behavior
- failed login and network error behavior

No protocol or form-flow changes are required.

## 7. Settings Mobile Navigation Stack

### 7.1 Core Model

`SettingsPage` remains mounted at `/settings`, but on mobile it gains an internal two-state navigation model:

- `root`: section list
- `detail(section)`: content view for one selected section

This is a component-level navigation stack, not a router-level stack.

### 7.2 Sections

The section set stays aligned with the current desktop implementation:

- `general`
- `providers`
- `appearance`
- `shortcuts`

The desktop sidebar and the mobile root list should both be driven from a shared section definition so labels, icons, and ordering remain consistent.

### 7.3 Root View

Mobile root view shows a list of settings categories. Each row includes:

- section icon
- section label
- optional short description
- trailing chevron

Tapping a row transitions into `detail(section)`.

The root view is intentionally lightweight. It should not contain the embedded config drift banner or full settings content blocks, because that would dilute the navigation purpose of the root screen.

### 7.4 Detail View

Mobile detail view renders the existing settings content for the selected section. The content itself should be reused from the existing section renderers rather than rewritten for mobile.

Behavior by section:

- `general`: reuse notification toggles and permission controls
- `appearance`: reuse theme, renderer, and language controls
- `providers`: reuse provider tabs and provider-specific content
- `shortcuts`: reuse the shortcuts settings content

`providers` keeps its internal provider tab switcher. Phase 4A does not introduce a second mobile navigation stack for `Claude` / `Codex`.

### 7.5 Header and Back Behavior

The `SettingsPage` header has two distinct behaviors on mobile:

- when on `root`, the leading back action exits the settings page
- when on `detail(section)`, the leading back action returns to the settings root list

This preserves a clear mental model:

- page back goes out of settings
- section back stays inside settings

### 7.6 Exit Fallback Logic

Current behavior always returns from settings to `/workspace`. That is incorrect for entry paths such as `Welcome -> Settings`.

Phase 4A changes the page-level exit behavior to:

1. Prefer `navigate(-1)` when browser history can reasonably take the user back
2. If there is no safe history target:
   - go to `/workspace` when an active workspace exists
   - otherwise go to `/`

This rule applies only when leaving the settings page root, not when leaving a section detail.

## 8. Embedded Banner Placement

`ConfigDriftBanner` remains inside `SettingsPage`, but on mobile it should only appear inside the detail content flow, above the section body content where relevant.

It should not appear on the mobile root category list, because:

- the root view is a navigation index, not a content page
- the banner would visually dominate the list and reduce scanability
- the banner already fits naturally within settings content context

Desktop embedded-banner behavior remains unchanged.

## 9. Desktop Preservation

Desktop behavior is explicitly preserved:

- desktop route structure stays the same
- desktop `SettingsPage` keeps sidebar + content
- desktop `WelcomePage` and `LoginPage` remain visually unchanged unless a shared style adjustment is provably neutral

If code needs to branch, prefer mobile-specific rendering branches over broad shared style changes that risk desktop regressions.

## 10. Implementation Shape

Expected code changes are concentrated in:

- `packages/web/src/features/settings/components/settings-page.tsx`
- `packages/web/src/features/settings/components/settings-page.test.tsx`
- `packages/web/src/features/auth/index.tsx`
- `packages/web/src/features/welcome/index.tsx`
- `packages/web/src/styles/components.css`
- small shell-level regression coverage only if needed

Expected implementation approach:

- keep route mounting unchanged
- add a mobile-mode branch to `SettingsPage`
- extract shared section metadata for desktop sidebar and mobile root list
- add a small helper for settings exit navigation if it simplifies tests and reasoning
- solve layout changes primarily in CSS, not by duplicating feature logic

## 11. Testing Strategy

### 11.1 Primary Coverage

Primary tests should live in `settings-page.test.tsx` because Phase 4A changes `SettingsPage` behavior directly.

Required coverage:

- mobile renders root category list instead of desktop split layout
- selecting a category opens the correct detail content
- detail back returns to root category list
- root back uses the new exit navigation behavior
- desktop rendering still shows the existing sidebar/content structure

### 11.2 Secondary Coverage

Add or adjust lightweight tests for `WelcomePage` and `LoginPage` only where needed to prove mobile full-screen treatment does not break their current business flows.

### 11.3 Verification

At minimum, Phase 4A implementation should be verified with:

- focused `SettingsPage` tests
- any touched `Welcome` / `Auth` tests
- full web test suite if the change surface remains manageable

## 12. Risks and Mitigations

### Risk 1: Desktop regressions from shared markup changes

Mitigation:

- preserve desktop render path whenever possible
- isolate mobile branch inside `SettingsPage`
- keep CSS overrides under the mobile breakpoint

### Risk 2: Over-expanding `Settings` into a routing project

Mitigation:

- keep `/settings` as a single route
- use component state for the mobile navigation stack
- defer route decomposition unless a later requirement truly needs deep links

### Risk 3: Scope creep into Phase 4B

Mitigation:

- do not convert existing modals or overlays in this phase
- keep workspace launch and command palette behavior unchanged
- limit this document to page-level surfaces

## 13. Acceptance Criteria

Phase 4A is complete when all of the following are true:

- On mobile, `Welcome`, `Auth`, and `Settings` read as full-screen route pages
- On mobile, `Settings` opens to a category list and drills into a detail view
- On mobile, leaving a settings detail returns to the category list, not out of settings
- On mobile, leaving the settings root uses history-first navigation with workspace/home fallback
- On desktop, `Settings` still renders the existing sidebar/content layout
- No Phase 3 mobile workspace behavior regresses

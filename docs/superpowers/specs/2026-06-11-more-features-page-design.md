# More Features Page Design

> Status: Draft
> Date: 2026-06-11
> Scope: `packages/web` more-features routing shell, desktop and mobile navigation behavior, settings/analysis/about information architecture

## Goal

Add a dedicated `更多功能` page family under `/more/*` so that configuration,
analysis, diagnostics, and about/update entry points are no longer crowded into
the existing settings page.

The v1 goal is not to redesign every existing tool page. The goal is to create a
clear information architecture and a stable outer navigation shell that can host
existing content with less confusion.

## Final Direction

Use a standalone page family under `/more/*`.

Key decisions:

- do not use a floating menu or popover
- do not render `更多功能` inside the workspace shell chrome
- desktop uses one stable page shell with top-level category tabs and a left-side
  section nav
- mobile keeps the current progressive drill-in interaction instead of forcing the
  desktop split-pane layout onto a small screen
- settings content layout and styling remain as-is in v1; only the outer route and
  navigation shell change

## In Scope

- a new route family rooted at `/more/*`
- category-level information architecture for settings, analysis/diagnostics, and
  about/update
- desktop navigation shell for the new page family
- mobile navigation flow for entering categories and then concrete pages
- route mapping for existing settings, analytics, monitoring, diagnostics, and
  about/update content
- design constraints for visual weight, roundness, and interaction model

## Out Of Scope

- redesigning current settings form layouts or control styling
- changing the actual contents of existing settings sections beyond relocation
- changing work analysis, monitoring, diagnostics, or about internals in v1
- using a floating menu layer
- embedding the more-features experience into the workspace page chrome
- forcing mobile to reuse the desktop left-nav plus right-content pattern

## Existing Context

Current settings content already contains both true configuration sections and
non-settings destinations.

Visible settings navigation today is centered around:

- `general`
- `providers`
- `appearance`
- `shortcuts`

Additional sections already exist in the current settings page renderer or as
separate pages:

- `analysis`
- `monitoring`
- `diagnostics`
- `about`
- standalone routes for `/analytics`, `/monitoring`, and `/diagnostics`

This means the product already has the underlying content. The missing piece is a
better outer structure for where users discover and switch between these areas.

## Information Architecture

The approved v1 category model has three top-level groups:

1. `设置`
2. `分析诊断`
3. `关于与更新`

### 1. 设置

This category keeps only true configuration items:

- `通用`
- `Agents`
- `外观`
- `快捷键`

These are all existing settings-style sections and remain the right fit for a
configuration category.

### 2. 分析诊断

This category pulls higher-priority operational pages out of settings:

- `工作分析`
- `性能监控`
- `环境诊断`

These pages are not configuration-first experiences. They are destination pages
for understanding system state and work outcomes, so they should not be buried
inside settings.

### 3. 关于与更新

This category groups app identity and version-management concerns:

- `关于应用`
- `更新状态`
- `自动更新`

This split is important because `关于` is no longer treated as one long catch-all
page. Product metadata and update workflow concerns become independent navigation
targets.

## Route Model

The approved route structure is:

```text
/more/settings/:section
/more/analysis/:section
/more/about/:section
```

Recommended initial concrete routes:

```text
/more/settings/general
/more/settings/providers
/more/settings/appearance
/more/settings/shortcuts

/more/analysis/analytics
/more/analysis/monitoring
/more/analysis/diagnostics

/more/about/product
/more/about/update-status
/more/about/auto-update
```

Route naming note:

- UI labels may use user-facing names such as `Agents`
- route segments should prefer existing internal identifiers where reuse reduces
  churn, such as keeping `/more/settings/providers` for the `Agents` page
- the same rule applies to other migrated destinations: keep stable route ids even
  if the visible navigation copy is refined

Route behavior rules:

- `/more/*` is a standalone page family, not a workspace sub-pane
- top-level category changes update the first route segment after `/more/`
- left-side section changes update the `:section` segment
- each concrete page must have a stable URL for refresh, navigation, and deep-link
  use

## Desktop Design

Desktop uses a dedicated more-features shell with three fixed regions:

1. page header
2. top horizontal category navigation
3. two-column body with left section nav and right content area

### Standalone Page Behavior

The page must visually read as its own destination. It should not appear inside
workspace tabs, activity rails, or workspace header chrome.

The page header shows:

- page title: `更多功能`
- current route indicator
- short explanatory text about the current category model

### Top Category Navigation

The approved final style is intentionally light:

- flat tabs, not heavy cards
- low roundness
- active state communicated with a thin accent underline and stronger label color
- inactive items stay mostly text-only
- descriptive helper copy is only shown for the active tab

This keeps the category switcher visible without dominating the page.

### Left Section Navigation

The left nav is also intentionally light:

- list-style navigation, not boxed feature cards
- active item uses a thin accent rail and subtle background tint
- inactive items mostly show title only
- helper copy only expands on the active item

This reduces visual weight and keeps attention on the right content panel.

### Right Content Area

The right content area hosts the actual page content for the selected route.

Important v1 rule for `设置`:

- keep the current settings content layout and styling unchanged
- only relocate it behind the new `/more/settings/*` shell

The desktop design work in this feature therefore affects discovery, routing, and
outer-page structure, not the internals of the settings forms.

For analysis and about/update pages, the same rule applies in spirit:

- use the new outer shell for navigation
- keep existing page content patterns unless a later task explicitly redesigns them

## Mobile Design

Mobile does not use the desktop split-pane shell.

The approved mobile interaction stays close to the current product behavior:

1. enter `更多功能`
2. choose a category such as `设置`
3. choose a concrete section such as `通用`
4. open the final content page

This means mobile navigation is progressive drill-in, not side-by-side navigation.

Recommended route progression example:

```text
/more
/more/settings
/more/settings/general
```

Mobile rules:

- keep the interaction layered and simple
- do not force a persistent left navigation rail on small screens
- the final page for a concrete section can reuse the current mobile settings page
  content behavior

## Visual Constraints

The approved visual direction is:

- flat
- restrained
- low roundness
- light navigation weight
- no floating menu styling
- no oversized category cards

Specific constraints:

- top-level navigation should feel like tabs, not marketing cards
- left-side section nav should feel like a product list, not a dashboard of tiles
- the content area should remain visually dominant

## Content Mapping

The initial content mapping is:

| Category | Route base | Sections | Content source |
| --- | --- | --- | --- |
| 设置 | `/more/settings/*` | 通用 / Agents (`providers`) / 外观 / 快捷键 | existing settings sections |
| 分析诊断 | `/more/analysis/*` | 工作分析 / 性能监控 / 环境诊断 | existing analytics, monitoring, diagnostics pages |
| 关于与更新 | `/more/about/*` | 关于应用 / 更新状态 / 自动更新 | existing about and update content |

## Entry Requirement

The user-facing label for the entry is `更多功能`.

This design locks the destination behavior after entry. The exact placement and
launch affordance for the entry button can be finalized in implementation as long
as it opens the `/more/*` page family and does not reintroduce a floating menu
experience.

## Non-Negotiable V1 Rules

- `更多功能` is a page, not a popover
- the page is standalone, not visually nested inside workspace shell chrome
- desktop and mobile may use different navigation patterns
- settings content internals are preserved in v1
- analysis and diagnostics do not stay hidden inside settings navigation

## Testing Expectations For Implementation

When implementation starts, the minimum validation should cover:

- desktop route switching between the three top-level categories
- desktop left-nav switching within each category
- deep linking to concrete `/more/.../...` pages
- mobile drill-in flow from `/more` to category pages to concrete section pages
- preservation of current settings content behavior when rendered under the new
  `/more/settings/*` routes
- no regression for existing analytics, monitoring, diagnostics, and about content

## Design Artifact

The approved local visual draft for this design is:

- `docs/more-features-page-preview.html`

That preview reflects the current approved direction:

- standalone desktop more-features page
- light top tabs
- light left navigation
- unchanged settings content scope
- mobile progressive drill-in flow

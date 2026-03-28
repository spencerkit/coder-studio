# Design System: Coder Studio

## 1. Visual Theme & Atmosphere

Coder Studio is a dark, terminal-first engineering workbench. The mood should feel quiet, precise, and operational rather than glossy or playful. Surfaces are dense but not cramped. Interaction feedback should be crisp and restrained. New UI for history and Claude settings must feel like it belongs inside a serious developer cockpit, not a separate SaaS admin panel.

Keywords:

- dark terminal minimalist
- quiet ops
- high-focus productivity
- low-noise, low-gloss
- technical, precise, dense

## 2. Color Palette & Roles

- App Background: `#0d1418`
- Elevated Background: `#121b1e`
- Secondary Surface: `#141f24`
- Tertiary Surface: `#1c2a31`
- Overlay Surface: `rgba(20, 31, 36, 0.95)`
- Glass Surface: `rgba(16, 26, 31, 0.9)`
- Primary Text: `#e7f3f7`
- Secondary Text: `#b4cad3`
- Muted Text: `#7d98a4`
- Border: `rgba(180, 216, 225, 0.12)`
- Strong Border: `rgba(180, 216, 225, 0.2)`
- Primary Accent: `#5ac8fa`
- Primary Accent Soft: `rgba(90, 200, 250, 0.15)`
- Secondary Accent: `#8fffae`
- Secondary Accent Soft: `rgba(143, 255, 174, 0.18)`
- Warning Accent: `#ffd37a`
- Warning Soft: `rgba(255, 211, 122, 0.16)`
- Danger Accent: `#ff9eb0`
- Danger Soft: `rgba(255, 158, 176, 0.17)`

Color usage rules:

- Use blue accent for focus, selection, restore, active links, and current context.
- Use green accent for healthy / resumed / ready states.
- Use amber for archived or cautionary informational states.
- Use pink-red only for destructive actions like hard delete.
- Never brighten the whole panel; rely on localized accent bars, tags, and focus rings.

## 3. Typography Rules

- Primary UI Font: `"IBM Plex Sans", "Noto Sans SC", "Source Han Sans SC", "PingFang SC", sans-serif`
- Monospace: `"JetBrains Mono", "Cascadia Mono", "IBM Plex Mono", "Fira Code", monospace`

Scale:

- Micro labels: 11px
- Dense controls: 12px
- Default UI body: 13px
- Section labels: 14px
- Panel titles: 16px to 18px

Rules:

- Use compact uppercase labels sparingly for panel chrome.
- Use mono only for command, path, shell, and config snippets.
- Prefer high-contrast title + subdued metadata pairings.

## 4. Geometry & Component Stylings

- Overall radius: subtle and technical, mostly `4px` to `8px`
- Avoid pill-heavy styling except for status chips and tiny toggles
- Tabs: flat or lightly raised, integrated into panel chrome
- Drawers: straight-edged container with subtle inner border and soft shadow
- Cards: only when necessary; most surfaces should read as panels or list rows, not marketing cards
- Inputs: dark recessed surfaces with strong focus ring
- Destructive actions: outlined or ghost buttons with danger accent on hover

## 5. Depth & Motion

- Shadows should be whisper-soft, mostly diffused black shadows
- Use motion only for:
  - left drawer reveal
  - state chip transitions
  - restore chooser tab switch
  - subtle row hover/focus
- Avoid bouncy or playful motion
- Prefer 140ms to 180ms ease-out for panel transitions

## 6. Layout Principles

- Dense workbench layout with explicit panel boundaries
- Strong vertical rhythm via separators and compact spacing
- Make hierarchy through alignment and text contrast, not oversized cards
- History drawer should feel attached to the workbench shell, not like a modal
- Claude settings should balance form density with scanability:
  - left nav
  - grouped sections
  - advanced JSON areas clearly separated

## 7. Feature-Specific Guidance

### History Drawer

- Width should feel utility-grade, not oversized
- Workspace group headers should anchor scanning
- Session rows should make primary action obvious:
  - active rows feel navigational
  - archived rows feel recoverable
  - delete remains secondary but visible
- Status chips should be subtle, with accent only where meaningful

### Restore Chooser In Draft Pane

- Keep the pane-local context obvious
- Two-mode switch should be clear and minimal
- The restore list should feel like selecting a dormant session into this pane position
- Avoid any cross-workspace ambiguity

### Claude Settings

- This is not a generic form page
- It should feel like configuring a runtime
- Surface inheritance and override clearly
- Advanced JSON editors should feel trustworthy, technical, and integrated with the same dark system

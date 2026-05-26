# Welcome Step-First Redesign

## Goal

Refocus the welcome page around the two actions a new user must understand immediately:

1. Open a local workspace
2. Start an AI session inside that workspace

The redesign must fix the desktop action row wrapping bug and make short mobile screens usable without losing access to lower content.

## Problems

- Desktop layout treats hints, buttons, and helper copy as one wrapping flex group, so copy and actions visually collide.
- Mobile layout gives equal weight to hero copy, action hints, and feature cards, which makes the screen too tall for short devices.
- The app shell uses `overflow: hidden`, so the welcome screen must provide its own scroll container.

## Design

### Information Hierarchy

- Keep the kicker, title, and short description at the top.
- Promote the two core steps into the main visual structure.
- Treat settings guidance and “why use it here” content as secondary support.
- Replace the large feature-card row with a lighter supporting summary.

### Desktop

- Use a two-column landing card:
  - Left column: kicker, title, short description.
  - Right column: the two-step workflow.
- Each step gets:
  - step number / eyebrow
  - short title
  - short detail
  - relevant action when applicable
- Add a secondary strip below the main grid with compact supporting bullets.

### Mobile

- Collapse to a single column.
- Keep hero copy shorter in perceived height with tighter spacing.
- Render the two-step workflow directly under the hero.
- Show only compact supporting bullets below the workflow.
- Make the welcome container itself scrollable with safe-area-aware padding.

## Content Strategy

- Reuse the existing “Open Workspace” and “Settings” actions.
- Keep the first step focused on opening the local project folder.
- Keep the second step focused on launching Claude or Codex after the workspace opens.
- Use the existing Git and terminal benefits as the smaller supporting bullets.

## Implementation Notes

- Add welcome-page-specific classes instead of heavily changing shared `welcome-card` behavior used by auth and not-found screens.
- Update locale strings to support step titles/details and a compact secondary section title.
- Update tests to assert the new structure instead of the old feature-card-heavy layout.

## Verification

- Welcome page tests should cover desktop structure, mobile structure, locale rendering, modal opening, and settings navigation.
- Theme/style tests should verify the mobile shell remains vertically stacked and scrollable.

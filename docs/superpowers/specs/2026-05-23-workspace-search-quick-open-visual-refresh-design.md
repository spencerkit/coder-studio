# Workspace Search And Quick Open Visual Refresh Design

> Status: Draft
> Date: 2026-05-23
> Scope: `packages/web/src/features/workspace/views/shared/search-panel.tsx`, `packages/web/src/features/quick-open/components/quick-open.tsx`, corresponding `packages/web/src/styles/components.css` selectors and tests

## Goal

Refine the new desktop `Search` sidebar and `Quick Open` overlay so they read and behave much closer to VS Code.

This design does not introduce new search domains. It improves the existing file-content search sidebar and file-only quick open surface so they feel like editor tooling instead of generic app panels.

The target outcome:

- `Search` becomes easier to scan in narrow sidebar width
- result groups become understandable at a glance
- repeated file/path noise is removed from every match row
- `Quick Open` feels like a file jump surface rather than a general search modal

## Relationship To Existing Spec

This document refines the UI treatment from:

- [2026-05-23-workspace-sidebar-search-quick-open-design.md](/home/spencer/workspace/coder-studio/docs/superpowers/specs/2026-05-23-workspace-sidebar-search-quick-open-design.md)

That earlier spec defines the feature set and high-level information architecture.

This document only covers the visual hierarchy, result grouping behavior, and interaction details for the desktop `Search` sidebar and `Quick Open`.

## In Scope

- desktop `Search` sidebar visual hierarchy
- grouped search results by file with per-file expand and collapse
- default expand behavior for new search results
- compact result row treatment for content matches
- `Quick Open` file-only visual treatment
- `Quick Open` result row structure and active state
- copy and spacing updates needed to support the new hierarchy

## Out Of Scope

- search and replace
- regex, case sensitivity, or whole-word toggles
- command, symbol, or recent-item results inside `Quick Open`
- mobile `FileTreePanel` search changes
- command palette redesign
- backend ranking changes
- new search commands or API changes

## Problem

The current `Search` sidebar is functionally correct but visually weak:

- the summary, file identity, path, and match rows compete at the same weight
- file path text runs directly into the file title instead of forming a readable group header
- every match row feels detached from its file
- the sidebar lacks the compact, inspectable rhythm users expect from editor search

The current `Quick Open` works as a file opener but still reads more like a generic search list:

- result rows are too flat
- file identity and path hierarchy are weak
- the overlay does not yet feel like a focused file jump tool

## Decision Summary

Adopt a strict VS Code-leaning presentation for both surfaces.

### Search Sidebar

- keep the single search input and summary line
- render results as collapsible file groups
- default all file groups to expanded after each successful query
- let users collapse or expand each file independently
- move file identity to the group header and keep match rows compact

### Quick Open

- keep file-only results
- render results in a two-line structure
- show file name as the primary line
- show the relative path as the secondary, de-emphasized line
- keep keyboard behavior unchanged

This is the recommended design because it addresses the actual usability problem, not just surface styling.

## Search Sidebar Design

## Overall Tone

The sidebar should feel like editor chrome:

- compact
- low-radius
- low-shadow
- text-first
- dense enough for scanning

Avoid card-like grouping, large empty blocks, or decorative emphasis.

## Search Header Area

The top of the panel keeps the existing title and single search field.

Visual treatment:

- the search input should be narrower in height and closer to VS Code field chrome
- corners should be restrained rather than pill-like
- focus state should read as an editor input, not a marketing form field

Below the input, show a compact summary line:

- empty query: instructional text
- loading: loading text
- populated query: `X results in Y files`

If the backend truncates results, show a short secondary note directly below the summary.

## Search Result Grouping

Search results are rendered as file groups.

Each group consists of:

- a clickable group header
- a collapsible list of match rows

### Group Header Content

Each file header shows:

- chevron for expand or collapse
- file name as primary text
- relative path as secondary text
- match count right-aligned

The file path should be visually subordinate and never run into the title as unstructured text.

### Default Expansion

After each successful search query:

- all returned file groups start expanded

This matches the expected scan-first workflow and is closest to VS Code.

### Collapse Behavior

Users can collapse or expand a file group by clicking the group header.

Collapse state is local to the current result set and should reset when a new successful query returns.

This means:

- typing a new search term restores all groups to expanded
- retrying a failed query also restores all groups to expanded on success

Persisting collapse state across queries is out of scope because it creates confusing carry-over between different result sets.

## Search Match Rows

Each match row should become a compact editor-style result line.

Row structure:

- fixed-width line number column
- preview text column

Behavior:

- clicking a match opens the file at that location
- the sidebar remains open after navigation

Visual rules:

- line numbers are low emphasis and right-aligned
- preview text is primary
- highlighted match text uses the existing search highlight treatment, but should not overpower the row
- hover and active states are single-layer backgrounds, not cards

Rows must not repeat file name or path, because that context already exists in the group header.

## Search States

All non-result states should stay compact and tool-like.

### Idle

Show a short prompt such as:

- `Type to search across file contents.`

### Loading

Show a lightweight loading line in the results area.

### No Results

Show a short no-results message without large empty-state chrome.

### Error

Keep the retry affordance, but reduce visual bulk:

- short error text
- compact retry button below or beside it

## Quick Open Design

## Behavioral Scope

`Quick Open` remains file-only in this iteration.

It does not include:

- commands
- symbols
- recents
- workspace actions

This keeps the overlay aligned with its current data model and prevents the UI refresh from turning into a mixed-result redesign.

## Overlay Tone

The overlay should feel like a focused file switcher:

- restrained chrome
- compact input bar
- dense result list
- clear active-row highlight

It should visually move closer to VS Code and away from a generic modal sheet.

## Result Row Structure

Each result row becomes a two-line item:

- primary line: file name
- secondary line: relative path

Hierarchy rules:

- file name carries most of the contrast
- path is smaller or lower-contrast
- the active row uses a single background fill

This keeps rows readable when many files share similar names across directories.

## Keyboard And Pointer Behavior

Keep the current interaction contract:

- `Ctrl/Cmd+P` opens
- up and down arrows move active selection
- `Enter` opens the active file
- `Escape` closes
- hover updates the active row
- click opens and closes

No command-prefix parsing is added in this pass.

## Component And State Changes

## Search Sidebar

The `SearchPanel` client state should add a per-query expand map keyed by file path.

Required behavior:

- initialize all returned paths to expanded on successful search
- toggle individual paths from the group header
- keep match rows mounted only when the group is expanded

The backend payload already groups matches by file, so no server contract changes are required.

## Quick Open

`QuickOpen` keeps its current fetch model and selection model.

The change is limited to:

- row markup hierarchy
- spacing
- active styling
- empty and loading presentation polish

## Accessibility

Search group headers should be keyboard reachable controls with clear expanded state semantics.

Required expectations:

- collapsed and expanded state must be conveyed to assistive tech
- hit targets should remain usable in narrow sidebar widths
- active quick-open item contrast must remain clear
- highlighted search text must not become unreadable in dark theme

## Testing

## Search Sidebar

Update and extend tests to cover:

- grouped file rendering still works
- each file group starts expanded after results load
- clicking a group header collapses that file's matches
- clicking again re-expands the matches
- a new successful query resets returned groups to expanded
- navigation from a match row still opens the correct location

Style-oriented tests should verify:

- group header structure selectors exist
- line number and preview columns keep the compact hierarchy
- summary and truncation note remain in the expected order

## Quick Open

Update tests to cover:

- two-line result structure
- active row styling hook remains present
- keyboard navigation and enter-to-open behavior stay unchanged
- no mixed result types are introduced

## Risks And Mitigations

### Risk: Search Sidebar Gets Too Dense

Mitigation:

- keep line height readable
- use contrast hierarchy instead of shrinking everything
- keep only one secondary text line in group headers

### Risk: Collapse State Feels Unstable

Mitigation:

- define reset semantics clearly: every successful query returns to fully expanded

### Risk: Quick Open Becomes Visually Inconsistent With Existing Shared Layers

Mitigation:

- preserve existing overlay sizing and focus management
- limit the change to row hierarchy and chrome polish

## Acceptance Criteria

- desktop `Search` results render as per-file groups with headers and collapsible match lists
- all file groups are expanded by default after each successful search
- file name, path, and match count are clearly separated in the file header
- match rows no longer repeat the file identity
- `Quick Open` remains file-only
- `Quick Open` rows display a primary file name line and a secondary path line
- both surfaces feel visually closer to VS Code than the current implementation

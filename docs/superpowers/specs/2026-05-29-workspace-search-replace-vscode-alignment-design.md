# Workspace Search Replace VS Code Alignment Design

> Status: Draft
> Date: 2026-05-29
> Scope: `packages/web/src/features/workspace/views/shared/search-panel.tsx`, `packages/web/src/features/workspace/views/mobile/mobile-files-sheet.tsx`, `packages/web/src/features/workspace/atoms/*`, `packages/web/src/features/code-editor/*`, `packages/web/src/styles/components.css`, `packages/server/src/commands/file.ts`, `packages/server/src/fs/*`, related tests

## Goal

Upgrade the workspace `Search` surface so desktop and mobile both align much more closely with VS Code search-and-replace behavior.

The target outcome:

- remove the current `查询 / 结果` dual-section presentation
- add progressive `Replace` and `Search Details` controls
- support `Match Case`, `Whole Word`, `Regex`, and `Preserve Case`
- support VS Code style `files to include` and `files to exclude` glob filters
- support `only open editors` and ignore-rule toggles
- add hierarchical replace actions for all results, per file, and per match
- add file-level diff preview for replacements using the existing unified editor surface
- keep one shared behavior model across desktop and mobile

## Relationship To Existing Specs

This design extends and partially supersedes the search behavior defined in:

- [2026-05-23-workspace-sidebar-search-quick-open-design.md](/home/spencer/workspace/coder-studio/docs/superpowers/specs/2026-05-23-workspace-sidebar-search-quick-open-design.md)
- [2026-05-23-workspace-search-quick-open-visual-refresh-design.md](/home/spencer/workspace/coder-studio/docs/superpowers/specs/2026-05-23-workspace-search-quick-open-visual-refresh-design.md)
- [2026-05-27-workspace-panel-balanced-workbench-design.md](/home/spencer/workspace/coder-studio/docs/superpowers/specs/2026-05-27-workspace-panel-balanced-workbench-design.md)

It also reuses the diff-hosting direction from:

- [2026-05-20-unified-editor-surface-design.md](/home/spencer/workspace/coder-studio/docs/superpowers/specs/2026-05-20-unified-editor-surface-design.md)

Those earlier documents establish:

- the `Search` sidebar as a dedicated file-content search surface
- the compact workbench grammar for sidebar panels
- the unified editor surface as the canonical place to show text diff

This document adds the missing VS Code-like replace, preview, filter, and edge-case behavior on top of that base.

## In Scope

- desktop `Search` sidebar redesign for VS Code-like search and replace
- mobile `Search` surface alignment with the same capability set
- advanced search toggles and progressive disclosure
- include and exclude glob filters
- `only open editors` search mode
- ignore and exclude rule toggles
- hierarchical replace actions:
  - replace all results
  - replace all in one file
  - replace one match
- replacement preview summaries in the search results tree
- diff preview handoff into the unified editor surface
- backend search session and apply behavior
- conflict handling, partial-success reporting, and stale-session handling
- unit, integration, and visual test coverage for the new model

## Out Of Scope

- command-palette style mixed search results
- symbol search
- cross-workspace search
- search history or saved search presets
- replace preview editing inside the diff surface
- search results spanning unsaved in-memory editor buffers
- a full clone of every VS Code setting and search preference
- arbitrary file-to-file compare

## Problem

The current `SearchPanel` is intentionally narrow:

- one search box
- static filter chips
- grouped content results
- no replace workflow
- no search-details expansion
- no regex, whole-word, or preserve-case behavior
- no include or exclude filters
- no preview-before-apply flow

That creates four product gaps.

### 1. The current search UI is not editor-grade

The surface still reads like a simple app tool rather than a true code-editor search view.

The strongest signals:

- duplicate `查询 / 结果` section titles
- placeholder filter chips that do not correspond to real search semantics
- no replace workflow
- no advanced file scoping controls

### 2. Search and replace semantics are missing

Users can locate content but cannot use the search view as a structured refactoring or text migration tool.

That prevents common editor workflows such as:

- renaming repeated text across files
- scoped regex replacement
- reviewing replacement previews before writing

### 3. The current backend is too narrow for VS Code alignment

`file.searchContent` returns grouped matches and works well for simple search, but it does not model:

- replacement text
- regex captures
- preserve-case behavior
- include and exclude scope
- diff preview payloads
- stale-session or partial-apply reporting

### 4. Mobile and desktop would diverge if replace were bolted on ad hoc

If replace is added only to the desktop layout or only as a front-end-only calculation, the product will quickly split into:

- a richer desktop-only editor workflow
- a weaker mobile-only search viewer

That is not acceptable for this work. The capability model must stay shared, while the layout adapts per viewport.

## Decision Summary

Adopt a VS Code-leaning search session architecture with unified backend semantics and shared desktop/mobile behavior.

### UI Direction

- remove repeated inner panel titles
- keep the runtime module identity in the workbench shell
- use progressive disclosure for replace and advanced search details
- increase visual density on desktop
- preserve the same capability set on mobile with tighter layout and deeper folding

### Backend Direction

- keep `file.searchContent` for simple grouped content search consumers
- add a dedicated search session command set for replace-capable search
- compute match ranges, replacement previews, and apply behavior on the server
- treat replacement diff preview as editor content state, not a separate page

### Replace Direction

- support:
  - replace all
  - replace all in file
  - replace single match
- preview is required before writing
- apply uses conflict detection and may partially succeed

This is the recommended design because it gets close to VS Code behavior without forcing the entire workspace navigation model to be rebuilt again.

## Product Behavior

## Search Surface Structure

The `Search` panel body should stop rendering the current `查询` and `结果` section titles.

Instead, the running UI should present:

- workbench-level `SEARCH` view identity from the surrounding shell
- search controls immediately at the top of the panel body
- result summary and action area immediately below
- grouped results tree below that

This follows the same workbench grammar established in the balanced sidebar design:

- no boxed card sections
- no repeated panel title inside the panel body
- compact tool-like controls

## Progressive Disclosure

The top area has three disclosure levels.

### Level 1: Primary Search

Always visible:

- primary search input
- `Match Case`
- `Whole Word`
- `Regex`
- action affordance to expand replace
- action affordance to expand search details

### Level 2: Replace

Collapsed by default.

When expanded, show:

- replacement input
- `Preserve Case`

Replace remains expanded until the user collapses it or the panel state resets for another reason such as workspace change.

### Level 3: Search Details

Collapsed by default.

When expanded, show:

- `files to include`
- `files to exclude`
- `only open editors` toggle
- ignore and exclude rule toggle

Desktop can show these in a denser stack. Mobile keeps the same controls but allows them to fold more aggressively.

## Search Controls

### Primary Query

- scope: active workspace only
- debounce: `250ms`
- empty query:
  - no result tree
  - instructional empty state
- loading:
  - compact loading summary
- invalid regex:
  - inline error below the input
  - no result tree render

### Match Case

When enabled, matching is case-sensitive.

### Whole Word

When enabled, matching must satisfy whole-word boundaries.

### Regex

When enabled:

- the query is interpreted as a regular expression
- replacement supports capture groups
- invalid patterns are reported inline

### Preserve Case

Only meaningful when replace is expanded and replacement text is non-empty.

When enabled, replacement casing should adapt to the matched text shape similarly to VS Code.

Examples:

- `foo` -> `bar`
- `Foo` -> `Bar`
- `FOO` -> `BAR`

The exact adaptation should be documented in code tests, not inferred separately in front-end code.

## Include And Exclude Filters

The search-details area should align with VS Code style glob semantics.

### `files to include`

- accepts glob-style patterns
- supports comma-separated patterns
- uses `/` as the normalized separator
- narrows the search scope to matching files only

### `files to exclude`

- accepts glob-style patterns
- supports comma-separated patterns
- removes matching files from the search scope

### Only Open Editors

This toggle mirrors the VS Code “search only in open editors” behavior.

When enabled:

- search only considers currently open editor file paths
- include and exclude filters still apply inside that narrowed set

### Ignore And Exclude Rules

The search view should expose one compact toggle controlling whether standard ignore and exclude sources are applied.

When enabled, the search service should honor:

- `.gitignore`
- `.ignore`
- `.rgignore`
- `.git/info/exclude`
- workspace-level exclude inputs passed through the command model

This document does not require a full settings subsystem. It does require one clear user-visible toggle for “use standard ignore/exclude rules”.

## Result Summary

When a query resolves successfully, the summary row should show:

- total visible matches
- total visible files
- truncation note when applicable
- skipped-file note when applicable

When replace is expanded and replacement text is provided, the summary area should also expose:

- `Replace All`

The summary must stay compact and tool-like. It should not become a large empty-state banner.

## Result Tree

Results remain grouped by file.

Each file group shows:

- expand or collapse chevron
- file name
- relative path
- file match count
- file-level `Replace` when replace is active

Each match row shows:

- line number
- matched text preview
- replacement preview hint when replace is active
- `Preview`
- single-match `Replace`

The result rows should remain denser than the current implementation, especially on desktop.

## Default Expansion

After every successful query:

- all file groups default to expanded

Collapse state is scoped to the current result set and resets after a new successful query.

## Replace Preview In Result Rows

When replacement is active, each match row should communicate both:

- what matched
- what will replace it

This does not require rendering full multi-line diff inside the row.

It does require a clear inline preview contract such as:

- search-side snippet
- replacement-side snippet
- truncation marker if the line context is clipped

The full diff remains the job of the dedicated preview flow.

## Match Click Behavior

Clicking the match row itself should continue to:

- open the file
- navigate to the matched location
- keep the search view open

This remains separate from `Preview`.

## Diff Preview Behavior

`Preview` should open the existing unified editor surface in diff mode for the selected file under the current search session.

The preview should show:

- original file content on the left or original side
- replacement result on the modified side

This is a search-replace preview, not a git preview.

The editor shell should remain the existing unified editor surface rather than creating a separate search preview page.

## Mobile Behavior

Mobile must keep the same feature set:

- replace expansion
- search details expansion
- include and exclude filters
- regex, case, whole-word, preserve-case toggles
- result hierarchy
- preview and replace actions

The adaptations are only presentational:

- tighter row layout
- more aggressive collapsing of advanced controls
- action labels may compress, but capability must remain

No desktop-only search-and-replace workflow is allowed in this design.

## Search Session Architecture

## Why A Search Session

VS Code-like replace requires one consistent semantic source for:

- matches
- replacement previews
- diff preview payloads
- apply scopes
- stale detection

Trying to compute previews independently in the client would create drift between:

- visible result previews
- full-file diff previews
- final apply output

That drift is unacceptable.

## Keep `file.searchContent`

Retain the current `file.searchContent` command for simple grouped-content-search consumers and backward compatibility.

Do not overgrow it into a replace-aware command.

## New Command Surface

Add a dedicated session-based command set:

- `file.searchSession.start`
- `file.searchSession.previewFile`
- `file.searchSession.apply`

The naming can be adjusted during implementation if the project has a stronger command taxonomy preference, but the session split is required.

## `file.searchSession.start`

This command creates or refreshes a replace-capable search result set.

### Inputs

- `workspaceId`
- `query`
- `replace`
- `isRegex`
- `matchCase`
- `matchWholeWord`
- `preserveCase`
- `includeGlobs`
- `excludeGlobs`
- `useIgnoreFiles`
- `useExcludeSettings`
- `onlyOpenEditors`
- `openEditorPaths`
- bounded result limits

### Output

- `sessionId`
- aggregate counts
- grouped file results
- exact match ranges
- inline replacement previews
- per-file `baseHash`
- truncation flags
- skipped-file counts or reasons

### Required Behavior

- whitespace-only query returns an empty result set with no session work
- invalid regex returns structured validation error
- binary and unsupported files are skipped rather than hard-failing the session

## `file.searchSession.previewFile`

This command resolves the complete preview payload for one file in one session.

### Inputs

- `workspaceId`
- `sessionId`
- `path`

### Output

- `path`
- `baseHash`
- `originalContent`
- `modifiedContent`
- match and replacement ranges
- preview metadata sufficient for editor diff labeling

This output must be derived from the same replacement engine used by apply.

## `file.searchSession.apply`

One command should cover all replace scopes.

### Inputs

- `workspaceId`
- `sessionId`
- `scope`
  - `all`
  - `file`
  - `match`
- target identifiers for the chosen scope

### Output

- aggregate outcome counts
- per-file outcome records
- refreshed or stale-session signal

### Per-file statuses

- `applied`
- `conflict`
- `skipped`
- `not_found`

The exact enum can change, but the result must be structured enough for the UI to report partial success clearly.

## Search And Replace Engine Rules

## Candidate Discovery

Use `ripgrep` for fast workspace candidate discovery and glob scoping.

This layer is responsible for:

- workspace traversal
- ignore handling
- glob filtering
- initial candidate narrowing

## Semantic Resolution

Do not trust `ripgrep` alone as the final semantic source for replace.

After candidate discovery, the server must apply one unified text engine for:

- exact match range resolution
- whole-word boundary checks
- regex replacement
- capture-group substitution
- preserve-case transformation
- inline preview generation
- file preview generation
- final apply payloads

In short:

- `rg` is used for speed
- the server text engine is used for correctness

## Encoding And File-Type Rules

The engine should:

- skip binary files
- skip non-text files that cannot be processed safely
- skip files over a bounded size threshold if needed for safety

The result summary must indicate when files were skipped rather than silently hiding that fact.

## Session Lifecycle

Search sessions are short-lived and parameter-bound.

If any of these change, the client should treat the existing session as invalid and restart:

- query
- replacement text
- regex
- case
- whole-word
- preserve-case
- include globs
- exclude globs
- only-open-editors
- ignore toggle

`Preview` and `Apply` must carry the session id.

If the server detects:

- missing session
- parameter mismatch
- file state drift that invalidates the session model

it should return `stale_session`, and the client should rerun `start`.

## Diff Preview Integration

## Integration Direction

The current unified editor surface already hosts diff mode for git-backed workflows.

Search replace preview should reuse that surface instead of adding a separate full-page viewer.

## New Preview Kind

Extend the diff-preview state model with a search-replace preview variant such as:

- `search-replace-file-diff`

The exact type name can vary, but it must carry:

- file path
- title
- original content
- modified content
- base hash
- source metadata identifying the search session

## Preview Entry Points

- `Preview` from one search result row opens the file diff preview
- file-level replace preview may optionally reuse the same route

Opening a search preview should not erase the user’s search result state. Returning to the panel should preserve the current result tree until the query changes or a refresh is required.

## Apply And Conflict Behavior

## Conflict Model

Apply must use `baseHash` conflict detection derived from the session snapshot.

No blind write is allowed.

If a file changed after the session snapshot:

- match apply for that file fails with `conflict`
- no replacement is written for that file in that apply operation

## Replace All

Replace-all is allowed to partially succeed.

The UI should report:

- applied file count
- conflict file count
- skipped file count

Do not block the entire operation behind a modal if some files conflict.

Instead:

- keep the result tree visible
- mark failed files or surface failure summary inline
- allow the user to rerun search after resolving conflicts

## Refresh After Apply

After any successful or partially successful apply:

- rerun the current search session automatically

This guarantees the visible result tree matches disk state.

## Unsaved Editor Buffers

This design does not attempt to search unsaved in-memory edits from already-open files.

Search and replace operate on workspace files on disk.

That keeps the semantics aligned with the current file-read and file-write backend model.

If a file is dirty in the editor and the user runs replace from the search panel, the implementation should favor a safe and explicit behavior rather than silently merging in-memory edits.

The simplest acceptable v1 behavior is:

- search session works from disk state
- apply may conflict if disk state changed relative to the captured hash

Any richer dirty-buffer reconciliation is future work.

## State Model Changes

## Search Panel State

The current `SearchPanelState` is too small for the new workflow.

It should grow to include:

- query
- replace text
- toggle states
- include and exclude strings
- only-open-editors flag
- ignore toggle
- expanded file groups
- selected match key
- active session id
- session status
- inline validation errors
- apply progress and summary state

This state remains workspace-scoped.

## Shared Desktop And Mobile Model

Desktop and mobile should read from the same logical search model.

Do not fork search semantics by variant. The variant only changes layout and affordance density.

## Testing Strategy

## Server Tests

Add or update tests for:

- plain-string search session creation
- regex search session creation
- invalid regex reporting
- whole-word filtering
- preserve-case replacement
- capture-group replacement
- include-glob filtering
- exclude-glob filtering
- ignore toggle behavior
- only-open-editors filtering
- preview payload generation
- single-match apply
- single-file apply
- replace-all apply
- partial-success apply with conflicts
- stale-session handling

## Client Tests

Add or update tests for:

- search control progressive disclosure
- replace expansion and collapse
- search details expansion and collapse
- toggle state rendering for case, whole-word, regex, preserve-case
- include and exclude input behavior
- only-open-editors toggle behavior
- grouped result rendering with replacement previews
- file-level and match-level action rendering
- preview handoff into editor diff state
- apply summary and automatic result refresh
- stale-session recovery behavior

## Visual And Interaction Tests

Desktop and mobile coverage should confirm:

- no repeated inner panel title
- compact workbench density
- advanced controls placement
- result row hierarchy
- replace action hierarchy
- diff preview handoff

## Risks

### 1. Client And Server Semantic Drift

If any replacement preview logic lives in the client, the UI and apply behavior will diverge.

Mitigation:

- server owns match and replacement semantics
- client only renders returned data

### 2. Session Complexity Expands Too Far

The session model could grow into a broad search service too early.

Mitigation:

- keep scope focused on search-and-replace only
- preserve `file.searchContent` separately for simple search use cases

### 3. Conflict Reporting Becomes Opaque

If partial apply results are not structured well, users will not know what changed.

Mitigation:

- require per-file outcome records
- rerun search after apply
- preserve visible summary of failures

### 4. Mobile Layout Regressions

Adding full replace capability could overwhelm the mobile search sheet.

Mitigation:

- share capability model
- adapt layout with stronger folding
- cover mobile interaction with dedicated tests

## Summary

This design moves workspace search from a simple grouped-content finder to a VS Code-like search-and-replace workflow.

The key architectural decision is to centralize replace semantics in a short-lived server-side search session, while reusing the unified editor diff surface for preview.

That gives the product:

- authentic search-and-replace controls
- consistent preview and apply behavior
- shared desktop and mobile capability
- explicit conflict handling
- a cleaner path for future search refinements without rebuilding the entire panel again

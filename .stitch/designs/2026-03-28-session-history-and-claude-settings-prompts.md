# Stitch Prompts: Session History And Claude Settings

These prompts are prepared for Stitch generation once a Stitch MCP or CLI environment is available.

## Screen 1: Global Session History Drawer

Quiet, dark terminal-first developer workbench UI for Coder Studio. Design a global session history drawer that slides in from the left edge of an existing multi-workspace coding application. This is low-frequency "undo / regret insurance" functionality, so the UI should feel compact, utility-grade, and tightly integrated with the workbench shell instead of looking like a separate product area.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, desktop-first, responsive down to narrow laptop widths
- Theme: dark terminal minimalist, quiet ops, dense engineering cockpit
- Palette: background `#0d1418`, elevated `#121b1e`, secondary surface `#141f24`, tertiary `#1c2a31`, primary text `#e7f3f7`, secondary text `#b4cad3`, muted `#7d98a4`, primary accent `#5ac8fa`, positive accent `#8fffae`, warning accent `#ffd37a`, danger accent `#ff9eb0`
- Typography: IBM Plex Sans / Noto Sans SC for UI, JetBrains Mono for technical snippets
- Geometry: subtle 4px to 8px radius, straight panel boundaries, restrained shadows
- Motion: 160ms drawer slide-in, subtle row hover and focus states

**PAGE STRUCTURE:**
1. **Workbench Shell Context:** show a compact top workspace tab strip across the top, with a history icon fixed at the far left of the tab row, and the left-side history drawer opened.
2. **Drawer Header:** title "History", short helper text explaining that closed sessions are archived not deleted, close icon on the right.
3. **Grouped Workspace History:** multiple workspace sections, each with workspace title, path summary, target badge like Native or WSL, and session count.
4. **Session Rows:** each row shows title, recent activity time, subtle status chip, and different visual semantics for:
   - active session: click jumps and focuses
   - archived session: click restores
   - interrupted session: click retries restore
5. **Row Actions:** hard delete icon button aligned right, danger on hover but not visually dominant.
6. **States:** include one empty workspace group case hidden entirely, one live session row, one archived row, one interrupted row, and one focused hover state.

**UI DETAILS:**
- Workspace groups are stacked with tight spacing and divider rhythm.
- Status chips are compact and understated, not colorful pills.
- Active row uses blue accent edge or focus bar.
- Archived row uses amber informational tone, not warning-alert tone.
- Delete button is subtle until hover.
- The drawer should feel attached to the main shell with an inner border and faint shadow.

## Screen 2: Draft Pane Restore Chooser

Design a pane-local chooser for a new split inside the same Coder Studio dark workbench. The user has just created a new split pane. Instead of immediately starting a new session, the pane shows two choices: create a fresh session or restore from current workspace history. This interaction should feel lightweight, decisive, and local to the pane position.

**DESIGN SYSTEM (REQUIRED):**
- Same design system as above
- Must visually inherit the existing workbench shell
- Dense, technical, low-noise

**PAGE STRUCTURE:**
1. **Pane Frame:** show this chooser inside one split pane of a larger multi-pane agent workspace.
2. **Mode Switch:** top segmented control with two tabs:
   - New Session
   - Restore From History
3. **New Session Mode:** compact input area with concise placeholder, launch button, minimal empty-state guidance.
4. **Restore Mode:** list only current-workspace recoverable sessions, each with title, last activity time, status chip, and short metadata hint.
5. **Selection Feedback:** one row selected and ready to restore into this exact pane.
6. **Primary Action Area:** restore button makes the "restore into this pane slot" meaning obvious.

**UI DETAILS:**
- Do not show cross-workspace content anywhere.
- Do not show already-mounted live sessions in the restore list.
- The chooser should read as a replacement state for a draft pane, not a full-screen dialog.
- Include a subtle line explaining that the restored session keeps its original identity.

## Screen 3: Claude Settings Center

Design a high-density Claude runtime settings panel for Coder Studio. This replaces a simplistic launch-command setting with a complete Claude configuration center. The screen must feel like configuring an engineering runtime, not a generic SaaS settings page.

**DESIGN SYSTEM (REQUIRED):**
- Platform: Web, desktop-first
- Same dark terminal-first design language as the rest of the product
- Compact typography and sectional rhythm optimized for serious configuration work

**PAGE STRUCTURE:**
1. **App Settings Shell:** existing settings page with left navigation. Include top-level nav items General, Claude, Appearance. Claude is selected.
2. **Claude Header:** title, short explanation, runtime validation indicator, and summary of whether current target inherits global config or uses an override.
3. **Target Scope Switch:** clearly show Global, Native Override, WSL Override with inheritance toggles.
4. **Structured Sections:** stacked sections for:
   - Launch & Auth
   - Model & Behavior
   - Permissions
   - Sandbox
   - Hooks & Automation
   - Worktree
   - Plugins & MCP
   - Global Preferences
5. **Advanced JSON Area:** two integrated editors labeled `settings.json advanced` and `~/.claude.json advanced`, dark technical editor styling, validation state visible.
6. **Field Examples:** include executable path, startup args list, API key / base URL, model selector, permission mode, danger flags, sandbox toggles, plugin controls, IDE auto-connect preferences.

**UI DETAILS:**
- Strong grouping and separators, not oversized cards.
- Each section should have a compact heading and short muted explanation.
- Inheritance state must be unambiguous.
- Danger-related flags should be visually distinct but not alarmist.
- Validation state should feel operational: neutral info, warning, error, success.
- Use monospace for file paths, command arguments, and JSON labels.

# Product Requirements Document: Coder Studio (Product Review Edition, Code-State Baseline)

> **Last updated:** 2026-05-06  
> **Code baseline:** current implementation in `packages/web` and `packages/server`  
> **Scope:** Web UI, embedded server, WebSocket command layer  
> **Reading notes:**
> - Chapters `1 ~ 7` describe the current visible product capabilities, page structures, and user interactions from a product review perspective.
> - Chapter `8` preserves implementation boundaries and excluded scope so unshipped capabilities are not written up as shipped features.
> - The current code is the source of truth. Do not inherit unlanded items from older PRDs, the README, or historical planning notes.

---

## 1. Document Notes

### 1.1 Scope

This document only describes product capabilities that are **currently wired, reachable, and interactive** in the codebase, including:

- Welcome page, auth page, workspace page, settings page, and 404 page
- The desktop and mobile workspace experiences
- Core capabilities around files, Git, sessions, terminals, notifications, and configuration

### 1.2 Writing Principles

- **Code state is the source of truth:** a component or test existing in the repo does not mean the page-level feature is shipped.
- **Page-first structure:** describe page goals and interactions first, then state handling, boundaries, and error feedback.
- **User-visible capability first:** the main body stays in product language whenever possible; implementation facts are consolidated in the appendix.

### 1.3 How to Read This Document

- For **product review**, focus on Chapters `2 ~ 7`.
- To decide whether a capability is **actually wired**, merely UI, or still blocked by implementation boundaries, focus on Chapter `8`.

## 2. Product Overview

### 2.1 Product Positioning

Coder Studio is an **AI coding workspace for self-deployed environments, built around the promise Deploy once, coding everywhere**. Users can deploy it on a personal computer, development machine, home server, or cloud host, and then access the same workspace, sessions, terminals, and Git capabilities from a browser on desktop or mobile. Depending on how it is deployed, that access can stay on the same machine, remain inside a LAN, or be exposed externally.

The current implementation brings the following capabilities into one workspace system:

- Open and switch between multiple local workspaces
- Create multiple AI sessions inside one workspace (`Claude` / `Codex`)
- View and continue agent sessions through terminal-style interaction
- Browse a file tree, edit text files, and preview image files
- Inspect Git status, diffs, commits, push / pull, and branch switching
- Manage providers, notifications, appearance, and part of shortcut configuration

### 2.2 Current Core Value

At the product level, the current version delivers three core values:

1. **Deploy once, coding everywhere:** deploy once and continue coding from any reachable device.
2. **Bring AI sessions, files, Git, and terminals into one workspace workflow.**
3. **Provide two real, distinct access experiences for desktop and mobile.**

### 2.3 Form Factors

| Form factor | Shape | Core characteristics |
| --- | --- | --- |
| Desktop | Wide multi-pane workbench | Top bar + left sidebar + main area + bottom terminal |
| Mobile | Sheet / Dock driven workbench | Top bar + single-session main area + bottom Dock + multiple full-screen Sheets |

> **Note:**  
> The mobile experience is not a scaled-down desktop layout. It is a separate interaction model centered on `Dock + Sheet`.

## 3. Information Architecture & Core Flows

### 3.1 Route Map

| Route | Page | Notes |
| --- | --- | --- |
| `/` | Welcome page | Default entry when no reachable workspace is available; also provides workspace open and settings entry |
| `/auth` | Auth page | The actual frontend login route |
| `/workspace` | Workspace page | Main workspace; desktop and mobile use different experiences |
| `/settings` | Settings page | Desktop and mobile share the same capability set, with different navigation structures |
| `*` | 404 page | Displays unmatched paths and provides a return-home action |

### 3.2 Shell Selection

| Condition | Shell | Page skeleton |
| --- | --- | --- |
| Viewport width `> 899px` | Desktop Shell | Top bar, left sidebar, main area, bottom terminal |
| Viewport width `<= 899px` | Mobile Shell | Top bar, main session area, Dock, full-screen Sheets |

Both shells share:

- The same route system
- The same workspace / session / terminal data
- The same global capabilities, such as Quick Actions, branch switching, and Toasts

### 3.3 Startup and Entry Flow

The actual startup flow is:

1. Call the auth status endpoint first to determine whether login is required.
2. If server-side auth is enabled and the user is not authenticated:
   - Stay inside the auth flow
   - Do not continue restoring the workspace view
3. If the user is already authenticated:
   - Establish or restore the WebSocket connection
   - Fetch the workspace list after the connection is available
4. Use the workspace list to decide the default destination:
   - If the user is on the home page and at least one workspace exists, automatically enter the workspace page
   - If the user is on the workspace page and no workspace remains, automatically return to the home page
5. Inside the workspace page, if the current active workspace has not resolved yet:
   - Show a loading placeholder
   - Show an error placeholder if resolution fails

### 3.4 Global Connection State

All pages share one connection-state feedback model:

- `connected`: no connection banner
- `connecting`: no banner; wait for completion
- `reconnecting`: show `Reconnecting...`
- `disconnected`: show `Connection lost`
- `rejected`: show `Another tab is active`

When the app is **not connected**, both the desktop top bar and mobile top bar also show a lightweight connection indicator.

## 4. Page Specifications

## 4.1 Welcome Page `/`

### 4.1.1 Page Goal

The welcome page is the default entry when there is **no workspace currently available to enter**. It serves three purposes:

- Open a local workspace
- Enter the settings page
- Explain the product’s core capabilities in a lightweight way

### 4.1.2 Page Structure

The main content is a centered welcome card. Mobile only adjusts styling, not the information structure. The card always includes:

- Product kicker
- Title
- Description copy
- Primary button: `Open Workspace`
- Secondary button: `Settings`
- Divider
- Three feature highlight cards

### 4.1.3 Features and Detailed Interactions

| Area | Feature | Interaction rules |
| --- | --- | --- |
| Open Workspace button | Open the workspace launcher | Clicking opens the in-app directory browser; this is **not** the system-native file picker |
| Settings button | Enter settings | Clicking navigates to `/settings` |
| Feature highlights | Show core capabilities | Currently fixed to three items: Agent-first, Git tools, terminal capabilities |

### 4.1.4 States and Boundaries

- The welcome page itself has no complex error state.
- If the app has already resolved at least one workspace, the startup flow usually redirects the user to `/workspace`, so the welcome page is not a long-lived state.

## 4.2 Auth Page `/auth`

### 4.2.1 Page Goal

The auth page handles the case where the server has password protection enabled.

### 4.2.2 Page Structure

The auth page reuses the centered-card layout from the welcome page and includes:

- Product kicker
- App title
- Status / explanatory copy
- Status panel
- Password input
- Submit button

### 4.2.3 State Detection

After mount, the page decides what to show based on the auth status check result:

| State | Page behavior |
| --- | --- |
| Auth status is being checked | Show the `Connecting` state |
| Server auth is disabled | Immediately mark frontend auth as passed, then exit the auth page flow |
| A valid session already exists | Immediately mark frontend auth as passed |
| Service unavailable / request failed | Status panel shows `Unavailable / Unable to fetch status` |
| Login required | Stay on the page and wait for password input |

### 4.2.4 Submission and Error Feedback

| Scenario | Interaction rules |
| --- | --- |
| Empty input | Submit button is disabled |
| Status check in progress / submit in progress | Submit button is disabled and the button label switches to the connecting state |
| Submit succeeds | Mark frontend auth as passed after login succeeds |
| Wrong password | Show the server error text directly; the current typical copy is `Invalid password` |
| Temporary lockout triggered | If the server returns a lockout-until timestamp, the page formats and displays that time in the current language |
| Network error | Show network error copy |

### 4.2.5 Boundary Notes

- The input type is fixed to `password`.
- There is currently no `forgot password`, `switch account`, or explicit `logout` flow here.
- The auth page itself has no extra shortcut design.

## 4.3 Workspace Page `/workspace` (Desktop)

### 4.3.1 Page Goal and Overall Structure

The desktop workspace is the most complete workbench form in the current product. Its goal is to let the user do all of the following inside a single screen:

- Switch workspaces
- Create / close AI sessions
- Browse and edit code
- Inspect and handle Git changes
- Use the shell terminal

The page is divided into four regions:

| Region | Content |
| --- | --- |
| Top | Workspace top bar |
| Left | Files / Git panel |
| Center | Agent / editor / diff main area |
| Bottom | Terminal panel |

### 4.3.2 Entry Conditions and Page States

| State | Page behavior |
| --- | --- |
| Active workspace is still resolving | Show a loading placeholder card |
| Workspace list failed to load | Show an error card |
| Active workspace is empty | Show a `No workspace` empty state and do not render the full workbench |
| A valid workspace exists | Render the full desktop workspace |

### 4.3.3 Top Workspace Bar

#### 4.3.3.1 Workspace Tab Area

| Feature | Interaction / rules |
| --- | --- |
| Workspace tab list | Render in the current workspace order |
| Main tab label | Prefer workspace name; otherwise the last path segment; otherwise the full path or id |
| Status dot | Active workspace uses the active style; others use the idle style |
| Unread badge | Show when `unreadCount > 0`; display `9+` when count is greater than `9` |
| Click tab | Switch the active workspace |
| Keyboard `Enter` / `Space` | Also switches when the tab is focused |
| Close button | Close that workspace and remove it from the local list |
| Add button `+` | Open the workspace launcher |

#### 4.3.3.2 Action Area

| Button / area | Behavior |
| --- | --- |
| Connection status | Only visible when state is not `connected` |
| Quick Actions | Open / close the command palette |
| Terminal | Show / hide the bottom terminal panel |
| Files | Show / hide the left sidebar |
| Settings | Navigate to `/settings` |
| Fullscreen | Visible when supported by the browser; toggles fullscreen for the workspace root node |

#### 4.3.3.3 Returning After Closing the Last Workspace

- If the closed workspace was the last one, frontend workspace state becomes empty.
- Startup logic then detects that `/workspace` has no available workspace and automatically returns to `/`.

### 4.3.4 Layout, Sizing, and Focus Mode

#### 4.3.4.1 Page Layout

The desktop workspace always consists of three core content blocks:

- Left sidebar: files / Git
- Center main area: sessions / editor / diff
- Bottom panel: terminal

#### 4.3.4.2 Resizable Areas

| Area | Default / range |
| --- | --- |
| Left sidebar width | Default `280px`, range `220px ~ 480px` |
| Bottom terminal height | Range `120px ~ 400px` |

#### 4.3.4.3 Layout Persistence

The current workspace remembers:

- Left sidebar width
- Bottom terminal height
- Focus mode on / off state
- Current active session
- Session split layout

#### 4.3.4.4 Focus Mode

Focus mode is currently wired. When enabled, it:

- Hides the left sidebar
- Hides the bottom terminal

When disabled, both are restored.

> **Current product boundary:**  
> The only confirmed user-visible entry for focus mode is through the command palette. Do not document a standalone global `F` shortcut as a shipped capability.

### 4.3.5 Left Sidebar: Files / Git

#### 4.3.5.1 Shared Frame

The top of the left sidebar always includes:

- Current panel name
- Current branch button
- `Files / Git` tabs
- Inline Git status bar

##### Branch Button

Clicking the branch button does the following:

1. Switch the left sidebar to the Git tab
2. Open the branch quick switcher overlay

The button label prefers the current branch name, and falls back to `—` if no value exists.

##### Tab Switching

| Tab | Content |
| --- | --- |
| Files | File tree and file action toolbar |
| Git | Git panel |

When switched to `Files`, the file toolbar is shown. When switched to `Git`, the file toolbar is hidden.

#### 4.3.5.2 Files View

##### Top Toolbar

| Button | Behavior |
| --- | --- |
| New File | Open the create modal in `file` mode |
| New Folder | Open the create modal in `folder` mode |
| Refresh | Refetch the file tree |

##### File Tree Loading Model

- The root file tree loads on first entry.
- Child directories are lazy-loaded: when a directory expands and its children are not loaded yet, another request is sent for that directory path.
- At the top level, `app`, `packages`, and `src` expand by default.

##### File Search

| Feature | Rules |
| --- | --- |
| Search input | Typing triggers file search |
| Trigger timing | Fire after roughly `150ms` of idle time |
| Result limit | Default upper limit is `10` items |
| Result row | Shows file name, containing directory, and a delete action |
| Click search result | Open the file directly in the editor |

##### Tree Node Interactions

| Node type | Click behavior | Inline actions |
| --- | --- | --- |
| Folder | Expand / collapse; fetch children on first expansion | New file, new folder, delete |
| File | Set as current active file and open it in the main area | Delete |

##### Create File / Folder

The actual rules for the create modal are:

- It is shown as a modal
- If launched from a folder row action, the input is prefilled with `directory-path/`
- If launched from the toolbar, the input starts empty
- Empty path produces an error
- Creating a file with a path ending in `/` produces an error
- After submit succeeds:
  - Refetch the file tree
  - If a file was created, automatically open that file

##### Delete File / Folder

- Deletion runs through a confirmation dialog
- After confirmation, the delete request is sent
- After delete succeeds:
  - Refetch the file tree
  - If the deleted path is the currently open file, close it and clear the active file

#### 4.3.5.3 Git View

##### Panel Structure

The Git panel contains, from top to bottom:

- Toolbar
- Commit message input
- Latest commit summary
- Change group list
- Discard confirmation dialog, conditionally

##### Top Toolbar

| Button | Visibility | Behavior |
| --- | --- | --- |
| Refresh | Always visible | Refetch Git status |
| Stage All | Visible when changes exist | Stage modified / deleted / untracked files |
| Unstage All | Visible when changes exist | Unstage all staged files |
| Discard All | Visible when changes exist | Open confirm-all discard flow |
| Commit | Visible when changes exist | Only enabled when commit message is non-empty and staged changes exist |

##### Commit Input

- Uses a single-line auto-growing style textarea
- Clicking `Commit` sends the commit request
- On successful commit, the commit message is cleared and Git status refreshes

##### Latest Commit Summary

If the current state includes a latest commit summary, the panel shows:

- `Latest commit` label
- Short SHA
- Commit title

##### Change Groups

Changes are currently shown in this order:

1. `staged`
2. `changes` (`modified`)
3. `deleted`
4. `untracked`

Each group shows a title, count, and file list.

##### File-Level Interactions

| Action | Behavior |
| --- | --- |
| Click file row | Request the file diff and open diff view in the main area |
| Stage / Unstage | Toggle staged state for that file |
| Discard | Open single-file discard confirmation |

##### Diff Auto-Preview Rules

The Git panel has a real `preview the first item automatically` behavior:

- After Git status finishes loading, if diff preview has not been dismissed:
  - Keep the current preview if it still exists
  - Otherwise automatically select the first change and request its diff
- After the user explicitly closes diff, the `preview dismissed` flag becomes true so the UI does not keep auto-opening diff again

#### 4.3.5.4 Git Status Bar

The status bar shows three kinds of numbers:

- Total change count
- Ahead count
- Behind count

##### Push / Pull Triggers

- Click the ahead count: open the Push confirmation dialog
- Click the behind count: open the Pull confirmation dialog
- If the corresponding count is `<= 0`, the button is disabled

##### Confirmation Dialog

The confirmation dialog always includes:

- Title
- Description text
- Cancel button
- Primary action button

##### Secondary Flow for HTTP Auth Failure

When Push / Pull hits HTTP auth failure, and the backend indicates it can continue by asking for credentials:

- The dialog body switches to an auth form
- The username input is prefilled from server `usernameHint` when available
- Both username and password are required before continuing

If the backend marks the case as `interactive auth not supported`, the dialog only shows the warning and does not provide a submittable form.

### 4.3.6 Center Main Area: Sessions / Editor / Diff

#### 4.3.6.1 Display Priority

The display priority in the desktop main area is fixed:

1. If the left sidebar is on the Git tab and a diff preview exists, show diff
2. Otherwise, if an active file exists, show the editor
3. Otherwise, show the agent session area

This means:

- Git diff is bound to the Git tab
- As soon as the user switches back to the Files tab, the main area leaves diff and returns to the editor or session area

#### 4.3.6.2 Agent Session Area

##### Pane Layout

The session area supports:

- Single pane
- Horizontal split
- Vertical split
- Leaf nodes that are either real sessions or new-session draft cards

Each split container ratio is persisted into the current workspace UI state.

##### New Session Draft Card

When a pane has no real session yet, the main area shows a new-session draft card that supports:

- Choosing `Claude` or `Codex`
- Creating a session in the current pane
- Splitting to a new horizontal draft pane
- Splitting to a new vertical draft pane
- Closing the draft pane

##### Provider Launch Flow

The desktop draft card and the mobile create-session flow share the same provider launch model:

1. Check whether the provider runtime is available
2. If the runtime is available:
   - Create the session directly
3. If the runtime is unavailable but supports auto-install:
   - Start installation first
   - Poll install status every `1.5s`
   - Create the session after install succeeds
4. If the runtime is unavailable and auto-install is not supported:
   - Show manual install instructions on the card
   - If documentation URL exists, show a link-out action

Desktop-only extra rule:

- If either provider is currently starting or installing, both provider cards are disabled to avoid duplicate launches

##### Session Card

Each created session renders as a card containing:

- Top progress bar
- Header: status dot, title, provider badge, state badge, right-side action area
- Conditional Supervisor card
- Session terminal

###### Title and Status Display Rules

- Prefer `session.title`
- If missing, fall back to `SESSION-XX`
- Provider badge shows `Claude` / `Codex`
- State badge converts `starting / running / idle / ended / draft` into Title Case

###### Header Actions

| Action | Visibility | Behavior |
| --- | --- | --- |
| Stop | Only visible when `running` | Stop the current session |
| Split Horizontal | Always visible | Create a horizontal split anchored on the current session |
| Split Vertical | Always visible | Create a vertical split anchored on the current session |
| Close | Always visible | Remove from the pane layout first, then run the session close flow |

###### Clicking the Card Body

- Clicking blank space inside the card sets that session as the current workspace active session
- Clicking buttons, links, or input controls does not trigger that behavior

###### Actual Close Flow for Sessions

| Session state | Behavior |
| --- | --- |
| `ended` | Delete directly |
| Any other state | Stop first, poll until `ended`, then delete |

##### Inline Supervisor on Desktop

The Supervisor card appears inline inside a Session Card only when all of the following are true:

- The session has full capability
- The session is not `draft`
- The session is not `ended`

The inline area supports:

- Enable objective
- Edit objective
- Pause / resume
- Manually trigger one evaluation
- Disable objective

On desktop, enable / edit / disable all use modal dialogs.

#### 4.3.6.3 Editor and File Preview

##### File Open Rules

After a file is selected, the page enters one of two modes based on file type:

| File type | Page behavior |
| --- | --- |
| Text file | Open Monaco editor |
| Image file | Open image preview |

##### Text File Editing

| Feature | Interaction rules |
| --- | --- |
| Editor | Uses Monaco; switches language mode automatically from file extension |
| Dirty state | Mark unsaved after content changes |
| Save button | Only enabled for text files with unsaved changes |
| Save shortcut | Monaco really registers `Ctrl/Cmd + S` |
| Close button | Close the current file and clear the active file |

Saving sends `baseHash` for conflict detection.

##### Image File Preview

- Image files are previewed through `/api/file`
- That endpoint is only used for image preview, not as a general download endpoint

##### SVG / Text-Image Mode Switching

If the image file is itself a text-based image file, currently mainly SVG:

- The page shows an `Image / Text` mode switch button
- Switching from image to text:
  - Refetches the text content
  - Opens Monaco in text-file mode
- Switching from text back to image:
  - Reloads in image mode again

##### External Change Detection

The editor responds to refreshes triggered by filesystem or Git changes:

| Scenario | Behavior |
| --- | --- |
| File changed on disk and the current file has **no unsaved changes** | Automatically refresh to latest disk content |
| File changed on disk and the current file **has unsaved changes** | Keep local content and show `File has been modified on disk` warning |
| File deleted on disk | Show `File has been deleted on disk` warning |
| Image file resource changed | Refresh image URL / size |

##### Errors and Empty States

| Scenario | Page behavior |
| --- | --- |
| Open file fails | Show error information in the main area |
| `activePath` exists but file has not finished loading | Show a loading placeholder |
| No file selected | Show the editor empty-state prompt |

#### 4.3.6.4 Diff Viewer

Diff Viewer is a read-only view containing:

- File path at the top
- Close button
- Line-by-line rendered diff content
- Line numbers
- Distinct visuals for added / removed / meta / context lines

After diff is closed, the current behavior is:

- Clear the current diff preview
- Clear `activeFilePath`
- Return the main area to the agent view

### 4.3.7 Bottom Terminal Panel

#### 4.3.7.1 Panel Structure

The terminal panel contains:

- Top toolbar
- Optional terminal tabs
- xterm rendering area for the current terminal

#### 4.3.7.2 Toolbar

| Feature | Behavior |
| --- | --- |
| Current terminal title | Formatted from current terminal meta / title |
| Close current terminal | Close the selected terminal |
| New terminal | Create a new shell terminal |
| Terminal selector | Switch terminal when multiple terminals exist |

#### 4.3.7.3 Multi-Terminal Behavior

| Scenario | Page behavior |
| --- | --- |
| `0` terminals | Show empty state and `Create terminal` CTA |
| `1` terminal | Show xterm directly |
| `> 1` terminals | Show tabs and also provide selector dropdown |

#### 4.3.7.4 Shell Terminal Creation Rules

When creating a new shell terminal:

- The working directory is fixed to the current workspace path
- Unix-like environments default to `$SHELL -i`
- Windows defaults to `cmd.exe`

#### 4.3.7.5 Terminal Recovery and Rendering

Desktop terminals and agent terminals share the same xterm host capability and currently behave as follows:

- On first entry, try replay / snapshot restoration first
- Show a restoring overlay before restoration finishes
- Show a degraded overlay if replay is too stale, the terminal has already closed, or restoration fails
- Non-active terminals go through a hydration queue and show a placeholder during that stage

#### 4.3.7.6 Interaction Capabilities

| Feature | Behavior |
| --- | --- |
| Standard input | Send directly to terminal or session |
| Read-only protection | Non-interactive session terminals cannot accept input |
| Paste / drag-upload files | Upload files into the current workspace first, then inject shell-safe path text into the input |
| Upload in progress | Show `Uploading…` mask above xterm and temporarily disable input |

After upload succeeds, the terminal receives:

- Each path shell-escaped with single quotes
- Multiple files joined by spaces
- A trailing space, so the user can keep typing the command

## 4.4 Workspace Page `/workspace` (Mobile)

### 4.4.1 Page Goal and Overall Structure

The mobile workspace is not a shrunken desktop layout. It is a mobile workflow organized around `current session + Dock + multiple full-screen Sheets`.

The overall structure is:

- Top bar
- Current single-session main area
- Bottom Dock
- Full-screen Sheets for Agent / Files / Terminal / Supervisor and related flows

### 4.4.2 Entry Conditions and Page States

Mobile shares the same workspace startup and route-guard logic as desktop:

- Resolving: show loading placeholder
- Load failed: show error placeholder
- Valid workspace exists: enter the mobile workspace

### 4.4.3 Top Bar

| Feature | Behavior |
| --- | --- |
| Workspace button | Shows current workspace name; clicking opens the Workspace Drawer |
| Settings button | Navigate to `/settings` |
| Fullscreen button | Visible when supported by the browser; toggles fullscreen for the workspace view |

Workspace title display follows the same rule as desktop: workspace name first, then last path segment, then full path.

### 4.4.4 In-Page Banner

The mobile workspace page embeds the config drift banner at the top of workspace content.  
It is not a shell-level global bar spanning every page.

### 4.4.5 Main Session Area

#### 4.4.5.1 When a Session Exists

The main area shows **only one currently active session**.

The current main card behavior is:

- Reuse the same Session Card core content
- Do not show the desktop header action set
- Provide Supervisor entry through a top-corner affordance

So the mobile main card does **not** directly expose:

- Stop
- Split
- Close

#### 4.4.5.2 When No Session Exists

The page shows an empty state and CTA:

- Copy 1: prompt the user to start a session
- Copy 2: explain that file and terminal capabilities remain available from the Dock
- CTA: open Agent Sheet directly in create mode

#### 4.4.5.3 Focus Synchronization

If an external action, such as clicking a notification, requests focus on a session:

- As long as that session belongs to the current workspace
- Mobile automatically switches the visible current session to it

### 4.4.6 Bottom Dock

The Dock always contains three entries:

- `Agent`
- `Files`
- `Terminal`

Interaction rules:

| Dock item | Behavior |
| --- | --- |
| Agent | Open / close Agent Sheet |
| Files | Open Files full-screen Sheet |
| Terminal | Open Terminal full-screen Sheet |

Current active-state rules:

- Highlight `Agent` when Agent Sheet is open
- Highlight the matching item when Files or Terminal Sheet is open

### 4.4.7 Agent Sheet

#### 4.4.7.1 Modes

Agent Sheet has two modes:

- `sessions`: session list
- `providers`: create new session

Default rules:

- If sessions already exist, default to `sessions`
- If no session exists yet, default to `providers`

#### 4.4.7.2 Session List Mode

Content includes:

- `Create session` action row
- Session list for the current workspace

Each session row provides:

- Primary click: switch to that session and close the Sheet
- Trailing close button: close that session, then close the Sheet

#### 4.4.7.3 Provider Mode

The provider list is currently fixed to:

- Claude
- Codex

Interaction rules:

- After choosing a provider, reuse the same runtime / auto-install / create flow as desktop
- After successful creation:
  - Write session data
  - Append it into layout
  - Switch it into the current mobile session
  - Close the Sheet

Difference from desktop:

- Mobile shows busy state per provider and only disables the busy item
- Desktop locks the entire provider area if any provider is busy

### 4.4.8 Files Sheet

Files Sheet is a full-screen Sheet with three route states:

- `root`
- `editor`
- `diff`

#### 4.4.8.1 Root State

The root-state top area includes:

- Current branch button
- `Files / Git` tabs
- Inline Git status bar

##### Branch Button

- Clicking opens the branch quick switcher
- Label shows the current branch name; if empty, show the `no branch` copy

##### Tab Behavior

| Tab | Content |
| --- | --- |
| Files | File tree |
| Git | Git panel |

#### 4.4.8.2 Editor State

- Entry: select a file in the Files tab
- Main content: code editor / file preview
- Page-level back: use Sheet Header `Back` to return to root
- Header right-side actions:
  - Text-image files can switch `Image / Text`
  - Text files can be saved

#### 4.4.8.3 Diff State

- Entry: select a change in the Git tab
- Main content: Diff Viewer
- Page-level back: use Sheet Header `Back` to return to root
- Closing the whole Sheet: exit Files Sheet directly

### 4.4.9 Terminal Sheet

On mobile, Terminal opens as a full-screen Sheet and reuses the same terminal capability set internally.

#### 4.4.9.1 Toolbar Differences

Compared with desktop:

- Only show the current terminal selector when at least one terminal exists
- Use `MobileSelectSheet` for multi-terminal selection
- Do not show desktop-style tabs

#### 4.4.9.2 Mobile Soft Key Bar

A real soft key bar appears above mobile xterm and includes:

- `Ctrl`
- `Shift`
- `Esc`
- `Tab`
- `↑`
- `←`
- `↓`
- `→`
- `Enter`

Interaction rules:

| Key | Behavior |
| --- | --- |
| Ctrl tap | Toggle between `off` and `armed` |
| Ctrl long-press | Lock as `locked` |
| Shift tap | Enter `armed`; auto-consume after the next soft-key input |
| Arrow / Esc / Tab / Enter | Write the corresponding control sequence directly |

The soft key bar is disabled when:

- The current terminal is non-interactive
- File upload is in progress
- WebSocket is disconnected

### 4.4.10 Supervisor Sheet

Mobile Supervisor is split into two levels:

#### 4.4.10.1 Root Level

| Scenario | Page behavior |
| --- | --- |
| Current session already has Supervisor enabled | Show a status card and `Edit objective` / `Disable` buttons |
| Current session has Supervisor disabled | Show empty state and `Enable objective` button |

#### 4.4.10.2 Detail Level

Enable, edit, and disable all enter the detail level, which supports:

- Showing mode-specific title, subtitle, and icon
- Editing the objective
- Choosing the evaluator provider
- Fixed bottom `Cancel / Confirm` buttons

Choosing the evaluator provider opens another selection Sheet.

### 4.4.11 Workspace Drawer

#### 4.4.11.1 List Items

Each workspace row contains:

- Primary area: switch to that workspace and navigate to `/workspace`
- Close button: close that workspace

#### 4.4.11.2 Bottom Action

The drawer footer contains one fixed button:

- Open the workspace launcher

#### 4.4.11.3 Closing the Last Workspace

When the last workspace is closed from the mobile drawer, the flow explicitly requires `return home when empty`, so the app returns to the welcome page.

## 4.5 Settings Page `/settings`

### 4.5.1 Page Goal and Navigation Structure

The settings page manages:

- Notifications
- Provider launch args and config files
- Appearance
- Part of shortcut configuration

Desktop and mobile share the same capability set, but use different navigation structures:

| Form factor | Navigation structure |
| --- | --- |
| Desktop | Left-side section navigation + right-side content area |
| Mobile | Root list page + detail subpages |

Current visible section scope:

| Form factor | Visible sections |
| --- | --- |
| Desktop | General / Providers / Appearance / Shortcuts |
| Mobile | General / Providers / Appearance |

> **Note:**  
> Mobile currently has no `Shortcuts` entry.

### 4.5.2 Shared Rules

#### 4.5.2.1 Back Logic

| Scenario | Back behavior |
| --- | --- |
| Mobile detail page | Return to the mobile root list first |
| All other cases | Prefer browser history; otherwise go to `/workspace`; otherwise go to `/` |

#### 4.5.2.2 Loading Logic

After connection becomes available, the settings page loads settings data and syncs the following into page state:

- Notification master switch
- Notification sound switch
- Terminal renderer
- Language
- Provider additional args
- External config audit

If loading fails:

- An error notice appears at the top of the content area
- The user can click `Refresh` to refetch

#### 4.5.2.3 Shared Footer

The bottom of the settings page always shows:

- Autosave hint
- Version string `v0.2.6`

#### 4.5.2.4 In-Page Banner

The settings content area embeds the config drift banner at the top to handle Codex config drift.

### 4.5.3 General

General currently contains notification settings only.

#### 4.5.3.1 Toggle Items

| Setting | Interaction rules |
| --- | --- |
| Notifications Enabled | Toggle saves immediately |
| Notification Sound | Toggle saves immediately; disabled when Notifications Enabled is off |

The frontend also syncs both values into local notification preferences.

#### 4.5.3.2 Browser Capability Status

The page checks browser notification capability and shows one of three states:

- `available`
- `limited`
- `unsupported`

Mobile rule:

- If the device is mobile and not running as a standalone web app, capability is marked as `limited`

#### 4.5.3.3 Permission State

The page shows browser notification permission state:

- `granted`
- `denied`
- `default`
- `unavailable`

Among those:

- When state is `default` and capability is `available`, show `Request permission`
- When state is `denied`, `limited`, or `unavailable`, show the corresponding explanatory copy

### 4.5.4 Providers

Providers is the most complex section in Settings and is split into two layers:

1. Base launch-args layer
2. Config-file editing layer

#### 4.5.4.1 Provider Switching

The provider set is currently fixed to:

- Claude
- Codex

#### 4.5.4.2 Base Layer

Desktop has a second-level switch:

- Base
- Config File

Mobile enters `Base` first by default, then uses a dedicated entry to go into `Config File`.

The Base layer currently includes:

| Feature | Interaction rules |
| --- | --- |
| Additional Args textarea | One argument per line; changes autosave immediately |
| Command Preview | Refresh command preview in real time |

#### 4.5.4.3 Config File Layer

The actual behavior of the config-file editor is:

| Feature | Interaction rules |
| --- | --- |
| Load | Read real config-file content and absolute path on entry |
| File missing | Show empty state and guidance copy, but keep the card structure |
| Expand / collapse | Card is collapsible; expanded state persists to local storage |
| Editor | Uses Monaco |
| Status display | `saved / dirty / saving / error` |
| Save | Save to the real config file; if a backup path is created, notify through Toast |
| Reset | Restore the latest loaded / saved content |
| Format | Supported only for `claude` config; implemented as JSON pretty-print |

#### 4.5.4.4 Layout Differences

| Form factor | Behavior |
| --- | --- |
| Desktop | Provider tabs + Base / Config File second-level switch; Config File can fill the remaining height |
| Mobile | Base page shows `Open Config File Editor`; clicking enters the config-file sublayer with a back action to Base |

### 4.5.5 Appearance

Appearance currently contains three items:

- Theme
- Terminal Renderer
- Language

#### 4.5.5.1 Theme

| Feature | Interaction rules |
| --- | --- |
| Dark / Light switch | Switch frontend theme immediately on click |
| Local persistence | Theme choice writes to local storage |
| Server save | The page attempts to sync the setting to the server |

> **Current implementation boundary:**  
> Immediate theme switching is complete.  
> Server-side persistence still has limitations; see Chapter `8.2`.

#### 4.5.5.2 Terminal Renderer

Two renderer modes are supported:

- `standard`
- `compatibility`

Clicking saves immediately.

#### 4.5.5.3 Language

Supported languages:

- Chinese `zh`
- English `en`

Clicking switches the frontend language immediately and saves the config.

### 4.5.6 Shortcuts (Desktop Only)

The Shortcuts page currently provides a **shortcut configuration UI**, split into four groups:

- Global
- Workspace
- Editor
- Terminal

#### 4.5.6.1 Configuration Interaction

| Feature | Behavior |
| --- | --- |
| Click a shortcut binding | Enter capture mode |
| Capture input | Record `Mod / Shift / Alt + Key` |
| `Escape` | Cancel the current capture |
| Reset one item | Remove the custom binding for that item |
| Reset All | Clear all custom bindings |

All changes:

- Write into local shortcut config
- Sync-save to settings

#### 4.5.6.2 Current Capability Boundary

The real capability of this page should currently be defined as:

- View default bindings
- Enter / reset custom bindings
- Save configuration

It should **not** be defined as a `global shortcuts take effect immediately at runtime` system. The more precise runtime boundary is documented in Chapter `8.3`.

## 4.6 404 Page `*`

The 404 page reuses the visual shell of the welcome page and includes:

- Kicker
- Title
- Description
- A status panel showing the unmatched path
- A `Return Home` button

The interaction rule is simple:

- Clicking the button returns to `/`

## 5. Cross-Page Systems

## 5.1 Quick Actions (Command Palette)

Quick Actions is currently wired on both desktop and mobile.

### 5.1.1 Open Entry

The **only globally wired hotkey currently confirmed in code** is:

- `Ctrl/Cmd + K`: open / close Quick Actions

### 5.1.2 Presentation Shape

| Form factor | Shape |
| --- | --- |
| Desktop | Centered overlay modal |
| Mobile | Full-screen Sheet |

### 5.1.3 Shared Behavior After Opening

- Autofocus the search input
- Clear the previous search term
- Reset the selection index to the first item

### 5.1.4 Keyboard Interaction

| Key | Behavior |
| --- | --- |
| `ArrowDown` | Move selection down |
| `ArrowUp` | Move selection up |
| `Enter` | Execute the selected command and close the panel |
| `Escape` | Close the panel |

### 5.1.5 Current Command Set

#### Shared Across Desktop and Mobile

- Open the workspace launcher
- Return to the home page
- Open the settings page
- Switch to any already-open workspace
- When an active workspace exists, also provide `Return home and clear active workspace`

#### Desktop Only

- Toggle Focus Mode
- Explicitly enter Focus Mode
- Explicitly exit Focus Mode
- Toggle left sidebar visibility
- Toggle terminal visibility
- Explicitly open terminal
- Explicitly close terminal

### 5.1.6 Boundary Between Display Copy and Real Listeners

The command list may currently display shortcut labels such as:

- `Ctrl+N`
- `Ctrl+,`
- `F`

These are currently **display copy only** and do not mean the corresponding global shortcuts are actually wired.

## 5.2 Workspace Launcher

The welcome page, desktop top bar, and mobile drawer all use the same workspace launcher.

### 5.2.1 Open Shape

| Form factor | Shape |
| --- | --- |
| Desktop | Modal |
| Mobile | Full-screen Sheet |

### 5.2.2 Directory Browsing

| Feature | Behavior |
| --- | --- |
| Home button | Jump to `~` |
| Go Up button | Jump to parent directory; hidden at root `/` |
| Preset root chips | Currently fixed to `/`, `~`, and `/home/spencer` |
| Current path chip | If the current path is not in preset chips, append one extra current-path chip |
| Single-click directory row | Select directory |
| Double-click directory row | Enter directory |
| Inline action after selection | Show `Enter directory` action button |

### 5.2.3 Start Rules

- `Start` is disabled when no directory is selected
- Clicking `Start` opens that directory as a workspace
- After success:
  - Add the workspace into the local list
  - Update workspace order
  - Set it as the active workspace
  - If not currently on `/workspace`, auto-navigate to `/workspace`
  - Close the launcher

### 5.2.4 Quick Close

The desktop launcher listens for:

- `Escape`: close the modal

## 5.3 Branch Quick Switcher

### 5.3.1 Trigger Entry

- Desktop left sidebar branch button
- Mobile Files Sheet branch button

### 5.3.2 Presentation Shape

| Form factor | Shape |
| --- | --- |
| Desktop | Overlay popover |
| Mobile | Selection Sheet |

### 5.3.3 Search and Switch

| Feature | Behavior |
| --- | --- |
| Search input | Filter branch list by name |
| Current branch | Shows a checkmark |
| Remote branch | Shows `Remote` badge |
| Select existing branch | Switch to that branch directly |

### 5.3.4 Create New Branch

The current implementation is not `one click creates immediately`. It uses a **two-step confirmation**:

1. When the user types a branch name that does not exist, the list shows `Create xxx`
2. After selecting it once, the entry becomes `Confirm create xxx`
3. Only after selecting again is the branch actually created and checked out

### 5.3.5 Keyboard Interaction

| Key | Behavior |
| --- | --- |
| `ArrowDown / ArrowUp` | Move selection |
| `Enter` | Select branch / initiate create / confirm create |
| `Escape` | Close |

## 5.4 Config Drift Banner

Config Drift Banner warns about config items in `~/.codex/config.toml` that interfere with current app behavior.

### 5.4.1 Data Source

The data comes from `externalConfigAudit` in the settings payload.

### 5.4.2 Display Positions

| Scenario | Position |
| --- | --- |
| Desktop shell, excluding auth and settings pages | Global top banner |
| Mobile workspace page | Compact in-page banner |
| Settings page | Embedded banner at the top of the content area |

### 5.4.3 Interaction Capabilities

| Feature | Behavior |
| --- | --- |
| Expand details | View each finding, line number, and snippet |
| Check cleanup items | All findings are selected by default |
| Cleanup | Execute config cleanup |
| Cleanup success | If a backup path is produced, show it in banner notice |
| Dismiss | Close the current banner in frontend state only; not a permanent ignore |
| Load failure | Show failure banner and allow `Refresh` retry |

The compact banner on the mobile workspace page does not expand details inline; it routes the user to `/settings`.

## 5.5 Connection Status Banner

The global connection banner handles these states in a unified way:

- `reconnecting`: show `Reconnecting...`
- `rejected`: show `Another tab is active`
- Any other disconnected state: show `Connection lost`

## 5.6 Toasts and Notifications

### 5.6.1 Toast Container

The Toast container supports:

- Keeping at most the latest `5` toasts at once
- Four types: `success / error / warning / info`
- Auto-dismiss, default `5s`; `duration = 0` switches to manual close

### 5.6.2 Toast Click Behavior

| Attached toast data | Click result |
| --- | --- |
| `workspaceId + sessionId` | Jump to that workspace and focus / scroll into view / pulse-highlight the session |
| `workspaceId` only | Switch to that workspace and navigate to `/workspace` if needed |
| No navigation data | Only close the toast |

### 5.6.3 Session Completion Notifications

Notifications currently fire only when **an agent finishes one round of work**, with explicit rules:

- Primary trigger: `running -> idle`
- Fallback trigger: `running -> ended`

And additionally:

- Rounds shorter than `4s` do not notify
- When the page is visible:
  - If desktop is already on the workspace that owns the session
  - Or mobile is already showing that session
  - Then suppress the notification
- When the page is visible but the user is not on that workspace / session:
  - Send in-app toast
- When the page is hidden:
  - Send browser system notification

If sound is enabled:

- Prefer playing `/task-complete.wav`
- Fall back to a Web Audio synthesized sound if playback fails

## 5.7 Supervisor Editing Container

Supervisor editing interactions are carried by two containers:

| Form factor | Container |
| --- | --- |
| Desktop | Modal dialog |
| Mobile | Full-screen Sheet + optional selection Sheet |

Supported modes:

- `enable`
- `edit`
- `disable`

Editable fields:

- Objective text
- Evaluator Provider

## 6. Confirmed Shortcuts and Input Baseline

This chapter lists **only interactions that are currently confirmed as wired**. It does not repeat historical PRD items that were planned but do not have unified runtime listeners today.

### 6.1 Global Level

| Interaction | Status |
| --- | --- |
| `Ctrl/Cmd + K` | Wired: open / close Quick Actions |

### 6.2 Inside Overlays

| Overlay | Wired interaction |
| --- | --- |
| Quick Actions | `ArrowUp / ArrowDown / Enter / Escape` |
| Branch quick switcher | `ArrowUp / ArrowDown / Enter / Escape` |
| Workspace launcher (desktop) | `Escape` closes |

### 6.3 Inside the Editor

| Interaction | Status |
| --- | --- |
| Monaco `Ctrl/Cmd + S` | Wired: save the current text file |

### 6.4 Mobile Terminal

Wired soft keys:

- Ctrl / Shift
- Esc / Tab / Enter
- Arrow Up / Left / Down / Right

### 6.5 Items That Must Not Be Documented as Shipped Shortcuts

The following items **must not be written as shipped global shortcuts** in the current product description:

- `Ctrl/Cmd + N`
- `Ctrl/Cmd + ,`
- `F`
- Any pane split shortcut
- Any custom binding entered on the Settings page

At most, these currently exist as:

- Shortcut labels shown inside command lists
- Or code that exists in unmounted components / code paths without unified runtime consumption

## 7. System Boundaries and Error Handling

## 7.1 File / Git Change Propagation

The server pushes file-change and Git-dirty events. The frontend reacts by:

- Refreshing Git status
- Refreshing the branch list
- Marking the file tree stale and reloading on demand
- Refreshing already-open editor buffers

## 7.2 Auth Boundary

The frontend currently has no explicit `logout` entry, even though the backend has a corresponding endpoint.

The main login-related failure cases are:

- Wrong password
- Login endpoint unavailable
- Temporary lockout after too many failed attempts

## 7.3 Upload Boundary

Paste / drag-upload into terminals currently has these boundaries:

- Requests must include `workspaceId`
- The current batch must contain at least one file
- Missing workspace returns `workspace_not_found`
- Oversized files, parse failures, and write failures return dedicated errors
- Frontend reports failure through error Toast

## 7.4 Image Preview Boundary

`/api/file` currently serves image preview only:

- Non-image types return `not_an_image`
- Path escape returns `path_escape`
- It is not a general-purpose file download endpoint

## 8. Implementation Appendix and Excluded Scope

This chapter covers only two kinds of content:

1. Implementation facts that should be preserved but do not belong in the main page descriptions
2. Items that exist in the repo but must not currently be described as shipped capability

### 8.1 Auth Route Implementation Note

The main product review chapters consistently describe the login page as `/auth`, because that is the actual mounted frontend login page.

But one implementation fact still needs to be preserved:

- Server-side SPA navigation for unauthenticated users redirects to `/login`
- Frontend bootstrap actively navigates users to `/auth` when auth fails

So the product document uses `/auth` in the main body, while preserving `/login` here as an implementation fact on the server side.

### 8.2 Theme Persistence Boundary

The current frontend UI genuinely supports immediate dark / light switching.  
But the server settings schema fully accepts only the `appearance.theme = "dark"` path.

Therefore:

- Theme **taking effect immediately** is true
- Theme **full and symmetrical persistence across frontend and backend** is currently incomplete

The PRD should not describe it as a fully consistent cross-layer theme persistence system.

### 8.3 Items That Must Not Be Counted as Shipped Capability

The following items can be found in the repo as components, tests, or implementation fragments, but **must not be described as currently reachable user-facing functionality**:

#### 8.3.1 `WorktreeModal`

- The component exists
- But there is no reachable mounted entry in actual pages today

#### 8.3.2 Standalone `FocusMode` Component

- The component exists
- It defines internal logic for `F`, `Escape`, and related behavior
- But it is not currently mounted by the shell or workspace page

The only truly user-visible focus mode entry currently confirmed is **toggling focus mode state from Quick Actions**.

#### 8.3.3 Runtime Shortcut Replacement

- The Shortcuts settings page exists
- Custom bindings can already be saved
- But runtime global hotkeys are not uniformly driven by those saved bindings

Therefore, the PRD must not claim that `custom shortcuts take effect globally and immediately at runtime`.

## 9. Maintenance Principles

When this PRD is maintained in future updates, follow three rules:

1. **Write the main body by page and user flow, not by piling up technical modules.**
2. **Write real reachable interactions first, then states, errors, and boundaries.**
3. **A component existing is not the same as a feature being shipped; if it is not mounted or not uniformly listened to, do not document it as current product capability.**

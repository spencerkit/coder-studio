# Product Requirements Document: Coder Studio

> **Version:** 0.2.6  
> **Document Date:** April 13, 2026  
> **Product Type:** Local-first AI Coding Workbench

---

## Table of Contents

1. [Product Overview](#1-product-overview)
2. [Target Users](#2-target-users)
3. [Core Value Proposition](#3-core-value-proposition)
4. [Information Architecture](#4-information-architecture)
5. [Global UI Framework](#5-global-ui-framework)
6. [Authentication System](#6-authentication-system)
7. [Workspace Management](#7-workspace-management)
8. [Agent Session Management](#8-agent-session-management)
9. [Code Editor & File Browsing](#9-code-editor--file-browsing)
10. [Git Integration](#10-git-integration)
11. [Terminal System](#11-terminal-system)
12. [Command Palette](#12-command-palette)
13. [Settings](#13-settings)
14. [Focus Mode](#14-focus-mode)
15. [Notification System](#15-notification-system)
16. [Supervisor System](#16-supervisor-system)
17. [Internationalization](#17-internationalization)
18. [Design System](#18-design-system)
19. [Interaction Patterns](#19-interaction-patterns)
20. [Edge Cases & Error States](#20-edge-cases--error-states)

---

## 1. Product Overview

### 1.1 Product Definition

Coder Studio is a local-first AI coding workbench that integrates AI-powered code generation agents, code editing, version control, and terminal access into a unified developer interface. It enables developers to orchestrate AI coding agents (Claude, Codex) alongside traditional development tools within a single workspace.

### 1.2 Product Vision

Provide developers with a centralized workbench where AI agents and human developers can collaborate on code in real time, with full visibility into agent activity, file changes, and terminal output.

### 1.3 Key Characteristics

- **Local-first:** Runs on the user's machine; all code, terminals, and agent processes execute locally.
- **Multi-agent capable:** Supports running multiple AI coding agent sessions in parallel within a single workspace.
- **Full-stack development environment:** Combines code editing, Git operations, terminal access, and agent orchestration in one interface.
- **Distraction-free:** Offers a focus mode that hides non-essential UI elements for concentrated work.

---

## 2. Target Users

### 2.1 Primary User

**Professional Software Developers** who use AI coding assistants (Claude Code, Codex) as part of their daily workflow and need a dedicated environment to manage multiple agent sessions alongside their code, terminals, and version control.

### 2.2 Secondary Users

- **Technical Leads** reviewing AI-generated code and agent progress.
- **DevOps Engineers** managing local development environments with AI assistance.

---

## 3. Core Value Proposition

| Need | Solution |
|------|----------|
| Manage multiple AI agent sessions simultaneously | Multi-pane agent workspace with parallel session support |
| See what agents are doing in real time | Embedded per-agent terminals with live output streaming |
| Review and edit agent-generated code | Integrated code editor with file browsing and diff viewing |
| Track and commit agent changes | Git integration with staging, diff review, and in-place commits |
| Run commands alongside agent work | Multi-tab terminal panel with agent-specific and shell terminals |
| Stay focused during long agent runs | Focus mode, completion notifications, and supervisor objective tracking |

---

## 4. Information Architecture

```
Coder Studio
├── Authentication Screen (if enabled)
├── App Level
│   ├── Top Bar (global, always visible when workspaces exist)
│   └── Content Area
│       ├── Welcome Screen (no workspaces open)
│       ├── Workspace Screen (active workspace)
│       │   ├── Left Panel: Code Sidebar (Files / Git Diff)
│       │   ├── Center Panel: Agent Workspace
│       │   └── Bottom Panel: Terminal
│       └── Settings Screen
└── Overlays
    ├── Command Palette
    ├── Workspace Launch Overlay
    ├── Runtime Validation Overlay
    ├── Confirm Dialogs
    ├── Worktree Modal
    └── Supervisor Objective Dialog
```

### 4.1 Routing Structure

| Route | Description |
|-------|-------------|
| `/` | Welcome screen for launching or reopening a workspace |
| `/workspace` | Main workspace screen; the active workspace is resolved by frontend state |
| `/settings` | Settings page |

---

## 5. Global UI Framework

### 5.1 Top Bar

The top bar is a persistent horizontal strip (36px height) at the top of the application, visible whenever at least one workspace is open.

#### 5.1.1 Layout

The top bar is divided into two sections:

- **Left Section:** Workspace/Session tabs
- **Right Section:** Action buttons

#### 5.1.2 Workspace/Session Tabs

Each open workspace is represented as a tab with the following elements (left to right):

1. **Status Indicator Dot:**
   - When the workspace is actively running: A colored dot with a continuous pulse animation (opacity oscillates between 1.0 and 0.5 every 2 seconds).
   - When idle: A static colored dot with no animation.
   - Color mapping: Active = green (`#78d7b2`), Idle = gray-blue.

2. **Label:** Text label displaying the workspace name. Truncated with ellipsis if too long.

3. **Unread Badge (conditional):** Displays a numeric count of unread messages for the workspace. Shows a number (max displayed as "9+") on a small rounded badge (minimum 16px wide, 16px tall) with accent blue background. Hidden when count is zero.

4. **Close Button (X):** Hidden by default, appears on hover over the tab. Clicking closes the workspace tab.

5. **Add Button (+):** A 28×28px button with a plus icon. Opens a new workspace tab.

#### 5.1.3 Tab Interactions

- **Switch Tab:** Click on any tab to switch to that workspace.
- **Close Tab:** Hover over a tab to reveal the X button, then click to close.
- **New Tab:** Click the + button to open a new workspace (launches the Workspace Launch Overlay).

#### 5.1.4 Right-Side Action Buttons

Two 32×32px buttons with rounded corners (6px radius):

1. **Quick Actions Button:** Displays a search icon and the text "Quick Actions". Opens the Command Palette. On wider screens, the text label is visible; on narrower screens, only the icon is shown.

2. **Settings Button:** Displays a gear icon. Navigates to the Settings page. Shows a data attribute `data-testid="settings-open"` for testing purposes.

Both buttons share the same hover state: background shifts to a slightly lighter tint.

#### 5.1.5 Empty State

When no workspaces are open, the top bar displays a centered empty state with a small kicker text and a label prompting the user to open a workspace.

#### 5.1.6 Settings Route Appearance

When on the Settings page, the top bar changes to show:
- **Left:** A back button with a back arrow icon and the text "Back to App".
- **Center:** The title "Settings".

### 5.2 Keyboard Shortcuts (Global)

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + K` | Toggle Command Palette |
| `Escape` (with Command Palette open) | Close Command Palette |
| `Ctrl/Cmd + S` | Save the currently open file in the code editor |
| `Ctrl/Cmd + N` | Open a new workspace tab |
| `Ctrl/Cmd + Shift + [` | Switch to the previous workspace tab |
| `Ctrl/Cmd + Shift + ]` | Switch to the next workspace tab |
| `F` (no modifier, not focused on a text input) | Toggle Focus Mode |
| `Escape` (while in Focus Mode) | Exit Focus Mode |
| `Cmd + D` (Mac) or `Alt + D` (Windows/Linux) | Split the active agent pane vertically |
| `Cmd + Shift + D` (Mac) or `Alt + Shift + D` (Windows/Linux) | Split the active agent pane horizontally |

**Note:** Keyboard shortcuts are context-aware. The `F` key only toggles focus mode when the user is not actively typing in a text input field. The save shortcut (`Ctrl/Cmd + S`) only functions when the code editor panel is visible and a file is open.

### 5.3 Color Palette (Dark Theme — "Aurora Mint")

| Token | Value | Usage |
|-------|-------|-------|
| Background | `#0a1014` | Main app background |
| Surface | `#11181f` | Panels, cards, elevated surfaces |
| Border | `#1e2a35` | Divider lines and borders |
| Text Primary | `#e5edf3` | Headings, labels, body text |
| Text Secondary | `#9fb0bc` | Secondary labels, descriptions |
| Text Tertiary | `#728492` | Kicker text, timestamps, muted labels |
| Accent (Blue) | `#6cb6ff` | Links, active states, highlights |
| Accent-2 (Green) | `#78d7b2` | Success indicators, running status |
| Accent-3 (Amber) | `#f1b86a` | Warnings, modified status |
| Danger (Pink) | `#ff9eb0` | Errors, destructive actions, deleted status |

### 5.4 Typography

| Level | Size | Weight | Usage |
|-------|------|--------|-------|
| Kicker | 10px | Uppercase, letter-spacing 0.08em | Section labels, badges |
| XS | 11px | Regular/medium | Agent pane titles, file paths |
| SM | 12px | Regular | Button text, small labels |
| MD | 13px | Regular | Body text, editor content, terminal text |
| LG | 14px | Regular | Headings, form labels |
| 3XL | 18px | Medium | Welcome screen title |

- **UI Font:** IBM Plex Sans
- **Monospace Font:** JetBrains Mono (used in code editor, terminal, and code blocks)

### 5.5 Iconography

All icons are sourced from the Lucide icon library, rendered at 16px default size with 1.5px stroke weight. Key icons used throughout the product:

| Icon | Name | Usage |
|------|------|-------|
| `Plus` | HeaderAddIcon | New workspace, new terminal |
| `X` | HeaderCloseIcon | Close tabs, close panes, close modals |
| `Search` | SearchIcon | Command palette, file search |
| `Settings` | HeaderSettingsIcon | Settings button/link |
| `ArrowLeft` | HeaderBackIcon | Back navigation |
| `ChevronRight` / `ChevronDown` | Expand/Collapse | File tree, accordions |
| `RefreshCw` | RefreshIcon | Refresh file tree, refresh git, retry validation |
| `Plus` (in git context) | GitStageIcon | Stage changes |
| `Minus` | GitUnstageIcon | Unstage changes |
| `Undo2` | GitDiscardIcon | Discard changes |
| `ArrowUp` | AgentSendIcon | Commit, trigger supervisor |
| `Square` | Stop/Disable | Disable supervisor |
| `CirclePause` / `Play` | Pause/Resume | Supervisor pause/resume |
| `MessageSquare` | Edit objective | Edit supervisor objective |
| `BadgeCheck` | Supervisor badge | Supervisor section |
| `Folder` | WorkspaceFolderIcon | Folder browser, file tree |
| `GitBranch` | WorkspaceBranchIcon | Branch display |
| `SplitHorizontal` / `SplitVertical` | Pane split icons | Split agent panes |

### 5.6 Animation & Transition Standards

| Property | Value | Usage |
|----------|-------|-------|
| Fast duration | 60ms | Micro-interactions, button states |
| Normal duration | 100ms | Standard transitions |
| Slow duration | 150ms | Panel resizers, larger movements |
| Ease-out-expo | `cubic-bezier(0.16, 1, 0.3, 1)` | Modal appearances |
| Ease-out-quart | `cubic-bezier(0.25, 1, 0.5, 1)` | General UI transitions |

**Keyframe Animations:**

- **Pulse:** Continuous opacity oscillation (1.0 → 0.5 → 1.0) over 2 seconds. Used for running status indicators.
- **Fade In:** Opacity 0 → 1. Used for modal overlays.
- **Scale In:** Scale 0.95 → 1.0 with opacity 0 → 1. Used for modal cards.
- **Slide In:** Translate X from 100% → 0 with opacity. Used for toast notifications.
- **Spin:** 360-degree rotation over 0.8 seconds, linear, infinite. Used for loading spinners and checking indicators.
- **Shimmer:** Background position shift over 1.5 seconds. Used for skeleton loaders.
- **Fade In Up:** Translate Y from 10px → 0 with opacity. Used for list items appearing.
- **Slide In Right:** Translate X from 20px → 0 with opacity. Used for panel content.

**Performance Rule:** During panel resizing operations, all transitions and animations are temporarily disabled on panel content to maintain smooth resizing.

---

## 6. Authentication System

### 6.1 Purpose

For deployments exposed on a network (remote servers, shared machines), the authentication system provides single-passphrase access control to prevent unauthorized access to the workbench and its underlying filesystem.

### 6.2 Authentication Flow

#### 6.2.1 States

The authentication screen cycles through the following states:

1. **Loading:** A spinner is displayed while the auth status is being determined.
2. **Not Configured:** If authentication is not set up on the server, the user is informed that the app is running without authentication.
3. **Sign In:** The standard login screen with a passphrase input field.
4. **Blocked:** Displayed when the user's IP has been locked due to repeated failed attempts.
5. **Unavailable:** Displayed when the authentication service cannot be reached.
6. **Unlocking:** Transition state during successful authentication.

#### 6.2.2 Sign In Screen

The sign-in screen contains:

- **Product Branding:** Product name and version displayed at the top.
- **Passphrase Input:** A text input field with a placeholder prompting for the passphrase.
- **Submit Button:** A primary action button labeled "Sign In".
- **Error Message (conditional):** Displayed below the input field when credentials are invalid, styled in the danger color.
- **Security Information Card** (below the login form):
  - **Session Policy:** Displays the session idle timeout duration and maximum session lifetime.
  - **Allowed Roots:** Lists the directory paths that the authenticated session is permitted to access.

#### 6.2.3 Preview Shell

While on the authentication screen, a wireframe preview of the workspace UI is displayed behind the login card. This preview consists of placeholder bars and blocks simulating the top bar, left sidebar, main content area, and right panel, giving the user a visual hint of the interface they will access upon authentication.

### 6.3 Security Policies

| Policy | Detail |
|--------|--------|
| Failed Attempt Lockout | 3 failed login attempts within a 10-minute window result in a 24-hour IP ban |
| Session Cookies | HttpOnly cookies-based sessions to prevent XSS-based token theft |
| Session Idle Timeout | Sessions are terminated after a configurable period of inactivity |
| Maximum Session Duration | Sessions have a hard lifetime limit after which they expire regardless of activity |

### 6.4 Error Codes

| Error Code | User-Facing Message |
|------------|-------------------|
| `invalid_credentials` | "Incorrect passphrase" |
| `session_expired` | "Your session has expired. Please sign in again." |
| `session_missing` | "No active session. Please sign in." |
| `ip_blocked` | "Your IP has been blocked due to too many failed attempts." |
| `auth_unavailable` | "Authentication service is currently unavailable." |
| `auth_not_configured` | "Authentication is not configured on this deployment." |

---

## 7. Workspace Management

### 7.1 Overview

A workspace represents a single project directory being actively developed. Each workspace contains its own set of agent sessions, file browser, git status, and terminals. Multiple workspaces can be open simultaneously as separate tabs in the top bar.

### 7.2 Workspace Launch

#### 7.2.1 Trigger

Clicking the "+" button in the top bar or the "Open Workspace" button on the Welcome Screen opens the Workspace Launch Overlay.

#### 7.2.2 Workspace Launch Overlay

A modal dialog (maximum width 760px) with the following sections:

**Header Area (two-column layout):**
- **Left Column:**
  - Kicker text: "START WORKSPACE"
  - Title: "Local Folder"
  - Hint text explaining the selection
- **Right Column:**
  - Currently selected path display
  - Execution target indicator (Native / WSL)
  - Close button (X)

**Choice Cards:**
- **Local Folder (always active):** The primary option for creating a workspace from a local directory.
- **Remote Git (deferred):** A visually disabled/inactive option indicating this feature is planned but not currently available.

**Execution Target Selection:**
- **Native:** Default option. Runs agents directly on the host operating system.
- **WSL (Windows Subsystem for Linux):** Alternative option available on Windows. Selecting WSL reveals an additional text input field for specifying the WSL distribution name (optional; defaults to the system's default distribution).

**Folder Browser:**
A file picker interface with:

1. **Toolbar:**
   - **Home Directory Button:** Navigates to the user's home directory.
   - **Go Up Button:** Navigates to the parent directory.

2. **Root Path Chips:** Quick-access buttons for common root directories (e.g., root `/`, common project directories). Clicking a chip navigates directly to that path.

3. **Directory Listing:**
   - Each row displays a folder icon, the directory name, and a brief hint (e.g., modification time or item count).
   - An "Enter folder" action (arrow icon) appears on hover.
   - Clicking a directory row navigates into that directory.
   - Clicking a directory name (not the action) selects it as the workspace root.

**Selected Path Display:**
- Shows the currently selected directory path as a breadcrumb-style text.
- Updates in real time as the user navigates the folder browser.

**Action Button:**
- **Start Workspace:** A primary button at the bottom of the overlay. Disabled until a valid directory path is selected. Clicking this button creates and opens a new workspace tab.

#### 7.2.3 Runtime Validation

Upon selecting a directory and execution target, the system performs a runtime validation check (see Section 7.3). The workspace will not launch if required commands are not available on the selected target.

### 7.3 Runtime Validation Overlay

A modal dialog that appears automatically when launching a workspace to verify that all required system commands are available on the selected execution target.

#### 7.3.1 Layout

- **Header:**
  - Kicker text: "RUNTIME CHECK"
  - Title: Contextual message (e.g., "Checking available commands")
  - Description: Explains what is being checked
  - Close button (X)

- **Target Selection (conditional):** If WSL distributions are available, the user can choose between "Native" and "WSL" via choice cards. Selecting WSL reveals a text input for the distribution name.

- **Required Runtime Summary Card:** A card listing all commands required by the current configuration.

- **Requirements List:** Each required command is listed with:
  - **Status Dot:** Green if available, red if missing, blue with a pulse animation if currently being checked.
  - **Command Label:** The command name (e.g., `git`, `node`).
  - **Detail Text:** Additional information (e.g., "found at /usr/bin/git" or "not found").

- **Install Hint (conditional):** When requirements are not met, a message suggests how to install missing commands.

- **Action Button:**
  - **Retry:** Enabled only when the validation status is "failed". Clicking re-runs the check.

- **Dismissal:** The overlay can be closed with the Escape key or the X button.

#### 7.3.2 Validation States

| State | Description |
|-------|-------------|
| Idle | Validation has not been triggered |
| Checking | Validation is in progress (blue pulse indicators) |
| Ready | All required commands are available (green indicators) |
| Failed | One or more required commands are missing (red indicators) |

### 7.4 Welcome Screen

Displayed when no workspace tabs are open.

#### 7.4.1 Layout

- **Centered Panel:**
  - Kicker text at the top
  - H1 title (e.g., "Coder Studio")
  - Body paragraph describing the product
  - **Primary Action Button:** Labeled "Open Workspace" with a plus icon. Clicking opens the Workspace Launch Overlay.
  - **Settings Link:** A text link with a gear icon labeled "Open Settings". Clicking navigates to the Settings page.

### 7.5 Workspace Lifecycle

| Action | Behavior |
|--------|----------|
| Open | Creates a new tab, initializes agent panes, file tree, and terminal |
| Switch | Preserves all state (agent sessions, terminal output, editor state); the workspace remains running in the background |
| Close | Terminates all agent sessions, closes terminals, and removes the tab |
| Recovery | If the application reloads while a workspace was active, the workspace attempts to recover its previous state |

### 7.6 Multi-Tab Concurrency Control

When the application is open in multiple browser tabs, a controller/observer model manages which tab has primary control of a workspace:

- One tab acts as the **Controller** and holds a fencing token.
- Other tabs are **Observers** that receive updates but cannot directly modify workspace state.
- The Controller sends periodic heartbeats (every 10 seconds when visible, every 20 seconds when the tab is hidden).
- If the Controller becomes unresponsive, an Observer can request a takeover with a deadline-based handoff protocol.
- Controllers are automatically released when a tab is closed or navigated away.

---

## 8. Agent Session Management

### 8.1 Overview

Agent sessions are the core interactive units of the workspace. Each session runs an AI coding agent (Claude or Codex) in its own process with a dedicated terminal for input/output. Multiple agent sessions can run in parallel within a single workspace, arranged in a split-pane layout.

### 8.2 Agent Pane States

Each agent pane can be in one of the following states:

| State | Visual Representation |
|-------|----------------------|
| **Draft** | A launcher card with provider selection buttons (Claude, Codex). Not yet started. |
| **Running** | Active terminal with streaming output. Status dot pulses green. Progress bar animates. |
| **Idle** | Terminal visible but not actively producing output. Status dot is static. |
| **Interrupted** | Session was manually interrupted. Status indicator reflects interrupted state. |
| **Unavailable** | Error state. Displays an error message, reason, and a "Remove" button. |

### 8.3 Agent Pane Layout

#### 8.3.1 Pane Card Structure

Each agent session is displayed within a card (`.agent-pane-card`) with the following vertical structure:

1. **Progress Bar:** A thin bar (3px height) at the very top of the card.
   - Accent blue for "live" or "loading" states.
   - Danger pink for "error" state.
   - Width is dynamic: minimum 14%, 34% when actively running, 6% otherwise.

2. **Pane Header:** A compact header containing:
   - **Session Dot:** Small colored dot indicating status (green = active, gray = idle, blue = queued, muted = off).
   - **Title:** Uppercase, 11px, monospace font, letter-spacing 0.5px. Displays the session identifier.
   - **Provider Badge:** A small tag showing the agent provider name (e.g., "Claude", "Codex").
   - **Status Tag:** A small tag showing the current session status (e.g., "Running", "Idle", "Queued").
   - **Action Buttons** (right-aligned, visible on hover):
     - Split Vertical icon
     - Split Horizontal icon
     - Close (X) icon — turns red on hover

3. **Terminal Area:** An embedded terminal (xterm.js) filling the remainder of the card. Supports both interactive mode (user can type commands) and readonly mode (output only).

#### 8.3.2 Split Pane Layout

- **Vertical Split:** Divides the center panel into left and right panes. Triggered by the vertical split button or `Cmd/Ctrl + D`.
- **Horizontal Split:** Divides the center panel into top and bottom panes. Triggered by the horizontal split button or `Cmd/Ctrl + Shift + D`.
- **Resizing:** Split dividers are 8px wide and draggable. Dragging adjusts the proportional size of adjacent panes.
- **Nested Splits:** Panes can be split recursively, allowing complex multi-pane layouts within a single workspace.

### 8.4 Draft Session Launch

When a new pane is created (via the "+" action or splitting), it starts as a **Draft** pane:

- Displays a launcher card (`.agent-draft-launcher`) with buttons for each available provider.
- Each provider button shows the provider's badge label and display name.
- Clicking a provider button starts a new agent session with that provider.
- The draft pane is replaced by the active session pane once the provider is selected.

### 8.5 Session Tracking

Each active session tracks the following metadata:

| Attribute | Description |
|-----------|-------------|
| Status | Current lifecycle state (idle, running, interrupted) |
| Mode | Operating mode (branch or git_tree) |
| Resume ID | Identifier for resuming a previous session |
| Last Active Time | Timestamp of the most recent activity |
| Completion Ratio | Progress toward completion, displayed as a progress bar |

### 8.6 Session Lifecycle Events

Sessions emit the following lifecycle events:

| Event | Trigger |
|-------|---------|
| `session_started` | When a new agent process is launched |
| `turn_completed` | When the agent completes a coding turn/request |

### 8.7 Session Recovery

- **Archive:** Past sessions are recorded and can be viewed in an archive history.
- **Resume:** Previous sessions can be resumed using their resume ID, restoring context.
- **Remove:** Unavailable or errored sessions can be removed from the workspace.

### 8.8 Idle Policy

Each workspace maintains a per-workspace idle policy:

| Setting | Description |
|---------|-------------|
| Enabled | Whether the idle policy is active |
| Idle Minutes | Number of minutes of inactivity before marking the workspace as idle |
| Max Active Sessions | Maximum number of sessions allowed before entering pressure mode |
| Pressure Mode | Behavior when too many sessions are active simultaneously |

Sessions are marked as idle after the configured idle time. Completion reminders can be triggered when idle sessions complete their work.

---

## 9. Code Editor & File Browsing

### 9.1 Left Panel (Code Sidebar)

The left panel is a resizable sidebar (default width 280px, minimum 200px, maximum 400px) with a dark surface background (`#0d141a`) and a right border. It contains two toggleable views: **Files** and **Git Diff**.

### 9.2 View Toggle

At the top of the sidebar, a tab bar allows switching between views:

- **Files Tab:** Displays the repository file tree.
- **Git Diff Tab:** Displays the Git changes panel.

Both tabs are 24px tall with 4px border radius. The active tab is visually highlighted.

### 9.3 File Tree View

#### 9.3.1 Header

- **Section Label:** "REPOSITORY NAVIGATOR" in uppercase, 10px, with wide letter-spacing.
- **Branch Chip:** Displays the current Git branch name or root path with a folder or branch icon.

#### 9.3.2 Toolbar

A single refresh button that re-scans the workspace directory and updates the file tree.

#### 9.3.3 Tree Structure

- **Folders:** Displayed with a folder icon and a chevron indicating expand/collapse state (right-pointing = collapsed, down-pointing = expanded).
- **Files:** Displayed with a file-type-colored icon and the file name.
- **Selection:** The currently selected file has a left border accent in the accent color.
- **Collapsed State:** The expanded/collapsed state of directories is persisted per workspace.

#### 9.3.4 Interactions

- **Click Folder:** Expands or collapses the folder to show/hide its contents.
- **Click File:** Opens the file in the code editor panel (center-left area).
- **Expand/Collapse:** Clicking the chevron toggles folder visibility without selecting.

### 9.4 File Search

#### 9.4.1 Search Field

Located at the top of the code editor panel header:

- **Search Icon:** Left side of the input.
- **Input Field:** Maximum width 360px. Placeholder text: "Search files..."
- **Functionality:** Filters the workspace file tree in real time as the user types.

#### 9.4.2 Search Results Dropdown

- Appears below the search field as a floating dropdown (`.workspace-search-dropdown.floating`).
- Lists matching files with their name and parent path.
- The currently focused result is highlighted.
- **Keyboard Navigation:** Arrow Up/Arrow Down to move focus, Enter to select, Escape to close.

### 9.5 Code Editor Panel

#### 9.5.1 Layout

The code editor occupies the left portion of the center area, adjacent to the agent panes.

**Header:**
- **File Path Display:** Shows the path of the currently open file (11px, monospace, maximum 56 characters). Truncated with ellipsis if longer.
- **Search Field:** The file search input described above.

**Body:**
- **Expanded State:** Shows the Monaco code editor on the right and a file information sidebar on the left.
- **Collapsed State:** Shows only the sidebar content without the editor.

#### 9.5.2 Editor Modes

- **Preview Mode:** Standard code viewing with syntax highlighting and line numbers.
- **Diff Mode:** Monaco diff editor showing a side-by-side comparison of original vs. modified content.

The user can toggle between Preview and Diff modes via a toggle button in the editor toolbar.

#### 9.5.3 Editor Interactions

- **Syntax Highlighting:** Automatic language detection based on file extension.
- **Save:** `Ctrl/Cmd + S` saves the current file.
- **Font Size:** 13px in the editor.
- **Padding:** 12px around the editor content area.

---

## 10. Git Integration

### 10.1 Git Changes Panel

Accessible via the "Git Diff" tab in the left sidebar.

#### 10.1.1 Header

- **Section Label:** "SOURCE CONTROL" in uppercase, 10px, with wide letter-spacing.
- **Branch Chip:** Displays the current Git branch name with a branch icon.

#### 10.1.2 Toolbar

Five action buttons (left to right):

1. **Refresh:** Re-scans Git status and updates the change list.
2. **Stage All:** Stages all unstaged changes.
3. **Unstage All:** Unstages all staged changes.
4. **Discard All:** Discards all unstaged changes (triggers a confirmation dialog).
5. **Commit:** Commits staged changes. Disabled when no commit message is entered.

#### 10.1.3 Commit Message Input

A text area (minimum height 30px) below the toolbar for entering commit messages.

#### 10.1.4 Change Groups

Changes are organized into three groups:

1. **Staged:** Files that have been staged for the next commit.
2. **Changes:** Modified files that are not yet staged.
3. **Untracked:** New files that Git is not yet tracking.

Each group has a header showing the group label and the count of items in that group.

#### 10.1.5 Change Rows

Each file change is displayed as a row with:

- **File Icon:** Colored based on file type.
- **File Name:** The name of the changed file.
- **Parent Path:** The directory containing the file.
- **Status Badge:** A colored badge indicating the change type:
  - Staged: Green (`#78d7b2`)
  - Modified: Orange (`#f1b86a`)
  - Untracked: Blue (`#6cb6ff`)
  - Deleted: Red (`#ff9eb0`)
- **Action Buttons (per file):** Stage, Unstage, or Discard (context-dependent).

#### 10.1.6 Per-File Actions

| Action | Behavior |
|--------|----------|
| Stage | Adds the file's changes to the staging area |
| Unstage | Removes the file's changes from the staging area |
| Discard | Reverts the file's changes to the last committed state (triggers confirmation dialog) |

#### 10.1.7 Bulk Actions

| Action | Behavior |
|--------|----------|
| Stage All | Stages all unstaged changes at once |
| Unstage All | Unstages all staged changes at once |
| Discard All | Discards all unstaged changes at once (triggers confirmation dialog) |

### 10.2 Git Diff Review

When a file is selected in the Git Changes panel, the code editor panel switches to Diff Mode:

- **Monaco Diff Editor:** Side-by-side view showing the original content on the left and the modified content on the right.
- **Added Lines:** Highlighted in green.
- **Removed Lines:** Highlighted in red.
- **Modified Lines:** Highlighted with both removal and addition indicators.

### 10.3 Worktree Inspection

A modal dialog for inspecting Git worktrees associated with the repository.

#### 10.3.1 Header Information

- **Worktree Name:** Displayed as the modal title.
- **Branch Chip:** Shows the branch this worktree is on.
- **Path Chip:** Shows the filesystem path of the worktree.
- **Status Chip:** Indicates whether the worktree is "dirty" (has uncommitted changes) or "clean".

#### 10.3.2 Tabs

Three tabs for viewing different aspects of the worktree:

1. **Status Tab:**
   - Displays the worktree path, branch, and status.
   - Lists individual file changes with their status.

2. **Diff Tab:**
   - Shows a text-based diff of changes in the worktree.
   - Rendered in a `<pre>` block with diff formatting.

3. **Tree Tab:**
   - A file tree view of the worktree's contents.
   - Uses the same TreeView component as the main file browser.

---

## 11. Terminal System

### 11.1 Overview

The application provides two types of terminals:

1. **Agent Terminals:** Embedded within each agent session pane, displaying the agent's process output.
2. **Shell Terminals:** Independent terminals in the bottom panel for running arbitrary commands.

### 11.2 Shell Terminal Panel

Located at the bottom of the workspace screen, below the agent panes.

#### 11.2.1 Layout

- **Progress Bar:** A thin bar (3px height) at the top of the panel, similar to agent pane progress bars.
- **Terminal Content Area:** The active terminal's xterm.js output.

#### 11.2.2 Toolbar

- **Kicker Text:** "TERMINAL" in uppercase, small font.
- **Terminal Title:** The name/title of the current terminal.
- **Terminal Selector Dropdown:** A dropdown listing all available shell terminals. Allows switching between terminals.
- **Close Button:** Closes the currently active terminal.
- **Add Button:** Creates a new shell terminal tab.

#### 11.2.3 Multi-Terminal Support

- Users can create multiple shell terminals within a single workspace.
- Each terminal is an independent session with its own process history.
- Terminals are listed in the selector dropdown for easy switching.
- Closing a terminal removes it from the list.

#### 11.2.4 Empty State

When no terminals exist, the panel displays:
- A message: "No terminal yet"
- An action button to create a new terminal

### 11.3 Agent Terminals

Each agent session has its own embedded terminal:

- **Class:** `.agent-pane-xterm`
- **Render Modes:**
  - **Direct xterm:** Standard terminal rendering via xterm.js.
  - **Transcript Mode:** A hidden xterm with a visible `<pre>` text overlay for better readability of historical output.
- **Interaction Modes:**
  - **Interactive:** The user can type commands into the terminal.
  - **Readonly:** The terminal displays output only; user input is not accepted.

### 11.4 Terminal Styling

| Property | Value |
|----------|-------|
| Background | `#0b1218` |
| Foreground Text | `#d8e2ea` |
| Cursor Color | `#78d7b2` (green) |
| Selection Background | `rgba(108, 182, 255, 0.24)` (blue tint) |
| Font | JetBrains Mono, 13px |
| Scrollbar | 3px wide with rounded thumb |

### 11.5 Terminal Compatibility Modes

In Settings → Appearance, users can choose between two terminal rendering modes:

- **Standard:** Default rendering mode, optimized for performance.
- **Compatibility:** Alternative rendering mode for environments where the standard mode has display issues.

### 11.6 Terminal Sizing

- Terminals auto-fit to their container size.
- Terminal size is tracked and restored when the workspace is reopened.

---

## 12. Command Palette

### 12.1 Access

- **Keyboard:** `Ctrl/Cmd + K`
- **Button:** "Quick Actions" button in the top bar

### 12.2 Layout

A modal dialog (660px maximum width, 8px border radius) with a compact density layout.

#### 12.2.1 Header

- **Kicker Text:** "COMMAND PALETTE"
- **Meta Text:** Shows the number of available actions (e.g., "12 actions")

#### 12.2.2 Search Row

- **Search Icon:** Left side.
- **Search Input:** Filters the action list in real time.
- **Hint Text:** Guidance text below the input.

#### 12.2.3 Results List

- Lists all available actions that match the search query.
- Each action item displays:
  - **Label:** The action name.
  - **Description:** A brief explanation of what the action does.
  - **Shortcut Badge (optional):** The keyboard shortcut for the action, displayed as a small tag on the right side.

#### 12.2.4 Empty State

When no actions match the search query: "No results found"

### 12.5 Available Actions

| Action | Description | Shortcut |
|--------|-------------|----------|
| New Workspace | Open a new workspace tab | `Ctrl/Cmd + N` |
| Toggle Focus Mode | Enter or exit focus mode | `F` |
| Toggle Code Panel | Show or hide the code editor panel | — |
| Toggle Terminal Panel | Show or hide the terminal panel | — |
| Focus Agent Input | Focus the input area of the active agent | — |
| Split Pane Vertically | Split the active agent pane into left/right panes | `Cmd/Ctrl + D` |
| Split Pane Horizontally | Split the active agent pane into top/bottom panes | `Shift + Cmd/Ctrl + D` |
| Switch to Previous Workspace | Move to the workspace tab to the left | `Ctrl/Cmd + Shift + [` |
| Switch to Next Workspace | Move to the workspace tab to the right | `Ctrl/Cmd + Shift + ]` |
| Open Settings | Navigate to the Settings page | — |
| Switch to [Workspace Name] | Directly switch to a specific workspace tab | — |

### 12.6 Interactions

- **Keyboard Navigation:** Arrow Up/Arrow Down to move through the action list, Enter to activate the focused action, Escape to close the palette.
- **Mouse Navigation:** Click any action to activate it.
- **Dismissal:** Clicking outside the palette or pressing Escape closes it.

---

## 13. Settings

### 13.1 Access

- **Button:** Gear icon in the top bar
- **Link:** "Open Settings" on the Welcome Screen
- **Command Palette:** "Open Settings" action

### 13.2 Layout

A dedicated page with a two-column layout:

- **Sidebar Navigation (200px wide):** Lists all settings sections.
- **Content Area:** Displays the settings for the selected section.

### 13.3 Navigation Sections

| Section | Icon | Description |
|---------|------|-------------|
| General | Settings icon | Default agent provider, notification preferences |
| Claude (per provider) | Config icon | Claude-specific settings |
| Codex (per provider) | Config icon | Codex-specific settings |
| Appearance | Appearance icon | Theme, terminal rendering, language |

Each navigation item is at least 42px tall with 14px padding and 7px border radius. The active section is highlighted with an accent background and border.

### 13.4 General Settings

#### 13.4.1 Agent Defaults

- **Default Provider:** A pill selector (set of toggle buttons) listing available providers (Claude, Codex). Determines which provider is pre-selected when creating a new agent session.

#### 13.4.2 Completion Notifications

- **Completion Notifications Toggle:** Enable or disable sound and browser push notifications when agent sessions complete.
- **Notify Only In Background Toggle:** When enabled, notifications are only triggered when the application window is not the active/focused window.
- **Notification Permission Status:** A static text display showing whether the browser has granted notification permissions (e.g., "Granted", "Denied", "Default").

### 13.5 Provider Settings (per provider)

Each provider has its own settings panel with:

#### 13.5.1 Summary Card

A card displaying the provider's badge label and current configuration summary.

#### 13.5.2 Inject Hooks Section

- **Inline Button:** A button to inject provider-specific hooks into the active workspace.
- **Status Display:** Shows success or error state after injection attempt.

#### 13.5.3 Configuration Fields

Dynamic fields based on the provider's configuration schema:

| Field Type | UI Component |
|------------|-------------|
| String | Single-line text input |
| String List | Textarea (one item per line) |
| Environment Map | Textarea (key=value pairs) |
| JSON | Textarea with JSON content |
| Select | Dropdown menu |

Each field may have:
- **Label:** The field name.
- **Description:** Help text explaining the field's purpose.
- **Error Display:** Red text below the field when validation fails.

#### 13.5.4 Command Preview

A display showing the effective command that will be used to launch the agent process, incorporating all current settings values. Updates in real time as settings are modified.

### 13.6 Appearance Settings

#### 13.6.1 Theme

- **Current State:** Dark theme only.
- **UI:** A pill selector showing "Dark" as the active option. Light theme is planned but not currently shipped.

#### 13.6.2 Terminal Rendering

- **Options:** "Standard" / "Compatibility"
- **UI:** Pill selector (toggle buttons).

#### 13.6.3 Language

- **Options:** "English" / "Chinese"
- **UI:** Pill selector (toggle buttons).
- **Behavior:** Changes the interface language immediately. The preference is persisted and applied on subsequent visits.

### 13.7 Footer Bar

At the bottom of the Settings page:

- **Auto-Save Notice:** A message indicating that settings are saved automatically.
- **Build Metadata:** The application version number and the build published timestamp.

---

## 14. Focus Mode

### 14.1 Purpose

Focus mode provides a distraction-free environment by hiding non-essential UI elements, allowing the user to concentrate on agent output and code.

### 14.2 Activation

- **Keyboard:** Press the `F` key (when not focused on a text input).
- **Command Palette:** "Toggle Focus Mode" action.

### 14.3 Behavior

When focus mode is activated:

- The top bar is hidden or minimized.
- The left sidebar (code panel) is hidden.
- The bottom terminal panel is hidden.
- The agent workspace (center panel) expands to fill the available space.
- Agent pane headers may be simplified.

### 14.4 Deactivation

- **Keyboard:** Press `Escape`.
- **Command Palette:** "Toggle Focus Mode" action again.

All hidden UI elements are restored to their previous state.

---

## 15. Notification System

### 15.1 Purpose

Notify the user when long-running agent sessions complete their work, especially when the user is working in another tab or application.

### 15.2 Notification Types

#### 15.2.1 Sound Notification

- A task completion sound (`task-complete.wav`) is played when an agent session transitions to a completed state.
- Can be enabled/disabled in Settings → General → Completion Notifications.

#### 15.2.2 Browser Push Notification

- A browser push notification is displayed with:
  - **Title:** Indicating the session/workspace name.
  - **Body:** A message about the completion (e.g., "Session completed").
- **Click Behavior:** Clicking the notification switches the user's view to the relevant workspace and session.
- Can be enabled/disabled in Settings → General → Completion Notifications.

### 15.3 Notification Configuration

| Setting | Options | Default |
|---------|---------|---------|
| Completion Notifications | Enabled / Disabled | Enabled |
| Notify Only In Background | Enabled / Disabled | Enabled |

---

## 16. Supervisor System

### 16.1 Purpose

The Supervisor is an automated evaluation system that periodically assesses an agent session's progress toward a defined objective. It can inject guidance, pause evaluation, or trigger re-evaluation based on the session's state.

### 16.2 Supervisor States

| State | Description |
|-------|-------------|
| **Inactive** | No supervisor is configured for the session. |
| **Idle** | Supervisor is configured but not currently evaluating. |
| **Evaluating** | Supervisor is actively assessing the session's progress. |
| **Injecting** | Supervisor is injecting guidance or feedback into the session. |
| **Paused** | Supervisor evaluation is temporarily suspended. |
| **Error** | Supervisor encountered an error during evaluation. |

### 16.3 Supervisor UI

#### 16.3.1 Supervisor Section in Agent Pane

Each agent session with an active supervisor displays a supervisor card (`.agent-pane-supervisor-card`) with:

- **State Attribute:** The card reflects the current supervisor state (evaluating, injecting, paused, error, off).
- **Label Row:**
  - Badge check icon + "Supervisor" label.
  - State tag showing the current state.

#### 16.3.2 Supervisor Actions

When a supervisor exists on a session, the following action buttons are available (13px icons):

| Button | Icon | Action |
|--------|------|--------|
| Edit Objective | Message Square | Opens the Supervisor Objective Dialog to modify the evaluation criteria |
| Pause | Circle Pause | Suspends supervisor evaluation |
| Resume | Play | Resumes a paused supervisor |
| Retry | Refresh | Re-attempts a failed evaluation |
| Trigger | Arrow Up | Manually triggers an evaluation cycle |
| Disable | Square | Disables the supervisor for this session |

#### 16.3.3 Enable Supervisor

When no supervisor is configured on a session (and the session is not in draft state):

- An "Enable" button (Play icon) is displayed.
- Clicking it opens the Supervisor Objective Dialog in "enable" mode.

### 16.4 Supervisor Objective Dialog

A modal dialog for defining and editing the supervisor's evaluation criteria.

#### 16.4.1 Modes

- **Enable:** First-time setup of the supervisor.
- **Edit:** Modifying an existing supervisor objective.
- **Disable:** Removing the supervisor from the session.

#### 16.4.2 Layout

- **Objective Textarea:** A multi-line text area (5 rows, autofocus) with a placeholder prompting the user to describe the objective.
- **Preview Section:** A read-only preview displaying the objective text in a formatted code block (`<pre>`).
- **Action Buttons:**
  - **Cancel:** Closes the dialog without saving.
  - **Confirm:** A primary button that saves the objective and activates/updates the supervisor.

### 16.5 Supervisor Cycles

Each evaluation cycle is tracked with the following statuses:

| Status | Description |
|--------|-------------|
| Queued | Waiting to be evaluated |
| Evaluating | Currently being evaluated |
| Completed | Evaluation finished successfully |
| Injected | Guidance was injected into the session |
| Failed | Evaluation failed |

---

## 17. Internationalization

### 17.1 Supported Languages

| Language | Code |
|----------|------|
| English | `en` |
| Chinese (Simplified) | `zh` |

### 17.2 Language Switching

- Language can be changed in Settings → Appearance → Language.
- The interface updates immediately upon selection.
- The preference is persisted in the user's settings and applied on subsequent visits.

### 17.3 Localized Content

The following content types are localized:

- All UI labels, button text, and navigation elements.
- Session titles (generated by agents).
- Workspace titles.
- Terminal titles.
- Relative time formatting (e.g., "2 minutes ago", "3 hours ago").
- Kicker texts and section labels.

### 17.4 Translation System

- Uses a key-based translation system with `{key}` interpolation.
- Translation files are stored as JSON (`locales/en.json`, `locales/zh.json`).
- A `createTranslator` function provides runtime translation lookups.

---

## 18. Design System

### 18.1 Component Density

The application uses a **compact** density layout across all surfaces. Components with `data-density="compact"` have tighter padding and smaller font sizes than a comfortable density variant.

### 18.2 Button Styles

| Style | Class | Usage |
|-------|-------|-------|
| Primary | `.btn.btn-primary` | Confirm actions, start operations |
| Default | `.btn` | Cancel, secondary actions |
| Danger | `.btn.btn-danger` | Destructive actions (discard, delete) |
| Icon Button | `.pane-action` | Pane-level actions (split, close) |
| Toolbar Button | `.topbar-tool` | Top bar action buttons |

### 18.3 Interactive States

| State | Treatment |
|-------|-----------|
| Hover | Background shifts to a lighter tint (calculated via `color-mix`) |
| Active/Pressed | Further background darkening, slight scale reduction |
| Focus | Outline in accent color |
| Disabled | Reduced opacity (50%), pointer-events none |

### 18.4 Panel Resizers

- **Width:** 4px for main panel dividers, 8px for agent split dividers.
- **Cursor:** `col-resize` for vertical dividers, `row-resize` for horizontal dividers.
- **Hover State:** Background changes to accent color (`#6cb6ff`).
- **During Resize:** All transitions on panel content are disabled (`transition: none !important`) for performance. A class `body.is-resizing-panels` is applied to the body element.

### 18.5 Modal Overlays

- **Backdrop:** Semi-transparent black overlay (`rgba(0, 0, 0, 0.5)`).
- **Card:** Scales in from 0.95 with fade-in animation.
- **Dismissal:** Click outside the modal, press Escape, or click the close button.
- **Density:** All modals use compact density.

### 18.6 Status Badges & Indicators

#### 18.6.1 Session Status Dots

| Color | State |
|-------|-------|
| Green (`#78d7b2`) | Active/Running |
| Gray-Blue | Idle |
| Blue (`#6cb6ff`) | Queued |
| Muted | Off/Unavailable |

#### 18.6.2 Source Status Badges

| Color | Status |
|-------|--------|
| Green (`#78d7b2`) | Staged |
| Orange (`#f1b86a`) | Modified |
| Blue (`#6cb6ff`) | Untracked |
| Red (`#ff9eb0`) | Deleted |

#### 18.6.3 Worktree Status Chips

| Class | Status |
|-------|--------|
| `.worktree-meta-chip.status.dirty` | Has uncommitted changes |
| `.worktree-meta-chip.status.clean` | No pending changes |

### 18.7 Progress Bars

- **Height:** 3px.
- **Behavior:** Width animates based on completion ratio.
- **Colors:**
  - Accent blue for live/loading states.
  - Danger pink for error states.
- **Minimum Width:** 6% (always visible even at 0% progress).
- **Running State:** Minimum 34% width when actively running.
- **Transition:** Width animates with fast duration (60ms).

---

## 19. Interaction Patterns

### 19.1 Hover-Reveal Pattern

Several UI elements follow a hover-reveal pattern where secondary actions are hidden by default and appear only on hover:

- **Tab Close Buttons:** X buttons on workspace tabs are hidden until the tab is hovered.
- **Pane Action Buttons:** Split and close buttons in agent pane headers appear on hover.
- **Folder Browser Actions:** "Enter folder" actions appear on hover over directory rows.

### 19.2 Pill Selector Pattern

Settings options that choose between discrete values use a pill selector (a row of toggle buttons):

- Only one pill is active at a time (single selection).
- The active pill has a distinct background and border.
- Clicking an inactive pill activates it and deactivates the previous selection.
- Used for: Default Provider, Theme, Terminal Rendering, Language.

### 19.3 Confirmation Dialog Pattern

Destructive actions (Discard All, close workspace with active sessions) trigger a confirmation dialog:

- **Overlay:** Semi-transparent backdrop.
- **Card:** Compact modal card with:
  - **Header:** H3 title.
  - **Body:** Message text with optional details section (content + timestamp).
  - **Footer:** Cancel button (default style) and Confirm button (danger style).

### 19.4 Empty State Pattern

Every major section of the application has a defined empty state:

| Area | Empty State Content |
|------|-------------------|
| Top Bar (no workspaces) | Kicker + label prompting to open a workspace |
| Welcome Screen | Product description + action buttons |
| Terminal Panel (no terminals) | "No terminal yet" + add button |
| Agent Pane (draft) | Provider selection buttons |
| Agent Pane (unavailable) | Error title, reason, and remove button |
| Agent Pane (no output) | "No agent output yet" |
| Command Palette (no results) | "No results found" |
| File Search (no matches) | Empty dropdown |

### 19.5 Loading State Pattern

- **Runtime Validation:** Blue pulse animation on status dots while checking.
- **Auth Screen:** Spinner during loading state.
- **Skeleton Loaders:** Shimmer animation on placeholder bars during initial load.
- **Agent Sessions:** Progress bar at minimum 6% width during initialization.

### 19.6 Real-Time Sync

The application maintains real-time synchronization of:

- Agent events (session started, turn completed).
- Terminal events (output chunks).
- Lifecycle events (workspace state changes).
- Artifact dirty events (git changes, worktree changes, file tree changes).

Reconnection with fallback is handled automatically when the connection is interrupted.

---

## 20. Edge Cases & Error States

### 20.1 Authentication Errors

| Scenario | Behavior |
|----------|----------|
| Incorrect passphrase | Error message displayed below input field; user can retry immediately |
| Session expired | User is redirected to the authentication screen with an expiration message |
| IP blocked | "Blocked" state is displayed with information about the lockout duration |
| Auth service unavailable | "Unavailable" state is displayed with a retry option |

### 20.2 Agent Session Errors

| Scenario | Behavior |
|----------|----------|
| Agent process fails to start | Pane enters "unavailable" state with error reason and remove button |
| Agent process crashes | Terminal displays crash output; pane status reflects the error |
| Agent session times out | Session is marked as idle; completion reminder may be triggered |

### 20.3 Workspace Errors

| Scenario | Behavior |
|----------|----------|
| Directory not accessible | Workspace launch fails; error message is displayed in the launch overlay |
| Runtime validation fails | Workspace launch is blocked; Runtime Validation Overlay shows missing commands with install hints |
| Workspace recovery fails | Workspace is opened in a clean state; previous session data may be lost |

### 20.4 Git Errors

| Scenario | Behavior |
|----------|----------|
| Not a Git repository | Git Changes panel displays an empty state with guidance to initialize Git |
| Git command fails | Error is displayed in the relevant section (e.g., commit failure) |
| Merge conflict | Files with conflicts are highlighted in the changes list |

### 20.5 Terminal Errors

| Scenario | Behavior |
|----------|----------|
| PTY allocation fails | Terminal displays an error message and a retry option |
| Terminal process exits unexpectedly | Terminal displays the exit code and a prompt to create a new terminal |

### 20.6 Concurrency Conflicts

| Scenario | Behavior |
|----------|----------|
| Two tabs attempt to control the same workspace | Controller/observer protocol ensures only one tab has write access; the other tab observes |
| Controller heartbeat misses deadline | Observer initiates takeover protocol with a deadline-based handoff |
| Page unload during active session | Controller is released gracefully; workspace state is preserved |

### 20.7 Network Interruption

| Scenario | Behavior |
|----------|----------|
| WebSocket disconnects | Automatic reconnection with fallback; events are buffered during disconnection |
| Server becomes unreachable | Agent sessions continue running locally; UI displays connection status |

### 20.8 File System Errors

| Scenario | Behavior |
|----------|----------|
| File deleted externally | File tree updates automatically via file watcher; open file in editor shows a stale state until refreshed |
| File permission denied | Error displayed when attempting to open or save the file |

---

## Appendix A: Current Boundaries (Not Yet Shipped)

The following features are partially implemented or planned but not fully available in the current release:

| Feature | Current State |
|---------|--------------|
| Multi-agent provider support | Claude and Codex exist but multi-provider orchestration is not fully production-ready |
| Light theme | Dark theme only; light theme is planned but not shipped |
| Full visual task queue UI | Task queue exists internally but is not fully visualized in the UI |
| Complete Archive/Dispatch Center | Archive history exists but a full management center is not shipped |
| Explicit worktree management entry points | Worktree inspection exists but full creation/deletion management is not available |
| Fully closed-loop auto-suspend behavior | Idle policy exists but auto-suspend is not fully automatic |
| Remote Git workspace creation | Backend supports it but the UI entry is hidden/deferred |

---

## Appendix B: Product Metrics & Telemetry (Recommended)

The following metrics should be tracked to understand product usage:

| Metric | Purpose |
|--------|---------|
| Active workspaces per session | Understand typical usage depth |
| Agent sessions per workspace | Understand parallelism needs |
| Average session duration | Understand typical agent run length |
| Supervisor activation rate | Measure adoption of the supervisor feature |
| Focus mode usage | Measure demand for distraction-free mode |
| Terminal count per workspace | Understand shell terminal demand |
| Git commit frequency | Understand Git integration usage |
| Command palette usage frequency | Measure discoverability and adoption |
| Settings change frequency | Understand configuration friction |
| Auth failure rate (for remote deployments) | Monitor authentication health |

---

## Appendix C: Accessibility Considerations

| Area | Recommendation |
|------|---------------|
| Color contrast | Ensure all text meets WCAG 2.1 AA contrast ratios (4.5:1 for normal text, 3:1 for large text) |
| Keyboard navigation | All interactive elements must be reachable and operable via keyboard |
| Focus indicators | All focusable elements must have visible focus indicators |
| Screen reader support | ARIA labels should be added to icon-only buttons and complex interactive components |
| Motion preferences | Users who prefer reduced motion should be able to disable pulse animations and transitions |

---

*End of Document*

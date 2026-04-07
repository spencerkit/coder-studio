# Coder Studio PRD (Current Implementation Baseline)

Version: 2026-03-19  
Status: current implementation baseline  
Scope: this document describes what is implemented in the current codebase. It is not a future roadmap.

## 1. Purpose

This PRD documents the current product baseline and answers three questions:

1. What the product is today.
2. How users can use it today.
3. Which capabilities appear in code or data models but should not be described as fully shipped features.

The implementation baseline comes primarily from:

- `apps/web/src/App.tsx`
- `apps/web/src/state/workbench.ts`
- `apps/web/src/i18n.ts`
- `apps/server/src/main.rs`

## 2. Product Summary

Coder Studio is a local-first developer workbench that currently runs as a local server with a web UI, while Rust / Tauri provide the native runtime underneath. It brings the following tasks into one operational surface:

- connecting local Git workspaces
- starting and managing Claude agent sessions
- splitting parallel agent workstreams
- browsing, editing, and saving code files
- reviewing Git changes and running common Git actions
- running shell commands inside embedded terminals

The current product position is:

- local-first, single-user developer workbench exposed by a local server runtime
- repository-centric agent collaboration surface
- not a full IDE and not a multi-user collaboration platform

## 3. Target Users

1. Individual developers who want one local work surface for agents, code inspection, Git, and terminals.
2. Engineers who need to switch tasks quickly while working against real repositories.
3. Claude Code users who want Claude CLI execution, repository context, and review workflows in the same app.

## 4. Supported Environment

- runtime: local server runtime built on Rust / Tauri and accessible from a browser or the Tauri shell
- current workspace source: `Local Folder`
- remote Git: backend plumbing still exists, but the creation entry is hidden in the current release and deferred to the next phase
- execution targets: `Native`, plus `WSL` when available
- agent provider: currently `Claude` only
- languages: Chinese and English
- theme: dark-only in the current build
- storage: local-first, with workspace/session/layout/view persistence in backend SQLite and app settings plus language preference in browser local storage

## 5. Current Product Scope

### 5.1 Workspace Onboarding

- The app starts with a workspace launch overlay.
- The current release only exposes `Local Folder` for workspace creation.
- The remote Git clone path still exists in backend code, but the UI entry is intentionally hidden and should not be described as a shipped feature.
- In local mode, the app uses a backend-backed directory browser that supports:
  - current path display
  - Home
  - parent directory navigation
  - selecting the current directory or a child directory
- Local onboarding is repository-oriented: the selected path is resolved to a Git repository root rather than treated as an arbitrary folder.
- When supported, users can choose `Native` or `WSL` as the execution target.
- WSL mode allows an optional distro name.

### 5.2 Multi-Workspace Management

- The top bar supports multiple workspace tabs.
- Users can add, switch, and close workspaces.
- Workspace tabs display:
  - a workspace label or path-derived name
  - a running-status indicator
  - unread counts
- Keyboard support includes:
  - `Cmd/Ctrl + N` to create a workspace
  - `Cmd/Ctrl + Shift + [` to switch to the previous workspace
  - `Cmd/Ctrl + Shift + ]` to switch to the next workspace
- Layout and workspace state persist locally.

### 5.3 Agent Sessions and Pane Model

- Parallel work is represented as split panes, not as a dedicated session board.
- Each agent pane corresponds to a session.
- Users can split the current pane vertically or horizontally.
- Splitting creates a new draft session and focuses the new pane immediately.
- Before the agent starts, the pane shows a dedicated input field.
- That input only exists before startup. Once the agent starts, the pane switches to interactive terminal mode.
- Draft input placeholder:
  - Chinese: `请输入内容开启新任务`
  - English: `Type to start a new task`
- The first meaningful input is used to generate the session title.
- Visible session states currently used by the product are:
  - `idle`
  - `running`
  - `background`
  - `waiting`
  - `queued`
- `suspended` exists in the model, but the current build does not expose a complete, verifiable auto-suspend product flow.
- Non-focused sessions can accumulate unread counts and trigger toast notifications when activity continues in the background.

### 5.4 Agent Launch and Interaction

- Agents run inside PTYs.
- A draft pane only materializes into a backend session when the first input is submitted.
- After startup, subsequent input is written directly to the PTY.
- Pane size changes are synced to the running agent PTY.
- The configured Launch Command determines how the agent is started.
- The app validates command availability in the current execution target and reports that status in Settings.
- The provider is effectively fixed to `Claude` in the current product.

### 5.5 Claude-Specific Enhancements

- The app automatically writes or updates Claude hook configuration in `~/.claude/settings.json` for the current runtime environment.
- Provider lifecycle events are received and mapped into app-level session updates.
- The normalized lifecycle categories currently include:
  - `session_started`
  - `turn_completed`
- `session_started` is only used to persist the provider session ID (`resume_id`) for future resume flows.
- `turn_completed` is the authoritative signal that a turn finished, which returns the session to idle and triggers completion follow-up logic.

### 5.6 Code Panel

- The right-side code panel can be shown or hidden.
- The panel supports an expanded mode with fuller navigation and Git tooling.
- File capabilities include:
  - repository tree browsing
  - click-to-preview
  - file search and jump
  - Monaco-based preview and editing
  - file save
- Saving edited files is already implemented.
- `Cmd/Ctrl + S` triggers save for the current preview file.
- Diff capabilities include:
  - repository-wide Git diff preview
  - structured single-file diff preview
  - Monaco DiffEditor when structured content exists
  - plain text diff fallback when structured content is unavailable

### 5.7 Git Operations

- The workspace header displays the current branch and change count.
- The code sidebar includes a `Source Control` view.
- Git changes are grouped into:
  - `Changes`
  - `Staged Changes`
  - `Untracked`
- Per-file actions include:
  - Stage
  - Unstage
  - Discard
- Global actions include:
  - Stage All
  - Unstage All
  - Discard All
- Users can enter a commit message and create a commit.
- Selecting a Git change updates the right side with the relevant diff preview.

### 5.8 Embedded Terminal

- The right-side terminal panel can be shown or hidden.
- Each workspace can hold multiple terminal instances.
- Users can:
  - create terminals
  - switch between terminals
  - close terminals
- Terminals are PTY-backed and support interactive input, live output, and resize syncing.
- Terminal execution follows the current workspace target.

### 5.9 Global Controls and Settings

- The product includes a quick actions palette.
- Shortcut: `Cmd/Ctrl + K`
- Current quick actions include:
  - create workspace
  - toggle Focus Mode
  - toggle code panel
  - toggle terminal panel
  - focus current agent
  - vertical/horizontal pane split
  - switch previous/next workspace
  - open settings
- The settings screen currently has only two first-level panels:
  - `General`
  - `Appearance`
- `General` currently contains:
  - Launch Command
  - Idle Policy toggle
  - Idle Minutes
  - Max Active
  - Memory Pressure
- `Appearance` currently contains:
  - dark theme explanation
  - language switcher
- Settings are auto-saved.

### 5.10 Local Persistence

- Workbench state is no longer stored in Local Storage.
- Persisted data now includes:
  - backend SQLite: workspaces, sessions, archives, workbench layout, and per-workspace view state
  - browser local storage: app settings and selected language
- Closing a non-draft pane archives the related backend session.
- The UI can already render a read-only archive session view, but archive browsing is not yet exposed as a complete user-facing center.

## 6. Core User Flows

### 6.1 Start a Workspace

1. Open the app.
2. Enter the workspace launch overlay.
3. Choose `Native` or `WSL`.
4. Pick a local directory in the built-in directory browser.
5. Let the app resolve and attach the matching Git repository root.
6. After launch, the main workspace loads repository data, file tree, and Git information.

### 6.2 Start the First Agent Task

1. Enter a workspace.
2. The default agent pane shows a draft input before the agent starts.
3. Enter a task and press Enter.
4. The app creates a backend session and starts a Claude PTY.
5. The first input becomes the session title.
6. The input field disappears and the pane switches to interactive terminal streaming.

### 6.3 Split Parallel Agent Tasks

1. Click vertical or horizontal split in the current agent pane.
2. The app creates a new draft session.
3. The new pane receives focus and shows the startup input.
4. The original pane continues running or moves into background state.

### 6.4 Review and Edit Code

1. Open the code panel.
2. Use the file tree or file search to find a file.
3. Review or edit the file in Monaco.
4. Save changes through the built-in save flow.

### 6.5 Review Git Changes and Commit

1. Switch to the Git sidebar.
2. Review `Changes / Staged / Untracked`.
3. Select a file to inspect its diff.
4. Stage, unstage, or discard changes.
5. Enter a commit message and commit.

### 6.6 Use the Embedded Terminal

1. Open the terminal panel.
2. Create one or more terminal instances.
3. Run shell commands.
4. Switch between terminals as needed.

## 7. Not Current Shipped Features

The following should not be presented as current shipped user-facing functionality even if they appear in old documentation, state models, styles, or backend commands:

- multi-provider agent support
- light theme
- a dedicated queue / dispatch board UI
- user-visible auto-feed workflow
- a complete archive log center
- an explicit worktree management surface
- a complete auto-suspend execution loop
- user-facing session mode switching between `branch` and `git_tree`
- MCP settings UI or advanced Claude configuration screens
- a user-visible remote Git workspace creation entry

## 8. Current Constraints

- Local folder onboarding depends on resolving a Git repository root rather than accepting arbitrary folders.
- Remote Git still has backend plumbing, but the current release hides the entry point, so it must not be documented as a supported user flow.
- WSL support depends on `wsl.exe` and target-specific path resolution.
- The configured Claude launch command must exist in the selected runtime environment.
- Queue, archive, and worktree capabilities currently show a “backend first, UI surface incomplete” shape, so documentation must describe only what users can actually do in the interface.

## 9. Acceptance Criteria

1. The app must show the workspace launch overlay on first entry or when creating a new workspace.
2. Users must currently be able to start a workspace only through `Local Folder`, and the creation flow must not expose a remote Git option.
3. In supported environments, users must be able to choose `Native` or `WSL` execution.
4. Once a workspace loads, the main agent area must be visible and non-started panes must show the draft input field.
5. Submitting the first draft input must materialize a session, start the agent, generate the title, and switch the pane to interactive terminal mode.
6. Users must be able to create parallel agent panes with horizontal and vertical splits.
7. Users must be able to open the code panel, browse files, search files, preview files, edit files, and save files.
8. Users must be able to complete baseline Git actions including Stage, Unstage, Discard, and Commit.
9. Users must be able to create, switch, and close multiple embedded terminals.
10. Users must be able to open quick actions with `Cmd/Ctrl + K` and run the main global actions.
11. Users must be able to update Launch Command, Idle Policy values, and interface language from Settings.
12. Theme documentation must match the current build and describe the product as dark-only.

## 10. Recommended Next Documentation Split

As documentation grows, the following topics should stay outside the PRD and live in dedicated development docs:

- frontend state model details
- Tauri command inventory
- Claude hook event flow
- file, Git, and terminal data flow
- persistence and local database structure
- roadmap and deferred capabilities

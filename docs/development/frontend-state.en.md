# Frontend State Model

[中文](frontend-state.md)

This document explains where frontend state lives today, which entities matter most, and how the key state transitions work.

## 1. State Sources

Frontend state currently lives in three layers:

- global workbench state: `apps/web/src/state/workbench.ts`
- page-level local UI state: `apps/web/src/App.tsx`
- frontend/backend interaction types: `apps/web/src/types/app.ts`

A simple mental model is:

- `workbench.ts` defines what exists in the workbench
- `App.tsx` defines how it is rendered and interacted with right now
- `types/app.ts` defines how frontend and backend talk to each other

## 2. Core Entities

### 2.1 WorkbenchState

`WorkbenchState` is the root global state. It includes:

- `tabs`: all workspaces
- `activeTabId`: current workspace
- `layout`: side-panel widths, bottom split ratio, panel visibility
- `overlay`: onboarding overlay state for launching a workspace

### 2.2 Tab

`Tab` represents one workspace. Important fields include:

- `project`: repository path and execution target
- `agent`: provider / command config for that workspace
- `git`: branch, change count, latest commit
- `gitChanges`: current Git change list
- `worktrees`: refreshed backend worktree list
- `sessions`: all sessions in the workspace
- `activeSessionId`: focused session
- `paneLayout`: agent pane tree
- `activePaneId`: focused pane
- `terminals`: embedded terminal collection
- `fileTree` / `changesTree`: repository tree and change tree
- `filePreview`: right-side preview state
- `archive`: archived backend snapshots
- `viewingArchiveId`: whether the UI is in read-only archive mode
- `idlePolicy`: resource policy values synced from settings

### 2.3 Session

`Session` is the main business unit associated with an agent pane. Important fields:

- `id`
- `title`
- `status`
- `mode`
- `autoFeed`
- `isDraft`
- `queue`
- `messages`
- `stream`
- `unread`
- `lastActiveAt`
- `claudeSessionId`

The most important ones in current UI behavior are:

- `isDraft`: decides whether the pane shows the startup input or the terminal
- `stream`: stores the textual agent output stream
- `claudeSessionId`: used when resuming Claude conversation context

### 2.4 SessionPaneNode

Pane structure is a tree, not a linear list.

There are two node types:

- `leaf`: a concrete pane mapped to one `sessionId`
- `split`: a split node with `axis`, `ratio`, `first`, and `second`

This means:

- parallel agent work is fundamentally implemented as a pane tree
- a “new task” in the current product usually means “new pane + new session”

### 2.5 FilePreview

`filePreview` drives the right-side code area. Main fields include:

- `path`
- `content`
- `mode`: `preview` or `diff`
- `diff`
- `originalContent`
- `modifiedContent`
- `dirty`
- `source`: file tree or Git
- `section`: related Git section when diff-driven

### 2.6 Terminal

`Terminal` represents one embedded shell instance. Its frontend fields are minimal:

- `id`
- `title`
- `output`

The actual PTY runtime handle does not live in frontend state. It is held by the Rust backend.

## 3. Page-Level Local State

`apps/web/src/App.tsx` also maintains a large set of UI-control state, including:

- `locale`
- `appSettings` / `settingsDraft`
- `route`
- `activeSettingsPanel`
- `commitMessage`
- `toasts`
- `worktreeModal`
- `worktreeView`
- `previewMode`
- `codeSidebarView`
- `fileSearchQuery`
- `isCodeExpanded`
- `folderBrowser`
- `agentCommandStatus`
- `isFocusMode`
- `commandPaletteOpen`
- `draftPromptInputs`

These are best understood as view-control state rather than core product domain state.

## 4. Key State Transitions

### 4.1 Tab Initialization

`createTab()` creates:

- one default session
- a one-leaf pane tree
- empty file tree, terminal list, and Git list
- `overlay.visible = true`

So the workspace entry path is always:

- create tab first
- choose repository through the overlay
- load real workspace data after that

### 4.2 Draft Session to Live Session

The most important session transition is materialization:

1. a new pane starts with `isDraft = true`
2. the user enters the first task
3. `materializeSession()` calls backend `create_session`
4. the draft session is replaced by a real session
5. the title is extracted from the first input
6. the agent PTY is then started

This is the actual implementation behind “use the first input as the session name”.

### 4.3 Session Status Mapping

The frontend applies a visible-status mapping layer:

- focused `running` / `waiting` sessions stay foreground-like
- non-focused foreground-active sessions are mapped to `background`
- switching sessions resets unread counts

The states users actually encounter most often today are:

- `idle`
- `running`
- `background`
- `waiting`
- `queued`

`suspended` exists in the model, but the UI does not yet expose a full end-to-end product flow for it.

### 4.4 Pane Splitting

`splitPane()` does the following:

- creates a new draft session
- creates a new leaf node
- replaces the current leaf with a `split` node
- updates `activePaneId` and `activeSessionId`

So the pane tree is both the layout structure and the parallel-session structure.

### 4.5 Archive View

The frontend state already includes archive-related fields:

- `archive`
- `viewingArchiveId`

Current implemented behavior includes:

- closing a non-draft pane can archive the backend session
- when archive view is entered, the agent surface becomes read-only

But there is still no complete archive browsing surface in the current UI.

### 4.6 Code Panel State

The code area is controlled by several pieces of state together:

- `showCodePanel`
- `isCodeExpanded`
- `codeSidebarView`
- `previewMode`
- `filePreview`
- `fileSearch*`

Selecting a file from Git changes moves `filePreview` into `diff` mode. Selecting a file from the repository tree moves it into `preview` mode.

### 4.7 Terminal Panel State

The terminal area is driven by:

- `showTerminalPanel`
- `activeTerminalId`
- `terminals`
- layout split state such as `rightSplit`

Output text is stored inside each terminal's `output`, while the real PTY handle remains backend-only.

## 5. Events and Frontend Sync

The frontend subscribes to three main event channels over WebSocket:

- `agent://event`
- `agent://lifecycle`
- `terminal://event`

These events map backend PTY streams and Claude lifecycle changes back into frontend state.

In parallel, the frontend still relies heavily on explicit refreshes for workspace artifacts such as:

- Git status
- Git change list
- worktree list
- file tree

So the current sync model is a hybrid of event streaming and active refresh.

## 6. Local Persistence

`workbench.ts` persists workbench state into Local Storage.

Current persisted data includes:

- tabs
- layout
- basic overlay state

`App.tsx` also persists:

- app settings
- locale

Persistence includes some sanitization. For example, draft sessions are not kept forever in the same way as fully materialized sessions.

## 7. Model/UI Mismatches to Watch

The following concepts clearly exist in state or backend code, but are not fully surfaced in the current UI:

- `queue`
- archive browsing center
- explicit worktree management entry points
- `SessionMode = git_tree`
- `SessionStatus = suspended`

Development documentation should therefore always distinguish between:

- supported in the model/backend
- fully usable in the current user interface

# Coder Studio

[中文](README.md) | [English](README.en.md)

Coder Studio is a local-first AI coding workbench built around the `Claude` workflow. It brings `Claude`, repositories, code editing, Git review, terminals, and session history into one interface. It is not positioned as a generic chat product. It is a workbench designed for real repositories and real `Claude Code` usage.

Think of it as a workspace for the actual development loop:

- connect a local folder or remote Git repository
- run multiple Claude sessions in parallel inside one workspace
- inspect code, edit files, and commit changes without leaving the app
- archive and restore past sessions when you want to continue earlier work
- run against `Native` or `WSL` targets

## Who It Is For

Coder Studio is a good fit if you:

- already use `Claude Code` on real repositories
- want agents, code, Git, and terminals on one screen
- often split one task into several parallel sessions
- prefer a local-first, self-hosted, controllable workbench

## Claude-Focused Capabilities

This is the part worth emphasizing most.

### 1. Treat Claude sessions as real working units

- split one workspace into multiple Claude sessions
- each session keeps its own context and terminal interaction flow
- useful when implementation, verification, follow-up notes, and review need to move in parallel

### 2. Archive, restore, and continue past Claude work

- closing a session or workspace archives it instead of making it disappear
- history is grouped by workspace so repository context stays readable
- restore archived sessions and continue previous work
- permanently delete a history record when you do not want to keep it anymore

### 3. Manage how Claude starts from one Settings surface

- configure Claude startup behavior in Settings instead of hand-writing one long launch command
- common CLI flags are exposed directly
- preview the full effective launch command
- keep separate Claude profiles for `Native` and `WSL`

### 4. Edit common Claude config fields directly

- expose common `settings.json` fields
- expose common `config.json` fields
- manage API key, auth token, base URL, and extra environment variables for auth and gateway setups
- if you already have local Claude config files, the Settings UI tries to surface common values for you

### 5. Keep Claude, code, and Git in one loop

- inspect Claude output and jump straight into files or diffs
- make edits and commit without leaving the same workspace
- avoid bouncing between chat, editor, terminal, and Git tools

## What You Can Do With It

### 1. Work on real repositories through workspaces

- `Local Folder` and `Remote Git`
- `Native` and `WSL` execution targets
- each workspace keeps its own code, sessions, and terminal context

### 2. Read and edit code in the same surface

- file tree
- file search
- Monaco preview and editing
- save support

### 3. Review and commit Git changes directly

- inspect diffs
- `Stage / Unstage / Discard`
- write commit messages and commit in place

### 4. Keep terminals inside the workflow

- multi-terminal support
- run `git status`, scripts, and one-off commands
- avoid bouncing between external terminals and the workbench

### 5. Expose it in a controlled public mode

- one-passphrase login
- `HttpOnly` session cookie
- IP-based lockout on repeated failures
- single-root access restrictions via `root.path`

## Preview

The screenshots below use a demo workspace and mock data to make the core workflow easier to scan.

### Workspace Overview

![Coder Studio workspace overview](docs/assets/readme/workspace-overview.png)

- agent panes on the left
- code panel on the right
- built-in terminal at the bottom

### Parallel Sessions

![Coder Studio parallel agent panes](docs/assets/readme/multi-agent.png)

- split one task into multiple sessions
- keep each session in its own context
- useful for implementation, verification, and follow-up work moving together

### Code And Review

![Coder Studio code and source control review](docs/assets/readme/git-review.png)

- inspect files, diffs, and commit flow in one place
- better suited to the full loop of tasking, reviewing, editing, and committing

## 3-Minute Quick Start

### Option 1: Start with the CLI

If you use the published npm CLI, the fastest path is:

```bash
npm install -g @spencer-kit/coder-studio
coder-studio start
coder-studio open
```

Then:

1. choose `Local Folder` or `Remote Git`
2. choose `Native` or `WSL`
3. enter your first task in the agent pane and press Enter
4. split panes, open history, or restore archived sessions as needed
5. open Settings if you want to confirm Claude startup flags or auth settings

### Option 2: Run from source

```bash
pnpm install
pnpm dev:stack
```

Then open:

```text
http://127.0.0.1:5174
```

## Prerequisites

### If you use the published CLI

- `Node.js`
- `Git`
- an executable `claude` command

If you use `WSL`, `claude` also needs to be available in the target environment.

### If you run from source

- `Node.js`
- `pnpm`
- `Rust` toolchain
- platform-specific `Tauri 2` system dependencies
- `Git`
- an executable `claude` command

## Common Commands

### CLI

```bash
coder-studio start
coder-studio stop
coder-studio restart
coder-studio status
coder-studio logs -f
coder-studio open
coder-studio doctor
coder-studio config show
coder-studio config validate
coder-studio config root set /srv/coder-studio/workspaces
coder-studio config password set --stdin
coder-studio auth status
coder-studio auth ip list
```

For the full command reference, see `docs/development/cli.en.md`.

### Local Development

```bash
pnpm dev:stack
pnpm dev
pnpm dev:server
pnpm build:web
pnpm build:server
pnpm build:cli
```

## Useful Shortcuts

- `Cmd/Ctrl + K`: open quick actions
- `Cmd/Ctrl + N`: create a new workspace
- `Cmd/Ctrl + Shift + [`: previous workspace
- `Cmd/Ctrl + Shift + ]`: next workspace
- `Cmd/Ctrl + S`: save current file
- `F`: toggle Focus Mode
- `Alt/⌘ + D`: split the current agent pane vertically
- `Shift + Alt/⌘ + D`: split the current agent pane horizontally

## Public Deployment

For publicly reachable deployments, the current build supports:

- one-passphrase login
- `HttpOnly` session cookie
- a `24` hour IP block after `3` failed passphrase attempts within `10` minutes
- single-root server restrictions via `root.path`
- HTTP or HTTPS access, with HTTPS reverse proxy still recommended

Deployment details:

- Chinese deployment guide: `docs/deployment/README.md`
- English deployment guide: `docs/deployment/README.en.md`

## Developer Entry Points

If you are here to modify the product or build on top of it:

- frontend: `apps/web`
- server: `apps/server`
- CLI: `packages/cli`
- Chinese development docs: `docs/development/README.md`
- English development docs: `docs/development/README.en.md`

## Current Boundaries

The following should not be described as fully shipped user-facing functionality yet:

- multiple agent providers
- light theme
- full visual queueing UI
- a more complete archive / dispatch center
- explicit worktree management entry points
- fully closed-loop auto-suspend behavior

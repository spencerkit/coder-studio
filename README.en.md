# Coder Studio

[中文](README.md) | [English](README.en.md)

Coder Studio is a local-first developer workbench that currently runs as a local server with a web UI, bringing repositories, Claude-based coding agents, code browsing, Git review, and embedded terminals into one surface.

## What This Project Is

This project is not currently positioned as a generic multi-provider AI platform. It is a local workbench centered around real Git repositories, exposed by a local server runtime.

Its core job is to reduce context switching across the full workflow:

- attach a local or remote repository
- start and split parallel agent tasks
- inspect agent output while reading files and diffs
- run Git actions and shell commands without leaving the workspace

## Current Feature Set

- Workspace onboarding with `Remote Git` and `Local Folder`
- Execution targets: `Native`, plus `WSL` when available
- Parallel agent work via split panes
- Draft task input before agent startup
- First submitted input becomes the session title
- PTY-based terminal interaction after launch
- Code panel with file tree, file search, Monaco preview/edit, and save
- Git panel with Stage / Unstage / Discard / Commit
- Embedded multi-terminal panel
- Quick actions palette with `Cmd/Ctrl + K`
- Settings for Launch Command, Idle Policy, and language
- Bilingual UI: Chinese / English
- Public mode auth with one passphrase, session cookie, IP blocking, and a single `root.path` access root

## Prerequisites

Before running locally, prepare:

- `Node.js`
- `pnpm`
- `Rust` toolchain
- platform-specific `Tauri 2` system dependencies
- `Git`

To actually start agents, you also need:

- an executable launch command, defaulting to `claude`
- if you use `WSL`, the command must also be available in the target environment

## Install

```bash
pnpm install
```

## npm CLI Install

Once published, install it directly with:

```bash
npm install -g @spencer-kit/coder-studio
```

Available commands:

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
coder-studio help start
coder-studio help completion
eval "$(coder-studio completion bash)"
coder-studio completion install bash
coder-studio completion uninstall bash
```

For the detailed command reference, see `docs/development/cli.en.md`.

## Source / Template / Artifact Layers

The repository is organized into three layers:

- source
  - `apps/web`: frontend source
  - `apps/server`: Rust / Tauri server source
  - `packages/cli`: npm CLI package source and publish metadata
  - `packages/cli/src`: CLI TypeScript source
- templates
  - `templates/npm/platform-packages/*`: per-platform npm package templates
- build outputs
  - `.build/web/dist`: frontend build output
  - `.build/server/target`: Rust build output
  - `.build/cli`: compiled CLI output
  - `.build/stage/npm/*`: pre-publish staging packages
  - `.artifacts/`: tarballs, manifests, and checksums

This keeps maintainable source, publish templates, and generated artifacts out of the same directories.

## Run

### Option 1: Tauri shell development mode (recommended)

```bash
pnpm tauri dev
```

This is the closest workflow to the Tauri shell development experience.

### Option 2: Split frontend/server debugging

Terminal 1:

```bash
pnpm dev
```

Terminal 2:

```bash
pnpm dev:server
```

Current development ports:

- frontend: `http://127.0.0.1:5174`
- local server transport service: `http://127.0.0.1:41033`

The frontend dev server proxies `/api`, `/ws`, and `/health` to the local server.

## Build

Frontend build:

```bash
pnpm build
```

Server runtime build:

```bash
pnpm build:server
```

CLI build:

```bash
pnpm build:cli
```

Tauri shell build:

```bash
pnpm tauri build
```

## Public Deployment

For a publicly reachable deployment, the current build now includes:

- single-passphrase login
- `HttpOnly` session cookie
- a `24` hour IP block after `3` failed passphrase attempts within `10` minutes
- server-side single-root restrictions via `root.path`
- HTTPS-required login for non-local hosts

Deployment details are documented here:

- Chinese deployment guide: `docs/deployment/README.md`
- English deployment guide: `docs/deployment/README.en.md`

## Getting Started

1. Launch the app.
2. In the onboarding overlay, choose `Remote Git` or `Local Folder`.
3. Pick the execution target: `Native` or `WSL`.
4. Once the workspace opens, enter your first task in the draft input shown in the agent pane.
5. Press Enter. The app materializes a session, starts the agent, and uses the first input as the session title.
6. Split the current pane if you want to run another task in parallel.
7. Open the code panel to inspect files, edit content, or review diffs.
8. Open the Git panel for Stage / Unstage / Discard / Commit.
9. Open the terminal panel to run shell commands.

## Useful Shortcuts

- `Cmd/Ctrl + K`: open quick actions
- `Cmd/Ctrl + N`: create a new workspace
- `Cmd/Ctrl + Shift + [`: previous workspace
- `Cmd/Ctrl + Shift + ]`: next workspace
- `Cmd/Ctrl + S`: save current file
- `F`: toggle Focus Mode
- `Alt/⌘ + D`: split the current agent pane vertically
- `Shift + Alt/⌘ + D`: split the current agent pane horizontally

## Current Boundaries

The following should not be described as fully shipped user-facing functionality yet:

- multiple agent providers
- light theme
- full queue / dispatch board UI
- full archive center UI
- explicit worktree management entry points
- fully closed-loop auto-suspend behavior

## Documentation

Product docs:

- Chinese PRD: `docs/PRD.md`
- English PRD: `docs/PRD.en.md`

Development docs:

- Chinese index: `docs/development/README.md`
- Chinese deployment guide: `docs/deployment/README.md`
- Chinese CLI manual: `docs/development/cli.md`
- Chinese npm packaging guide: `docs/development/npm-release.md`
- English index: `docs/development/README.en.md`
- English deployment guide: `docs/deployment/README.en.md`
- English CLI manual: `docs/development/cli.en.md`
- English npm packaging guide: `docs/development/npm-release.en.md`
- Architecture: `docs/development/architecture.en.md`
- Frontend state: `docs/development/frontend-state.en.md`
- Tauri commands: `docs/development/tauri-commands.en.md`

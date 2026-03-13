# Coder Studio

Coder Studio is a desktop workbench for running coding agents against local or remote repositories.
It combines:

- multi-session agent orchestration
- Git and worktree visibility
- embedded terminals
- file preview and diff inspection
- task queueing with operator controls

## Stack

- React + Vite
- Tauri 2
- Rust backend commands for Git, PTY terminals, and agent process control
- Playwright for browser-mode smoke tests

## Run

Install frontend dependencies:

```bash
pnpm install
```

Run the browser version:

```bash
pnpm dev
```

Run the desktop app:

```bash
pnpm tauri dev
```

Run Playwright smoke tests:

```bash
pnpm test:e2e
```

## Product Shape

The product is designed around an operator workflow:

1. Connect a repository.
2. Launch one or more agent sessions.
3. Queue work, inspect progress, and manually complete or stop tasks when needed.
4. Review file diffs, shell output, and worktree state without leaving the workspace.

The browser version provides a fallback interaction model for UI development and testing.

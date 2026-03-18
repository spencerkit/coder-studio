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

Run the frontend dev server:

```bash
pnpm dev
```

Run the backend dev server:

```bash
pnpm dev:backend
```

Development uses fixed ports:

- frontend: `http://127.0.0.1:5174`
- backend: `http://127.0.0.1:41033`

The Vite dev server proxies `/api`, `/ws`, and `/health` to the backend.

Run the Tauri dev process:

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

In production, a single backend service serves the built frontend assets and API endpoints from the same origin.

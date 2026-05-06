# Coder Studio

> Deploy once, code everywhere.
>
> Deploy your coding workspace once, then keep working anywhere.

[中文说明](README.zh-CN.md)

Coder Studio lets you launch an AI coding workspace on your machine and keep using it from wherever you are. Claude Code or Codex, files, Git, and terminal all stay in one browser-based workspace, so your workflow is no longer pinned to one desk or one device.

Start a task in the office, check progress on your phone during the commute, review changes from a tablet, and continue on a laptop later. Same workspace, same context, no environment handoff.

![Workspace](docs/help/assets/screenshot-workspace.png)

## Why Coder Studio

- **Deploy once, continue anywhere**: start the service once and move between devices and contexts without breaking your flow
- **One workspace across devices**: not just remote logs, but the same workspace with Agent, code, Git, and terminal
- **Agent + Code + Git + Terminal in one place**: less context switching between CLI, editor, diff tools, and shell
- **Works with Claude Code and Codex**: choose the right Agent per task and run sessions side by side
- **Runs locally, keeps your data under your control**: the service runs on your machine, without relying on a third-party cloud IDE

## What Problem It Solves

Traditional AI coding workflows are often tied to the one machine where the CLI is running:

- The Agent is running, but you still have to stay near the original device
- Changing locations makes it hard to keep watching context and execution state
- A phone may show notifications, but not the full coding workspace
- Switching devices usually means taking over the environment again instead of simply continuing the work

Coder Studio turns that into:

`Deploy once, code everywhere.`

## Quick Start

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

Then just:

1. Click **Open Workspace** in the browser
2. Choose your project directory and create a Claude or Codex session
3. Start working with the Agent while viewing files, Git changes, and terminal output in the same workspace

> You can open the UI and browse files and terminals before installing a provider CLI. See the [Provider Setup Guide](docs/help/providers.md) for details.

## How You Can Use It

| Scenario | What you do |
|----------|-------------|
| Start work in the office | Launch the service, open the project, create a Claude or Codex session, and let the Agent begin |
| Check progress during a commute | Open the same workspace on your phone and review Agent output, session status, and Git changes |
| Review changes while away from your desk | Use a tablet to browse files, inspect diffs, and confirm terminal output |
| Continue later on another device | Reconnect to the same workspace and keep going with the same context |
| Share progress with teammates | Let others on the same local network open the workspace in a browser and view the current state |

## What You Can Do

- Run multiple Agent sessions inside one workspace
- Watch the file tree, editor, and Git diff while the Agent is working
- Open a Shell terminal to validate the Agent's output yourself
- Use the full multi-panel desktop layout and keyboard shortcuts
- Monitor workspace and session progress from a phone or tablet
- Manage themes, language, shortcuts, and provider arguments from Settings

## Works Across Devices

Coder Studio runs in a standard browser and does not require a desktop client:

- **Desktop**: best for full coding sessions, editing files, reviewing diffs, and managing panels
- **Tablet**: useful for lightweight review, tracking Agent progress, and browsing project state
- **Phone**: useful for checking session status, terminal output, and workspace changes on the go

The same service URL can be opened from different devices, and the interface adapts to the screen automatically.

**Desktop Workspace**

![Desktop Workspace](docs/help/assets/screenshot-pc.png)

**Mobile Workspace**

![Mobile Workspace](docs/help/assets/screenshot-mobile.png)

## Core Capabilities

- **Workspace**: a local project directory with its own files, terminals, Git state, and sessions
- **Session**: an independent Claude or Codex Agent run inside a workspace
- **Terminal**: both Shell terminals and Agent terminals are supported
- **Git View**: inspect branches, changed files, and diffs directly inside the workspace
- **Settings**: manage themes, language, shortcuts, and provider startup arguments in one place

## Documentation

- [Quick Start](docs/help/quick-start.md) - From install to first launch
- [App Overview](docs/help/app-overview.md) - Core concepts and capabilities
- [Provider Setup](docs/help/providers.md) - Install and configure Claude Code / Codex CLI
- [Desktop Guide](docs/help/desktop-guide.md) - Desktop interface and workflows
- [Mobile Guide](docs/help/mobile-guide.md) - Phone and tablet usage
- [Common Workflows](docs/help/workflows.md) - Task-oriented usage patterns
- [Troubleshooting](docs/help/troubleshooting.md) - Common issues and fixes
- [CLI Reference](docs/help/cli.md) - Command-line reference

## Installation Requirements

| Requirement | Notes |
|-------------|-------|
| Node.js >= 24.0.0 | Required to run the Coder Studio service |
| Claude Code CLI or OpenAI Codex CLI | Required to create Agent sessions; files and terminals can still be used before installing a provider |

## Contributor Notes

The following section is for repository contributors. Regular users can start with the quick start and product docs above.

### Local Development

```bash
git clone https://github.com/spencerkit/coder-studio.git
pnpm install
pnpm dev
```

### Common Commands

```bash
pnpm acceptance:phase1
pnpm build:cli
pnpm lint
pnpm lint:fix
pnpm format
pnpm check
```

### Tech Stack

- Frontend: React + Vite + Jotai
- Backend: Fastify + WebSocket
- Terminal: xterm.js + node-pty
- Editor: Monaco Editor
- Storage: SQLite (`node:sqlite`)

### Development Docs

- [PRD](docs/PRD.zh-CN.md)
- [Design Spec](docs/superpowers/specs/2026-04-13-coder-studio-design.md)
- [More Docs](docs/)

## License

MIT

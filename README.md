<div align="center">

<img src="docs/assets/logo.png" alt="Coder Studio Logo" width="128" height="128">

# Coder Studio

**Coder Studio, made for vibe coding.**

An agentic workspace for real development. Run, inspect, and supervise coding agents with terminals, files, Git, sessions, and review in one browser workspace.

Built-in support today: Claude Code and Codex. Your code and runtime stay on your machine.

[![npm version](https://img.shields.io/npm/v/@spencer-kit/coder-studio.svg)](https://www.npmjs.com/package/@spencer-kit/coder-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.0.0-green.svg)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/spencerkit/coder-studio?style=social)](https://github.com/spencerkit/coder-studio/stargazers)

[View Workspace](docs/help/assets/screenshot-desktop-workspace-full.png) · [Quick Start](#quick-start) · [Star on GitHub](https://github.com/spencerkit/coder-studio)

[中文说明](README.zh-CN.md) | [Documentation](docs/help/quick-start.md)

</div>

[![Workspace Preview](docs/help/assets/screenshot-desktop-workspace-full.png)](docs/help/assets/screenshot-desktop-workspace-full.png)

<div align="center">Preview the full workspace layout built for agent runs, review, supervision, and device switching.</div>

## Why It Feels Different

- **One browser workspace for real agent work** — Keep terminals, files, Git, sessions, and review in one place.
- **Built for device switching** — Start on desktop, continue on tablet, and check progress from your phone.
- **Keep control local** — Your code and runtime stay on your machine.

## Why Coder Studio?

Vibe coding agents are fast, but real development still gets fragmented:

- the agent runs in one terminal
- files and diffs live in another editor
- verification happens in separate shell tabs
- long-running tasks are hard to monitor away from your desk
- mobile access usually means SSH or remote desktop

Coder Studio turns that scattered workflow into one local browser workspace.

| Pain | Without Coder Studio | With Coder Studio |
|------|----------------------|-------------------|
| Long agent tasks | Watch a terminal or come back later and reconstruct context | Keep sessions, terminal output, files, and Git changes visible in one workspace |
| Cross-device work | Use SSH, remote desktop, or rebuild context on another machine | Reopen the same local workspace from desktop, tablet, or phone |
| Reviewing AI changes | Jump between terminal, editor, and Git tools | Inspect files and diffs beside the agent session |
| Multiple agents | Manage separate terminal windows and histories | Run built-in Claude Code and Codex sessions side by side in one workspace today |
| Local-first control | Move work into a hosted IDE or cloud VM | Keep the runtime and project files on your own machine |

## Quick Start

```bash
# Install globally
npm install -g @spencer-kit/coder-studio

# Launch the workspace
coder-studio open
```

Your browser opens automatically. Select your project folder and start working with Claude Code or OpenAI Codex today.

> **No AI CLI installed yet?** You can still browse files and use the terminal. Install Claude Code or Codex later when needed.

---

## 💡 Use Cases

### Cross-Device Development

- Start an Agent task at the office, check progress on your phone during commute
- Review code changes on a tablet without opening your laptop
- Continue work from a home computer with zero setup

### Long-Running AI Workflows

- Let Supervisor push multi-step tasks toward an objective without constant babysitting
- Check evaluation cycles and follow-up actions from your phone instead of watching terminal output
- Reduce repetitive prompting and manual coordination during long agent runs

### AI-Assisted Coding

- Run Claude Code and Codex sessions side by side today
- Keep terminal, editor, Git, and supervisor state in one unified interface
- Resume active AI work from another device without rebuilding context

---

## 📱 Cross-Device Experience

| Device | Best For |
|--------|----------|
| 🖥️ **Desktop** | Full coding sessions, file editing, diff review, panel management |
| 📱 **Tablet** | Code review, Agent progress tracking, file browsing |
| 📲 **Phone** | Quick status checks, terminal output monitoring, session viewing |

The same workspace URL works across all devices — interface adapts automatically.

**Desktop Interface**

![Desktop Workspace](docs/help/assets/screenshot-pc.png)

**Mobile Interface**

![Mobile Workspace](docs/help/assets/screenshot-mobile.png)

---

## 🛠️ Feature Overview

| Feature | Description |
|---------|-------------|
| **Cross-Device Workspace** | Reopen the same coding environment from desktop, tablet, or phone without rebuilding context |
| **Supervisor Loops** | Run objective-driven evaluation and follow-up cycles for long AI tasks with less manual babysitting |
| **Built-in Agent Providers** | Use Claude Code and Codex inside one workspace today instead of splitting your workflow across separate tools |
| **Unified Terminal, Files, and Git** | Keep PTY terminals, Monaco editing, diffs, and changed files in one browser UI |
| **Reviewable AI Work** | Inspect changed files and diffs beside the session before trusting the result |
| **Responsive Workspace UI** | Use layouts tuned for desktop, tablet, and mobile instead of a desktop-only interface squeezed onto small screens |
| **Session Continuity** | Resume active sessions and keep AI work visible across device switches |
| **Local Runtime Control** | Keep code and runtime on your machine instead of relying on a cloud IDE |

---

## 📋 Requirements

| Dependency | Version | Notes |
|------------|---------|-------|
| Node.js | ≥ 24.0.0 | Required for running Coder Studio |
| Claude Code CLI | Latest | Optional — for Claude Agent sessions |
| OpenAI Codex CLI | Latest | Optional — for Codex Agent sessions |

---

## 📚 Documentation

| Resource | Description |
|----------|-------------|
| [Quick Start Guide](docs/help/quick-start.md) | Installation to first workspace |
| [App Overview](docs/help/app-overview.md) | Core concepts and features |
| [Provider Setup](docs/help/providers.md) | Claude Code / Codex CLI installation |
| [Desktop Guide](docs/help/desktop-guide.md) | PC interface and shortcuts |
| [Mobile & Remote Access Guide](docs/help/mobile-guide.md) | Phone / tablet usage, LAN access, Tailscale/ngrok/Cloudflare Tunnel |
| [Common Workflows](docs/help/workflows.md) | Task-based tutorials |
| [Troubleshooting](docs/help/troubleshooting.md) | FAQ and known issues |
| [CLI Reference](docs/help/cli.md) | Command-line options |
| [GitHub Wiki Source](docs/wiki/README.md) | Wiki source pages and publish flow |
| [AI Coding Terms](docs/wiki/AI-Coding-Terms.md) | Vibe coding, agentic harnesses, eval harnesses, and where Coder Studio fits |

---

## 👥 Who Should Use Coder Studio

- **Developers Running Coding Agents** — Want terminals, files, Git, sessions, and review in one place
- **Multi-Device Developers** — Switch between office, home, and mobile devices frequently
- **Developers Running Long AI Tasks** — Want Supervisor to keep multi-step work moving without constant babysitting
- **Privacy-Conscious Developers** — Want code to stay on local machine, not cloud IDE

---

## 🔮 Roadmap

- [ ] Web-based terminal streaming optimization
- [ ] Session replay and history navigation
- [ ] Multi-workspace management
- [ ] Plugin system for custom integrations
- [ ] Cloud sync for workspace preferences

---

## 🤝 Contributing

We welcome contributions! See [Contributing Guide](CONTRIBUTING.md) for details.

### Local Development

```bash
git clone https://github.com/spencerkit/coder-studio.git
pnpm install
pnpm dev
```

### Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React, Vite, Jotai |
| Backend | Fastify, WebSocket |
| Terminal | xterm.js, node-pty |
| Editor | Monaco Editor |
| Storage | SQLite (node:sqlite) |

### Development Docs

- [PRD](docs/PRD.zh-CN.md)
- [Design Spec](docs/superpowers/specs/2026-04-13-coder-studio-design.md)
- [More Docs](docs/)

---

## 📄 License

MIT License — see [LICENSE](LICENSE) for details.

---

## 🔍 Keywords

`ai coding assistant` `browser ide` `claude code` `codex` `remote development` `web-based ide` `self-hosted ide` `cross-device coding` `ai agent workspace` `local-first development` `mobile coding` `tablet coding` `developer tools` `terminal in browser` `git web interface` `monaco editor` `websocket terminal` `ai pair programming` `coding anywhere` `cloud ide alternative`

<div align="center">

<img src="docs/assets/logo.png" alt="Coder Studio Logo" width="128" height="128">

# Coder Studio

**A browser-based AI coding workspace for developers who move between desktop, tablet, and phone.**

Run Claude Code and Codex in one workspace. Keep your terminal, files, Git view, and AI sessions available from any device.

[![npm version](https://img.shields.io/npm/v/@spencer-kit/coder-studio.svg)](https://www.npmjs.com/package/@spencer-kit/coder-studio)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D24.0.0-green.svg)](https://nodejs.org/)
[![GitHub Stars](https://img.shields.io/github/stars/spencerkit/coder-studio?style=social)](https://github.com/spencerkit/coder-studio/stargazers)

[View Workspace](docs/help/assets/screenshot-desktop-workspace-full.png) · [Quick Start](#quick-start) · [Star on GitHub](https://github.com/spencerkit/coder-studio)

[中文说明](README.zh-CN.md) | [Documentation](docs/help/quick-start.md)

</div>

[![Workspace Preview](docs/help/assets/screenshot-desktop-workspace-full.png)](docs/help/assets/screenshot-desktop-workspace-full.png)

<div align="center">Preview the full workspace layout built for AI coding, supervision, and device switching.</div>

## Why It Feels Different

- **One browser workspace for AI coding** — Keep terminal, files, Git, and AI sessions in one place.
- **Built for device switching** — Start on desktop, continue on tablet, and check progress from your phone.
- **Objective-driven multi-step orchestration** — Let Supervisor steer long-running AI tasks so you do not have to babysit every turn, reduce repetitive manual prompting, and get more consistent outcomes.

## Quick Start

```bash
# Install globally
npm install -g @spencer-kit/coder-studio

# Launch the workspace
coder-studio open
```

Your browser opens automatically. Select your project folder and start working with Claude Code or OpenAI Codex.

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

- Run Claude Code and Codex sessions side by side
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
| **Claude Code + Codex** | Use both agent CLIs inside one workspace instead of splitting your workflow across separate tools |
| **Unified Terminal, Editor, and Git** | Keep PTY terminals, Monaco editing, diffs, and changed files in one browser UI |
| **Responsive Workspace UI** | Use layouts tuned for desktop, tablet, and mobile instead of a desktop-only interface squeezed onto small screens |
| **Session Continuity** | Resume active sessions and keep AI work visible across device switches |
| **Local-First Runtime** | Keep code and runtime on your machine instead of relying on a cloud IDE |

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
| [Mobile Guide](docs/help/mobile-guide.md) | Phone / tablet usage |
| [Common Workflows](docs/help/workflows.md) | Task-based tutorials |
| [Troubleshooting](docs/help/troubleshooting.md) | FAQ and known issues |
| [CLI Reference](docs/help/cli.md) | Command-line options |

---

## 👥 Who Should Use Coder Studio

- **AI Coding Power Users** — Daily Claude Code / Codex users who want better session management
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

# Quick Start

This guide gets Coder Studio installed, opened, and connected to a first workspace.

## Requirements

- Node.js 24 or newer
- Optional: Claude Code CLI for Claude sessions
- Optional: OpenAI Codex CLI for Codex sessions

Coder Studio can still open files and terminals without an AI CLI installed.

## Install

```bash
npm install -g @spencer-kit/coder-studio
```

## Open Coder Studio

```bash
coder-studio open
```

The browser opens automatically. If it does not, run:

```bash
coder-studio status
```

Open the displayed local URL in your browser.

## Open A Project

1. Click the workspace picker.
2. Select your project folder.
3. Wait for the file tree, Git panel, and terminal area to load.

## Start An AI Session

1. Open the Agent panel.
2. Choose Claude or Codex.
3. Create a session.
4. Type a task into the session terminal.

If the provider is missing, install the matching CLI and try again.

## Useful Commands

```bash
coder-studio status
coder-studio logs
coder-studio config
coder-studio stop
```

To change the port:

```bash
coder-studio config --port 8080
coder-studio serve --restart
```

To set a password before LAN or remote access:

```bash
coder-studio config --password <strong-password>
coder-studio serve --restart
```

## Next Steps

- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Common Workflows](Common-Workflows.md)
- [Troubleshooting](Troubleshooting.md)

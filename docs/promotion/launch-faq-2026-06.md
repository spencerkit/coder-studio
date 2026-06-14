# Growth Launch FAQ

## What is Coder Studio?

Coder Studio is a self-hosted browser workspace for AI coding agent workflows. It brings agent sessions, terminals, files, Git diff review, supervision, work analysis, and cross-device continuation into one workspace.

## Is it a cloud IDE?

No. It runs on your machine and opens local project directories. Remote access is something you configure through LAN, Tailscale, ngrok, Cloudflare Tunnel, or another network path. Set a strong password and authentication before exposing it beyond your local machine.

## Is it a VS Code replacement?

No. It is focused on AI coding agent workflows: running agents, watching progress, reviewing changes, and continuing across devices.

## Does it include AI models or Provider CLIs?

No. You install Provider CLIs separately, such as Claude Code, Codex, Gemini CLI, Cursor Agent, or OpenCode. Coder Studio detects and launches those local commands.

## Does code leave my machine?

Coder Studio itself is not a hosted code service. Provider CLIs may send prompts, code context, terminal output, file snippets, or other task data according to the provider's own behavior and configuration.

## What is mobile good for?

Mobile is best for checking progress, reading output, browsing files, reviewing diffs, and deciding whether to intervene. Desktop remains the best environment for first setup and heavy editing.

## Why require Node.js 24?

The current package targets the runtime used by the server, CLI, and bundled dependencies. Users should check `node --version` before installing.

## What feedback is most useful?

Installation failures, Provider CLI detection issues, first agent run confusion, mobile setup problems, and real AI coding workflows that still feel awkward.

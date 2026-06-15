# @spencer-kit/coder-studio

Self-hosted browser workspace for AI coding agents, review, supervision, and cross-device continuation.

Coder Studio runs on your machine and opens your local projects in a browser workspace. It brings popular coding-agent CLIs, terminals, files, Git diff review, Supervisor loops, Work Analysis, and Skills into one place.

## Install

```bash
npm install -g @spencer-kit/coder-studio
```

Coder Studio requires Node.js 24 or newer.

## Quick Start

```bash
coder-studio open
```

Then:

1. Open a local repository.
2. Start an agent session. For a first trial, Claude or Codex is the recommended path.
3. Ask the agent for a small change.
4. Review the changed files and Git diff beside the session.
5. Reopen the same workspace from another device when you want to monitor progress.

## Provider CLIs

Coder Studio does not bundle AI models. Install the local CLI for the agent you want to run:

```bash
npm install -g @anthropic-ai/claude-code
npm install -g @openai/codex
npm install -g @google/gemini-cli
npm install -g opencode-ai
```

After installation, verify:

```bash
claude --version
codex --version
gemini --version
opencode --version
```

Cursor Agent uses the Cursor CLI install flow and exposes the `agent` command. See the Provider docs for the full built-in provider list and custom-provider notes.

## More Information

- GitHub README: https://github.com/spencerkit/coder-studio#readme
- English Quick Start: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/Quick-Start.md
- First Agent Run: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/First-Agent-Run.md
- Security and Privacy: https://github.com/spencerkit/coder-studio/blob/main/docs/wiki/Security-and-Privacy.md
- 中文帮助中心: https://github.com/spencerkit/coder-studio/blob/main/docs/help/README.md

## What It Is Not

- Not a cloud IDE.
- Not a VS Code replacement.
- Not an AI model provider.
- Not a promise that phone screens replace desktop coding.

Coder Studio is a workbench around local repositories, local shells, and the AI coding agent CLIs you choose to install.

## License

MIT

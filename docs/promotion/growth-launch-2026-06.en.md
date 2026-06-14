# Coder Studio English Launch Copy

## Show HN Title

Show HN: Coder Studio - a self-hosted browser workspace for AI coding agents

## Short Description

Coder Studio brings Claude Code, Codex, terminals, files, Git diff review, supervision, and cross-device continuation into one self-hosted browser workspace.

## Long Post Draft

I built Coder Studio because terminal-only AI coding gets scattered once the agent output turns into real project work.

The agent runs in one terminal, files are in an editor, diffs are in another tool, and long tasks require repeatedly checking whether anything stalled. If you leave the machine where the CLI is running, the workflow gets even more awkward.

Coder Studio is a self-hosted browser workspace around local AI coding agent CLIs.

It brings together:

- built-in session support for Claude Code, Codex, Gemini CLI, Cursor Agent, and OpenCode
- preset/custom-provider oriented workflows for tools such as Aider
- local terminals
- file tree and Monaco editor
- Git status, changed files, and diff review
- Supervisor loops for long tasks
- Work Analysis for reviewing what happened over time
- Skills management for reusable agent workflows
- desktop, tablet, and phone access to the same workspace

Install:

```bash
npm install -g @spencer-kit/coder-studio
coder-studio open
```

A good first trial:

1. Open a local repository.
2. Start an agent session. For a first trial, Claude or Codex is the recommended path.
3. Ask the agent for a small README or UI-copy change.
4. Review the changed files and Git diff beside the session.
5. Reopen the same workspace from a phone or tablet to monitor progress.

What it is not:

- not a cloud IDE
- not a VS Code replacement
- not an AI model provider
- not a promise that phone screens replace desktop coding

Coder Studio itself is not a hosted code service and opens local repositories. Provider CLIs may send prompts, code context, terminal output, file snippets, or other task data according to their own behavior and configuration.

GitHub:

https://github.com/spencerkit/coder-studio

npm:

https://www.npmjs.com/package/@spencer-kit/coder-studio

I would especially like feedback from people running long Claude Code or Codex tasks, reviewing agent diffs frequently, or switching between desktop and mobile devices during AI coding work.

## Reddit Notes

- For `r/selfhosted`, lead with local-first and remote access boundaries.
- For AI coding communities, lead with Claude Code / Codex workflow pain.
- Avoid posting the same text to many communities on the same day.
- Answer security and Provider CLI questions directly.

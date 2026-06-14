# First Agent Run

This guide walks through the first successful Coder Studio agent workflow: open a project, start a recommended first-run provider, watch the session output, and review the resulting Git diff.

## What This Guide Solves

Use this to verify that Coder Studio can support a real AI coding loop, not just launch the UI.

## Prerequisites

- Coder Studio installed: `npm install -g @spencer-kit/coder-studio`
- Node.js 24 or newer: `node --version`
- At least one Provider CLI installed. For the first trial, Claude Code or Codex is recommended:
  - Claude Code: `npm install -g @anthropic-ai/claude-code`
  - Codex: `npm install -g @openai/codex`
- The Provider CLI works in a normal terminal:
  - `claude --version`
  - `codex --version`

## 1. Launch Coder Studio

```bash
coder-studio open
```

Your browser should open automatically. If it does not, run:

```bash
coder-studio status
```

Then manually open the local URL printed by the command.

## 2. Open A Local Project

On the welcome screen, choose **Open Workspace** and select a small repository you can safely test with.

For the first run, prefer:

- a personal repository with a README
- a Git repository with a clean working tree
- a project that does not contain production secrets

## 3. Start A Recommended First-Run Provider

Inside the workspace, create a new session and choose a detected provider. For the first trial, Claude or Codex is the recommended path because the setup and troubleshooting docs are the most detailed.

If the provider is missing:

1. Install the CLI in your normal terminal.
2. Verify it with `claude --version` or `codex --version`.
3. Refresh Coder Studio or reopen the workspace.

## 4. Use A Safe First Task

Do not start with a large refactor. Use a small documentation task first:

```text
Please read the README and add a short "Who this is for" section. Keep the change to 1-2 paragraphs and do not modify source code.
```

This is a good first test because:

- the change is small
- the Git diff is easy to inspect
- the result is easy to revert

## 5. Review Output And Changes

While the session runs, watch the agent output. When it finishes:

1. Open the Git view.
2. Inspect changed files.
3. Open the diff.
4. Decide whether the result matches your request.

You can ask the same session for a follow-up change, edit the files yourself, or discard the change with Git.

## 6. Check Progress From Mobile

For phone or tablet access, read [Mobile and Remote Access](Mobile-and-Remote-Access.md).

Mobile is best for:

- checking whether an agent is still running
- reading terminal output
- browsing files and diffs
- monitoring long tasks

Use desktop for the first full trial. Mobile is a continuation and review surface, not the main heavy editing environment.

## FAQ

**Can I try Coder Studio without Claude or Codex installed?**
Yes. You can open workspaces, browse files, and use terminals, but you cannot start a provider's agent session until its CLI is installed.

**I installed a provider but Coder Studio cannot find it. What now?**
Run `which <provider-command>` and `<provider-command> --version` in a normal terminal. If the command is missing, the install directory is probably not in PATH. See [Agent Providers](Agent-Providers.md).

**What if the agent makes a bad change?**
Review the Git diff first. You can edit the file, ask for a follow-up, or discard the change with Git.

## Next Steps

- [Agent Providers](Agent-Providers.md)
- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Troubleshooting](Troubleshooting.md)
- [Common Workflows](Common-Workflows.md)

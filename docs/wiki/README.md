# GitHub Wiki Source

This directory is the source of truth for the GitHub Wiki. Keep these files in the main repository so documentation changes can be reviewed with code changes.

## Publish

```bash
pnpm publish:wiki
pnpm publish:wiki -- --push
```

Default behavior is a dry run. Real publication requires `--push`.

## Authentication

- default: existing git https credentials
- optional: `GITHUB_TOKEN`
- optional override: `--remote git@github.com:spencerkit/coder-studio.wiki.git`

## First-Time Setup

GitHub only creates `<repo>.wiki.git` after the repository Wiki is initialized on GitHub. If clone fails with repository not found, open the GitHub Wiki once and create the initial wiki before retrying.

## Page Map

- [Home](Home.md)
- [Quick Start](Quick-Start.md)
- [Why Coder Studio](Why-Coder-Studio.md)
- [What Is an Agentic Workspace](What-is-an-Agentic-Workspace.md)
- [Agent Providers](Agent-Providers.md)
- [Coder Studio vs Warp](Coder-Studio-vs-Warp.md)
- [AI Coding Terms](AI-Coding-Terms.md)
- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Security and Privacy](Security-and-Privacy.md)
- [Supervisor](Supervisor.md)
- [Common Workflows](Common-Workflows.md)
- [Troubleshooting](Troubleshooting.md)
- [FAQ](FAQ.md)

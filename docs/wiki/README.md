# GitHub Wiki Source

This directory contains source pages for the GitHub Wiki. Keep these files in the main repository so documentation changes can be reviewed with code changes.

## Suggested Sync Flow

GitHub Wikis are separate git repositories. To publish these pages:

```bash
git clone git@github.com:spencerkit/coder-studio.wiki.git /tmp/coder-studio.wiki
rsync -av --delete docs/wiki/ /tmp/coder-studio.wiki/
cd /tmp/coder-studio.wiki
git status
git add .
git commit -m "docs: update wiki"
git push
```

Review the diff before pushing, especially when using `--delete`.

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

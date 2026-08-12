# Known Limitations

This page sets expectations for the current Coder Studio release.

## What This Page Solves

Coder Studio is easiest to understand when its boundaries are explicit. It is not a cloud IDE, not a VS Code replacement, and not an AI model provider.

## System Requirements

- Node.js 24 or newer is required.
- Coder Studio is installed as a global npm package.
- Agent sessions depend on local Provider CLIs installed on your machine.

## Provider Boundary

Coder Studio does not bundle Claude, Codex, or other models. It launches and manages local Provider CLIs inside the workspace.

Without a Provider CLI installed, you can:

- open a workspace
- browse files
- use terminals

You cannot create that provider's agent session until the CLI is installed and visible in PATH.

## Mobile Boundary

Mobile is best for monitoring and review, not heavy editing.

Good mobile use cases:

- check long-running task progress
- read agent output
- browse files
- inspect Git diffs
- decide whether desktop intervention is needed

## Remote Access Boundary

Coder Studio is safest on localhost or trusted networks. Cross-device and public access require your own network and authentication setup.

Before remote access:

```bash
coder-studio config --password <strong-password>
coder-studio config --host 0.0.0.0
coder-studio serve --restart
```

Do not expose Coder Studio to the public internet without authentication.

## Updates

Coder Studio presents one product update plan, but the installed components and update authority
depend on how the application is running:

- Desktop Shell and Product Runtime versions are intentionally independent. The normal Desktop
  product version is the Product Runtime version; the global CLI product version is the published
  npm package version.
- Engine ABI is compatibility information for diagnostics. It is not another product version.
- The Windows Desktop application manages both native Windows and WSL Product Runtime updates. A
  WSL environment never installs or updates the Desktop-managed Runtime through npm.
- A globally installed npm CLI keeps its own check, exact-version install, restart, and recovery
  workflow. Source, bundled, or otherwise unsupported CLI environments are read-only.
- A browser connected to a Desktop sidecar is also read-only for updates. Open the installed Coder
  Studio Desktop application to download or install that plan.
- Release time is displayed only when it comes from signed Desktop release metadata or npm registry
  metadata. Legacy, offline, or missing metadata remains explicitly unknown; Coder Studio does not
  substitute a check time or file modification time.
- Product Runtime activation can roll back automatically when its startup health check fails. An
  Electron/NSIS Shell installation does not promise automatic rollback, so release promotion also
  requires compatibility with the previous Runtime and a real installed-upgrade acceptance run.
- Windows x64 and WSL Linux x64 are the initial mutable Desktop targets. Other Desktop feeds remain
  disabled until they have equivalent installed-upgrade lanes.

## Not The Focus Of This Launch

The current launch does not focus on:

- hosted cloud workspaces
- team permission systems
- phone-first full coding
- plugin marketplace
- session replay
- cloud preference sync

These may evolve later, but they are not required to understand the first Coder Studio workflow.

## Next Steps

- [Quick Start](Quick-Start.md)
- [First Agent Run](First-Agent-Run.md)
- [Mobile and Remote Access](Mobile-and-Remote-Access.md)
- [Troubleshooting](Troubleshooting.md)

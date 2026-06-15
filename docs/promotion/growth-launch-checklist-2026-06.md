# Growth Launch Checklist - 2026-06

Use this checklist before posting broadly in English communities.

## Landing Pages

- [ ] `README.md` explains the product in 30 seconds.
- [ ] `README.md` links English users to `docs/wiki/*`.
- [ ] `README.zh-CN.md` links Chinese users to `docs/help/*`.
- [ ] `packages/cli/README.md` explains install, first run, Provider CLIs, and boundaries.
- [ ] `packages/cli/package.json` description and keywords match the launch positioning.

## First Trial

- [ ] Quick Start explains install and `coder-studio open`.
- [ ] First Agent Run explains opening a repo, starting a recommended first provider, and reviewing Git diff.
- [ ] Provider docs explain install, `which`, `--version`, and PATH checks.
- [ ] Troubleshooting covers Node 24, service status, logs, Provider CLI, port, browser, auth, and mobile access.

## Trust And Boundaries

- [ ] Security docs explain local-first behavior and Provider CLI data boundaries.
- [ ] Known Limitations explain Node 24, Provider CLI dependency, mobile limits, and remote access responsibility.
- [ ] Mobile docs describe monitoring and review as the primary phone/tablet use case.
- [ ] README avoids claiming Coder Studio is a cloud IDE, VS Code replacement, AI provider, or full mobile coding replacement.

## Feedback Intake

- [ ] `CONTRIBUTING.md` exists.
- [ ] Installation issue template exists.
- [ ] Provider setup issue template exists.
- [ ] Feature request template exists.
- [ ] Workflow showcase template exists.

## Promotion Materials

- [ ] Chinese long-form post is ready.
- [ ] English launch post is ready.
- [ ] Social posts are ready.
- [ ] Launch FAQ is ready.
- [ ] Show HN title is ready.

## Manual Trial

- [ ] Install from npm in a clean shell.
- [ ] Run `coder-studio open`.
- [ ] Open a local repository.
- [ ] Start one recommended first-run provider session.
- [ ] Ask for a small documentation change.
- [ ] Review changed files and Git diff.
- [ ] Open the workspace from a second browser size or device.
- [ ] Record any confusion in the feedback log.

## Verification Commands

```bash
git diff --check
pnpm ci:lint
pnpm ci:test
pnpm ci:build
```

Before public English launch, prefer:

```bash
pnpm ci:verify
```

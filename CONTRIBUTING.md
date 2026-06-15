# Contributing

Thanks for helping improve Coder Studio.

Coder Studio is a self-hosted browser workspace for AI coding agent workflows. The most useful early feedback is concrete: what you tried, what happened, what you expected, and where the first-run path became unclear.

## Good First Feedback

Please open an issue when you hit:

- installation problems
- Provider CLI detection problems
- first agent session confusion
- mobile or remote access setup issues
- documentation that does not match the current UI
- a workflow that feels promising but needs one missing capability

## Before Filing An Issue

Run these commands when relevant:

```bash
node --version
coder-studio version
coder-studio status
coder-studio logs
which claude
which codex
claude --version
codex --version
```

Do not paste secrets, API keys, private source code, or full logs that contain sensitive data.

## Development Setup

```bash
git clone https://github.com/spencerkit/coder-studio.git
cd coder-studio
pnpm install
pnpm dev
```

## Verification

Before handing off code changes, run the relevant command:

```bash
pnpm ci:verify
```

For docs-only changes, at least run:

```bash
git diff --check
pnpm ci:lint
```

## Pull Request Expectations

- Keep changes focused.
- Do not bundle unrelated refactors.
- Include screenshots or short recordings for UI changes.
- Update docs when behavior changes.
- Mention what verification you ran.

## Security

Do not report sensitive security issues in public issues if they include exploitable details. Open a minimal public issue asking for a private contact path, or contact the maintainer through the repository owner profile.

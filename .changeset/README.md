# Changesets

This repository uses Changesets to maintain the CLI/Product Runtime and Desktop Shell release
versions and changelogs.

Current policy:

- Normal PRs may omit a changeset.
- If a PR changes the CLI or shared Product Runtime, add `@spencer-kit/coder-studio`.
- If a PR changes the packaged Electron Shell, installer, bundled Engine, preload, or other
  Shell-owned behavior, also add `@coder-studio/desktop`.
- Internal workspace changes that affect the CLI should still be described under the CLI package.
- Other workspace packages are internal-only and must not be targeted by changesets.

The Desktop production workflow compares the versioned Shell against the latest stable Desktop
channel. A changed Shell version triggers a full Desktop release; an unchanged Shell version keeps
the release Runtime-only.

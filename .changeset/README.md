# Changesets

This repository uses Changesets to maintain the CLI release PR and changelog.

Current policy:

- Normal PRs may omit a changeset.
- If a PR should be released, add a changeset for `@spencer-kit/coder-studio`.
- Internal workspace changes that affect the CLI should still be described under the CLI package.
- Non-CLI packages are currently internal-only and must not be targeted by changesets.

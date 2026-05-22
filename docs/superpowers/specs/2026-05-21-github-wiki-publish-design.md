# GitHub Wiki Publish Flow Design

> Status: Draft
> Date: 2026-05-21
> Scope: `scripts/publish-wiki.ts`, `scripts/publish-wiki.test.ts`, `package.json`, `README.md`, `README.zh-CN.md`, `docs/wiki/README.md`

## Goal

Add a repository-native manual publish flow for GitHub Wiki so `docs/wiki/` can be reviewed in the main repo and then pushed to the separate GitHub Wiki repository with a predictable, low-risk command.

The target outcome is:

- `docs/wiki/` remains the source of truth for wiki content in the main repository
- maintainers can publish that content with a single repository script
- the default path is safe and non-destructive by using dry-run behavior
- authentication works with normal local git credentials and can also use `GITHUB_TOKEN`
- the publish flow is documented in both the wiki source README and the main project README

## Problem

The repository already contains a full wiki source tree under `docs/wiki/`, but the publish step only exists as prose and has not been operationalized.

Today the gap is:

- `docs/wiki/README.md` describes a suggested manual `git clone` and `rsync` flow
- `README.md` and `README.zh-CN.md` present `docs/wiki` as "GitHub Wiki Source"
- there is no repository command that validates the source, prepares the wiki checkout, synchronizes files, shows pending changes, or optionally pushes them
- the GitHub Wiki repository has not been initialized, so the current documentation path is easy to forget and easy to get wrong

This leaves the project in an ambiguous state where wiki content exists locally but publication depends on undocumented operator memory.

## Decision

Introduce a TypeScript publish script and document it as the canonical manual wiki release flow.

The implementation will:

- add `scripts/publish-wiki.ts`
- add `scripts/publish-wiki.test.ts`
- add a root command `pnpm publish:wiki`
- keep `docs/wiki/` as the only source directory
- keep the process manual rather than automatic

This is intentionally a maintainer-driven publish flow, not a background synchronization mechanism.

## Out of Scope

This design does not include:

- GitHub Actions or any other automatic wiki deployment
- editing or restructuring wiki page content
- converting the wiki into `docs/help`
- publishing images or assets from directories outside `docs/wiki/`
- bidirectional sync from GitHub Wiki back into the main repository
- managing GitHub repository settings through the API

## Product and Maintainer Flow

### Command Entry Point

Add a root script:

- `pnpm publish:wiki`

This runs:

- `tsx scripts/publish-wiki.ts`

### Default Behavior

Running `pnpm publish:wiki` with no extra flags should behave as a dry run.

Dry-run behavior means:

- validate the source directory
- resolve the wiki remote
- prepare a local checkout of the wiki repository
- synchronize `docs/wiki/` into that checkout
- print git status and a summary of changed files
- do not commit
- do not push

This keeps the first-run path safe and makes the command usable as a verification step before publication.

### Publish Behavior

Actual publication requires an explicit push flag:

- `pnpm publish:wiki -- --push`

Push behavior means:

- perform the same validation and sync steps as dry run
- stage all synced changes in the wiki checkout
- create a commit when there are staged changes
- push to the configured wiki remote

If there are no content changes after sync, the script should exit successfully and print that the wiki is already up to date.

## Command-Line Interface

The script should support these options:

- `--push`
  - perform commit and push
- `--dry-run`
  - explicit no-push mode
- `--remote <url>`
  - override the default wiki repository URL
- `--message <text>`
  - override the default commit message
- `--workdir <path>`
  - override the temporary checkout location
- `--allow-dirty`
  - allow operation even if the main repository worktree is dirty
- `--help`
  - print usage and exit

The default values are:

- mode: dry run
- remote: `https://github.com/spencerkit/coder-studio.wiki.git`
- commit message: `docs: update wiki`
- workdir: repository-local temp directory such as `.tmp/wiki-publish`
- dirty main worktree policy: require a clean main repository only for `--push`, unless `--allow-dirty` is set

The dirty-worktree check is a safety feature for real publication. It prevents maintainers from pushing wiki content while their local documentation edits may still be incomplete or unreviewed.

## Authentication Model

### Default Authentication

The default remote is HTTPS:

- `https://github.com/spencerkit/coder-studio.wiki.git`

If the operator already has working git credential helpers configured, the script should rely on those credentials without modification.

### Token-Based Authentication

If `GITHUB_TOKEN` is present and the user did not explicitly supply `--remote`, the script must build an authenticated HTTPS remote for the child git commands.

The token path should:

- be opt-in through environment presence rather than a required flag
- avoid printing the token or the full authenticated remote in logs
- only use the token for child process environment and git operations

### Explicit Remote Override

If the user passes `--remote`, that value wins over every default.

This supports:

- SSH remotes such as `git@github.com:spencerkit/coder-studio.wiki.git`
- personal forks
- enterprise GitHub hosts

## Wiki Checkout Strategy

The script should manage a dedicated local checkout of the wiki repository.

Recommended default:

- `.tmp/wiki-publish`

Behavior:

1. if the workdir does not exist, clone the wiki repository there
2. if the workdir exists and is a git repository, reuse it
3. if the workdir exists but is not a valid git repository, fail with a clear error
4. before syncing content, fetch the remote and fast-forward the local branch to the remote branch

If the fast-forward fails because the local wiki checkout has diverged, the script must fail and instruct the maintainer to inspect or remove the workdir before retrying.

The script should not delete and recreate the workdir on every run. Reuse keeps the flow faster and easier to inspect.

## Sync Semantics

The script should copy only the contents of `docs/wiki/` into the wiki checkout root.

Key rules:

- preserve the wiki checkout `.git` directory
- mirror page file names exactly
- remove files from the wiki checkout that no longer exist in `docs/wiki/`
- not copy unrelated repository files

The operational effect is equivalent to:

- source: `docs/wiki/`
- destination: `<wiki-workdir>/`
- sync mode: recursive mirror with delete

Implementation must use a repo-native Node copy/delete flow rather than requiring `rsync`.

This keeps the command portable across environments that already run the repository TypeScript scripts but may not have `rsync` installed.

## Validation Rules

Before any sync:

- confirm the repository root can be resolved
- confirm `docs/wiki/` exists
- confirm `docs/wiki/Home.md` exists

Before any push:

- confirm the main repository worktree is clean unless `--allow-dirty` is set
- confirm the wiki workdir is either freshly cloned or a valid git repository

After sync:

- show `git status --short`
- detect whether there are staged or unstaged content changes

If validation fails, the script should exit non-zero with a concrete error message that tells the maintainer what to fix.

## Logging and UX

The script should match the existing `scripts/*.ts` tooling style:

- use shared logger helpers
- print step-oriented progress
- make dry-run versus push mode explicit at startup

Expected high-level phases:

- validate source
- resolve remote
- prepare wiki checkout
- sync files
- show diff summary
- optionally commit and push

The script must avoid:

- printing secrets
- printing a misleading success message when no push occurred
- hiding whether changes were actually produced

## Error Handling

The script must fail clearly for these situations:

- missing `docs/wiki/`
- missing `docs/wiki/Home.md`
- clone failure because the wiki repository does not exist yet
- authentication failure
- non-git workdir collision
- push requested with no permission
- dirty main repository without `--allow-dirty`

The "wiki repository does not exist yet" case should be especially explicit.

The error should explain that GitHub Wiki repositories are created only after the repository Wiki feature is initialized on GitHub, so the maintainer knows this is a setup issue rather than a script bug.

## Documentation Changes

### `docs/wiki/README.md`

Update the wiki source README so it stops being only a conceptual sync note and becomes the operational guide.

It should document:

- that `docs/wiki/` is the source of truth
- the default dry-run command
- the explicit push command
- the optional `GITHUB_TOKEN` path
- the optional `--remote` override for SSH
- the requirement that the GitHub Wiki must exist before the first publish

### `README.md` and `README.zh-CN.md`

Update the resource row that points to the wiki source so it is clear this is:

- source content for the GitHub Wiki
- accompanied by a repository publish command

The main README should not duplicate the full release guide. It should point maintainers to `docs/wiki/README.md` for the exact publish flow.

## Testing Strategy

Add script-level tests focused on deterministic behavior rather than real network publication.

Test categories:

- argument parsing defaults
- argument parsing overrides
- default remote resolution
- `GITHUB_TOKEN` remote resolution without leaking the token in user-facing logs
- explicit `--remote` taking precedence over token-based defaulting
- dry-run versus push mode behavior
- validation failure for missing `Home.md`
- commit skip when sync results in no changes

Tests should use mocked exec and filesystem seams so they do not require a live GitHub wiki repository.

## Implementation Notes

The implementation should follow the existing pattern used by script utilities in this repository:

- colocated script under `scripts/`
- exported parse and runner helpers for testability
- direct-execution guard consistent with other scripts
- process spawning through shared helpers where possible

The script should be written so future extensions remain easy, such as:

- branch selection
- preview diff output
- pre-publish linting of wiki links

These future directions are not part of the first implementation.

## Acceptance Criteria

This design is complete when:

- `pnpm publish:wiki` performs a safe dry run against `docs/wiki/`
- `pnpm publish:wiki -- --push` can publish to an initialized wiki repository
- maintainers can use either normal git credentials, `GITHUB_TOKEN`, or an explicit SSH remote override
- the script explains initialization failure when the wiki repository does not yet exist
- the README documentation points to the repository-native publish flow instead of only showing ad hoc shell commands

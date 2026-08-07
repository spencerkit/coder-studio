# Desktop CI Boundaries Design

## Context

The Desktop product has two intentionally different release boundaries:

- Desktop Shell and Engine ship as a full installer and change relatively slowly.
- Product Runtime ships Windows and WSL variants and can be released independently.

A full installer must still contain a trusted Factory Runtime so that a fresh installation and
runtime rollback work without a network download. The current `pnpm dist:desktop` command correctly
assembles and smoke-tests that integrated product. The problem is therefore not that Desktop and
Runtime are ever built together; it is that fast validation, heavyweight cross-platform packaging,
and acceptance publishing currently share one broadly triggered CI workflow.

## Goals

- Keep the normal pull-request CI focused on fast, broadly applicable repository validation.
- Run heavyweight Desktop packaging only when Desktop or Runtime inputs change, on `main`, or when
  explicitly requested.
- Move acceptance signing and prerelease publication behind an explicit manual workflow.
- Reuse the same Desktop asset-building workflow for unsigned verification and signed acceptance.
- Preserve the existing full-versus-runtime production release behavior.

## Non-goals

- Do not change `pnpm dist:desktop`, `pnpm build:desktop-runtime`, or their artifact layouts.
- Do not make the Desktop installer consume a separately prebuilt Runtime artifact in this change.
- Do not change runtime compatibility, signing, activation, or rollback behavior.
- Do not change the production `Publish Desktop` workflow's `full` and `runtime` modes.

## Workflow Architecture

### Fast repository CI

`.github/workflows/ci.yml` remains the required repository validation workflow. It retains:

- changeset validation;
- repository lint and tests;
- the production Web/CLI build;
- targeted Windows provider, server, and CLI verification.

It no longer generates signing keys, builds Desktop installers, builds WSL release assets, uploads
Desktop artifacts, or publishes acceptance releases. The workflow remains triggered for every pull
request and pushes to `main`.

### Reusable Desktop verification

`.github/workflows/desktop-verify.yml` owns the two heavyweight integration lanes:

- Windows Desktop tests, type-checking, installer plus Factory Runtime construction, packaged smoke
  testing, staging, validation, and artifact upload;
- Linux WSL Engine and Server Runtime construction, staging, validation, and artifact upload.

The workflow supports both direct triggers and `workflow_call`:

- pull requests run it only when a Desktop/Runtime build input changes;
- pushes to `main` run it unconditionally so the default branch always has a fully integrated
  Desktop signal;
- `workflow_dispatch` provides an explicit unsigned verification build;
- `workflow_call` lets the acceptance workflow request signed assets without duplicating build
  steps.

Direct verification runs permit unsigned Runtime manifests. A called acceptance run receives the
name of a short-lived signing-key artifact and the acceptance Runtime update URL. The Windows and
Linux jobs download the key artifact, configure their environments, build signed assets, and require
signed validation.

The pull-request path dependency closure includes:

- `.github/workflows/desktop-verify.yml`;
- `package.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`;
- `packages/desktop/**` and `packages/desktop-engine/**`;
- `packages/server/**`, `packages/web/**`, `packages/providers/**`, `packages/core/**`,
  `packages/utils/**`, and `packages/cli/**`;
- `scripts/**`.

This deliberately favors a safe superset because Product Runtime bundles Server/Web code and shared
workspace packages. Documentation-only changes do not trigger heavyweight packaging.

### Manual acceptance publication

`.github/workflows/desktop-acceptance.yml` is triggered only with `workflow_dispatch`. It:

1. resolves a run-specific prerelease tag and Runtime update URL;
2. generates an ephemeral Ed25519 key pair and uploads it with one-day retention;
3. calls the reusable Desktop verification workflow in signed mode;
4. downloads and validates the complete signed Windows and WSL asset set;
5. creates a tag-pinned GitHub prerelease and uploads the public key as a diagnostic artifact.

Only the final publication job receives `contents: write`. Build jobs remain read-only. Acceptance
releases never become the repository's `latest` release.

## Artifact and Failure Boundaries

Windows and Linux assets remain separate artifacts so either platform can fail and be rerun without
obscuring the other platform's result. The reusable workflow keeps deterministic artifact names
derived from the commit SHA, matching the acceptance aggregation pattern.

The Windows lane intentionally continues to build Desktop Shell and Product Runtime together because
the packaged smoke test validates their integration. The Linux lane continues to build WSL Engine
and WSL Server Runtime together for the same compatibility reason. Runtime-only production release
remains independent in `.github/workflows/desktop-release.yml`.

## Validation

Implementation validation will include:

- parsing all modified workflow YAML files;
- running repository formatting/lint checks against the changed files;
- running the existing Desktop release-artifact and packaging script tests;
- running `pnpm ci:verify` when practical, with any environment-specific limitation reported;
- reviewing the final workflow event, permission, dependency, and artifact-name graph manually.

No test may require publishing a real GitHub release. Signed acceptance publication remains a manual
post-merge verification step because it requires GitHub-hosted runners and repository permissions.

## Risks and Mitigations

- **Missed Runtime input:** use an intentionally broad package and script path closure for pull
  requests, and always run the full Desktop workflow after changes land on `main`.
- **Reusable workflow expression differences:** validate YAML structure and keep defaults valid for
  both direct and called workflow contexts.
- **Artifact-name mismatch:** define names once as reusable-workflow outputs and consume those outputs
  in the acceptance workflow.
- **Permission expansion:** keep the reusable build workflow read-only and grant write permission only
  to the acceptance publish job.
- **Branch-protection ambiguity:** keep `ci.yml` as the universal required check; treat the
  path-filtered Desktop workflow as an additional integration check rather than a universal required
  check.

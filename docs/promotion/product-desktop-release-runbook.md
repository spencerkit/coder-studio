# Product and Desktop Release Runbook

Coder Studio has two independently owned production release boundaries:

- A **Product release** publishes the CLI together with the Windows and WSL Product Runtime at one
  Product version. Its signed pointer is `product-stable/product-channel.json`.
- A **Desktop release** publishes the Desktop Shell, Windows Engine, and WSL Engine at one Desktop
  version. It packages the already accepted Factory Runtime identified by the Desktop channel, but
  does not rebuild or republish Product Runtime. Its signed pointer is
  `desktop-stable/desktop-channel.json`.

The fixed pointer releases contain only signed channel documents. Channels name immutable versioned
release tags and safe asset names; clients never infer component state from GitHub's repository-wide
latest selection.

## Normal Product release

Merging a release-ready Product version change in `packages/cli/package.json` to `main` starts
`product-release.yml`. The workflow builds one candidate at the final `v<version>` tag, publishes the
CLI under a temporary npm dist-tag, builds both Runtime targets, and runs CLI, Runtime, and reusable
Product/Desktop compatibility acceptance against those immutable bytes.

After every acceptance job succeeds, promotion is automatic. It advances the requested npm dist-tag
(normally `latest`), converts the versioned Product prerelease to a normal non-latest release,
advances `product-stable`, verifies the result, removes the temporary dist-tag, and writes
`promotion.json`. There is no run-ID handoff, environment approval, or separate manual promotion.

## Normal Desktop release

Merging a release-ready Desktop version change in `packages/desktop/package.json` to `main` starts
`desktop-release.yml`. It resolves and verifies `product-stable`, embeds those exact Factory Runtime
bytes and their provenance, and builds only the Shell, installer, Windows Engine, and WSL Engine. The
candidate uses the final `desktop-v<version>` tag.

Installed/fresh, offline Factory/fallback, and current/previous Product compatibility acceptance all
consume the immutable candidate. After they pass, promotion automatically converts the versioned
Desktop prerelease to a normal non-latest release, advances `desktop-stable`, verifies it, and writes
`promotion.json`. Product npm state and Product Runtime assets are never changed by this workflow.

## Candidate recovery with `candidate_tag`

Both normal workflows support `workflow_dispatch` recovery with `candidate_tag`. Use it only to
resume the exact final candidate tag for the version currently declared on `main`.

Recovery never rebuilds accepted artifacts. The workflow downloads the existing release, validates
it, and compares every accepted digest before continuing incomplete acceptance or promotion steps.
The same rule applies to fixed pointers and `promotion.json`: an existing identical byte sequence is
idempotent; an existing different byte sequence is a hard failure.

An **immutable-byte mismatch** is not repaired with `--clobber`. Retain the failed release for
diagnosis, increment to a higher patch version, and publish a new immutable candidate. Never move a
stable pointer backward as a downgrade mechanism.

## Automatic promotion and interruptions

Product and Desktop workflows use independent serialized locks (`product-production` and
`desktop-production`) for candidate construction and acceptance. Their promotion jobs additionally
share `product-desktop-stable-promotion`, so only one accepted tuple can move a stable pointer at a
time. After acquiring that lock, Product rechecks the accepted `desktop-stable` digest and Desktop
rechecks the accepted `product-stable` digest before changing any external state. If the counterpart
changed after compatibility acceptance, promotion stops and the same `candidate_tag` must rerun the
complete compatibility graph against the new stable tuple.

A failed acceptance leaves the candidate as a prerelease and does not move an npm dist-tag or stable
pointer. A rerun with `candidate_tag` inspects external state and completes only missing steps in the
defined order. Desktop candidates created before the split boundary cannot be resumed when their
`desktop-validation-evidence.tgz` still contains `factory-runtime/`; create a new candidate so Desktop
does not republish Product-owned Runtime bytes.

If interruption occurs after a versioned release is promoted but before its pointer moves, rerun the
same candidate. If it occurs after a pointer moves, verification and `promotion.json` converge on the
same accepted digest. Do not delete or replace assets while recovery is in progress.

## Pointer bootstrap

`product-stable` and `desktop-stable` are ordinary non-latest GitHub Releases with fixed tag names.
Normal publication may update a pointer only after immutable candidate acceptance. During initial
migration, `desktop-bridge-release.yml` creates a missing pointer or verifies that an existing pointer
has exactly the expected digest. A different existing digest stops the bridge.

The Product pointer is copied byte-for-byte from the bridge candidate's accepted
`product-channel.json`. The Desktop pointer is copied byte-for-byte from
`desktop-channel-modern.json` and uploaded to `desktop-stable` under the canonical asset name
`desktop-channel.json`. The bridge retains its legacy `desktop-channel.json` under the original name
for already installed clients.

## One-time legacy bridge sequence

The migration bridge is deliberately manual and serialized separately from routine publication:

Before starting it, freeze merges that can trigger either normal publication workflow and confirm no
`product-production` or `desktop-production` run is active. Keep that freeze until the bridge run has
finished or its partial state has been recovered; the one-time bridge has its own concurrency group
and cannot acquire both normal workflow locks at once.

1. Prepare an immutable prerelease containing the accepted Product bundle, the bridge installer and
   Engine assets, a legacy unified `desktop-channel.json`, and the split
   `desktop-channel-modern.json`. Its tag must be `desktop-v<version>`, exactly matching the signed
   Desktop channel version; arbitrary bridge tags are rejected because installed WSL Engine URLs are
   derived from that immutable identity.
2. Run `desktop-bridge-release.yml` with its exact tag in `bridge_candidate_tag` and type
   `PROMOTE_BRIDGE_TO_LATEST` in the confirmation input.
3. The workflow validates both bundles and confirms that Product bytes already exist unchanged at the
   signed Product release tag.
4. It bootstraps both `product-stable` and `desktop-stable`, then verifies that both fixed pointers
   resolve byte-for-byte to the accepted immutable bridge artifacts.
5. It publishes the bridge candidate as the normal repository-wide latest release so the pre-bridge
   installed Shells, which still follow the legacy `releases/latest/download` path, can reach the
   bridge.
6. It runs native and WSL installed-upgrade acceptance from the previously supported published
   legacy Desktop release into the bridge, then runs native and WSL checks from an installed bridge
   against the two independent stable feeds.
7. Finally it reconfirms that the bridge remains the repository-wide latest release and verifies the
   selected tag after both acceptance phases.

This is the only workflow permitted to issue a real GitHub `--latest` promotion. The bridge remains
repository-wide latest indefinitely so an old client always reaches its legacy assets. Every later
Product and Desktop release explicitly uses `--latest=false`.

## Post-bridge verification

After the hosted workflow succeeds, verify:

- repository-wide latest still names the bridge tag;
- `product-stable/product-channel.json` has the accepted digest and names the immutable Product tag;
- `desktop-stable/desktop-channel.json` has the accepted modern-channel digest and names the bridge
  tag;
- both native and WSL independent-feed acceptance reports were uploaded;
- a routine Product-only release moves only npm/Product state;
- a routine Desktop-only release moves only Desktop state and keeps the accepted Factory Product
  identity.

Never rerun the bridge for a routine release. If a post-bridge verification fails before latest is
changed, correct the candidate with a higher version. If latest already points at the bridge, the
workflow resolves the previous legacy Desktop source from published release history, keeps the legacy
endpoint fixed, and repairs an independent feed with its owning normal release workflow.

## Two-release compatibility window

Treat every Shell/Runtime ABI, Engine/Node requirement, API protocol, or data schema change as a
**two-release compatibility window**:

1. Publish a Desktop Shell that remains compatible with the current Product while adding support for
   the next Product contract.
2. Publish the Product release that requires the new Shell only after that Desktop version is stable.

Desktop candidate acceptance must cover the current and immediately previous accepted Product.
Product candidate acceptance must cover the current stable Desktop. Do not publish both sides of a
breaking tuple in one simultaneous promotion.

## Hosted acceptance limitations

Local tests and `pnpm ci:verify` validate schemas, digests, planning, and workflow structure, but they
do not publish Releases, move npm tags, exercise Authenticode trust on a hosted Windows runner, or
change the live repository-wide latest selection. Product/Desktop pointer bootstrap and the one-time
installed bridge must therefore be completed and inspected in GitHub Actions with production keys.

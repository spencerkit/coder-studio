# Product and Desktop Release Boundaries Design

## Context

Coder Studio has two real release boundaries that the current production workflows do not model
cleanly:

- the CLI package and Product Runtime contain the same Server/Web product and share one product
  version;
- the Desktop Shell and Engine contain Electron, Node, native ABI dependencies, and the Runtime host
  and use an independent Desktop version.

The current `Publish Desktop` workflow infers `full`, `runtime-only`, or `migration` behavior from the
latest GitHub Release. Runtime-only releases still enter the Desktop publication workflow and carry
forward Shell assets. `Publish CLI` preserves Desktop channel assets when creating the CLI GitHub
Release. Stable CLI promotion requires a Desktop acceptance run, while stable Desktop promotion
requires a CLI acceptance run. GitHub's single repository-wide `latest` release is therefore used as
both a Product Runtime feed and a Desktop Shell feed.

This creates an operational release cycle around components that already have independent versions.
It also lets Desktop signing, packaging, or installed-upgrade failures block an otherwise valid CLI
and Runtime release.

## Goals

- Release CLI and Windows/WSL Product Runtime together under one product version.
- Release Desktop Shell and Windows/WSL Engine under an independent Desktop version.
- Remove the routine `full`, `runtime-only`, and `migration` inference from production workflows.
- Preserve one coherent Desktop update plan even though Product and Desktop use independent feeds.
- Preserve Runtime signature verification, staging, health validation, rollback, and quarantine.
- Preserve Electron's signed installer path and the CLI's npm update path.
- Build each candidate once, accept those exact bytes, and promote them automatically after all gates
  pass.
- Remove manually copied workflow run IDs from the normal release path.
- Stop using GitHub's repository-wide `latest` selection as the long-term component discovery API.
- Provide a safe upgrade path for already installed Shells that contain the old `latest` URLs.

## Non-goals

- Do not merge the CLI installer, Runtime updater, and Electron updater into one installer.
- Do not publish Desktop through npm or install CLI updates through Electron.
- Do not remove the Factory Runtime from a Desktop installer.
- Do not change Runtime activation, local rollback, or failed-version isolation semantics.
- Do not promise automatic downgrade of an installed Desktop Shell or Product Runtime.
- Do not rebuild accepted assets during promotion.
- Do not introduce a CDN; GitHub Releases and npm remain the artifact origins.

## Approaches Considered

### Split only the workflow files

This would move the `runtime-only` branch from `Publish Desktop` into `Publish CLI`, but would retain
the shared GitHub `latest` release, copied cross-component assets, and a unified release channel. It
would reduce file size without removing the release coupling and is rejected.

### Independent Product and Desktop channels

This is the selected approach. Product and Desktop publish immutable, versioned releases and advance
separate signed stable pointers. The Desktop client reads both feeds and combines compatible updates
into one plan. Cross-component acceptance remains a reusable gate rather than a shared publication
boundary.

### Independent builds with a single release-train promotion

This would build the components independently but promote them through one top-level orchestrator.
It provides a single train view but retains the waiting chain and cross-run coordination that this
change is intended to remove. It is rejected for normal releases.

## Release Boundaries

### Product Release

One Product Release owns:

- the `@spencer-kit/coder-studio` npm package;
- the Windows `win32-x64` Product Runtime;
- the WSL `linux-x64` Server Runtime;
- one shared product version read from `packages/cli/package.json`;
- the signed Product stable channel.

Both Runtime manifests must use the CLI version. The workflow rejects a candidate if the npm package
version, Windows Runtime version, and WSL Runtime version differ.

### Desktop Release

One Desktop Release owns:

- the Electron Shell and Windows installer;
- the packaged Windows Engine;
- the WSL Engine;
- the Desktop version read from `packages/desktop/package.json`;
- the signed Desktop stable channel.

A Desktop installer still contains a Factory Runtime. The Desktop workflow downloads that Factory
Runtime from an already accepted, immutable Product Release selected from the Product stable channel.
It does not rebuild Product Runtime from the current source tree. The installer records the exact
Product release tag and manifest digest used for its Factory Runtime.

### Compatibility Acceptance

A reusable compatibility workflow accepts explicit Product and Desktop release tags and their signed
manifest digests. It does not build or publish assets. Product and Desktop workflows call it with
their candidate and the other component's current stable release.

Normal releases remain independent. A host ABI, protocol, or schema change uses a two-release
compatibility window:

1. publish a new Shell that remains compatible with the current Product Runtime;
2. publish the Product Runtime that requires the new Shell.

A Product candidate whose `minShellVersion` exceeds the current Desktop stable version is rejected.
This prevents an automatically promoted Product release from stranding Desktop clients. Repository
changes that cross this boundary must be released in the two steps above rather than relying on two
simultaneously running production workflows.

## Workflow Architecture

### Product workflow

`.github/workflows/product-release.yml` replaces the production responsibilities of
`.github/workflows/publish.yml` and the `runtime-only` branch of the current Desktop workflow.

It is triggered when a merged Changesets release commit advances `packages/cli/package.json`. A
manual dispatch remains available for recovery and for reusing an existing immutable candidate.
The workflow uses the `product-production` concurrency group and performs:

1. repository and release metadata validation on `main`;
2. one CLI pack and integrity calculation;
3. one signed Windows Runtime build and one signed WSL Runtime build;
4. publication of the immutable npm version under a run-specific temporary dist-tag;
5. creation or reuse of the final `v<product-version>` GitHub prerelease containing both Runtime
   targets and their signed manifests;
6. CLI installed-update acceptance against the temporary npm dist-tag;
7. native and WSL Runtime installed-update acceptance against the candidate release tag;
8. compatibility acceptance against the current stable Desktop release;
9. automatic, idempotent promotion.

Product acceptance covers Runtime health rollback, interrupted download, restart-journal recovery,
and the external-sidecar-browser scenario. It does not rebuild or publish a Desktop installer.

### Desktop workflow

`.github/workflows/desktop-release.yml` becomes an explicit Shell and Engine workflow. It is triggered
when a merged Changesets release commit advances `packages/desktop/package.json`, with manual dispatch
available for recovery. It uses the `desktop-production` concurrency group and performs:

1. repository and release metadata validation on `main`;
2. resolution and download of the current stable Product Runtime for the Factory Runtime;
3. one signed Electron Shell, Windows installer, Windows Engine, and WSL Engine build;
4. creation or reuse of the final `desktop-v<desktop-version>` GitHub prerelease;
5. fresh Native and WSL installation acceptance;
6. installed Shell upgrade acceptance;
7. offline Factory Runtime startup and fallback acceptance;
8. compatibility acceptance with the current and immediately previous accepted Product Runtime;
9. automatic, idempotent promotion.

It has no inferred `runtime-only` mode and does not change npm or the Product stable channel.

### Reusable verification

Pull-request verification may retain separate reusable jobs for Runtime construction and integrated
Desktop packaging. Production workflows call those build routines with signing enabled, but
acceptance always consumes assets from the immutable candidate publication rather than from an
unpublished workspace artifact.

The release workflows own their acceptance artifacts within the same run or address them by
candidate tag and digest. Users do not pass Desktop or CLI acceptance run IDs between workflows.

## Channel Architecture

Two fixed GitHub Release tags provide small, signed, mutable channel pointers:

- `product-stable` publishes `product-channel.json`;
- `desktop-stable` publishes `desktop-channel.json`.

Versioned release assets remain immutable. Advancing a stable pointer replaces only its signed
channel document after acceptance. Each previous channel document is retained in the workflow's
promotion record for diagnostics.

The production client URLs are:

```text
https://github.com/spencerkit/coder-studio/releases/download/product-stable/product-channel.json
https://github.com/spencerkit/coder-studio/releases/download/desktop-stable/desktop-channel.json
```

The existing Runtime Ed25519 trust root signs both channel documents initially. Introducing separate
keys is not required for this boundary change. Acceptance channels continue to use short-lived keys
and explicit environment overrides.

### Product channel contract

The Product channel contains:

- schema version, channel kind, product version, release time, and versioned Product release tag;
- Windows and Linux Runtime manifest filenames and signed manifest digests;
- the minimum compatible Shell version;
- required Engine, Node, Runtime Host API, API protocol, and data-schema capabilities;
- a signature over the canonical channel payload.

Windows and Linux entries must have the same product version. The client constructs asset URLs from a
fixed trusted repository origin, a validated release tag, and validated single-file asset names. The
channel does not provide arbitrary absolute download URLs.

### Desktop channel contract

The Desktop channel contains:

- schema version, channel kind, Desktop version, release time, and versioned Desktop release tag;
- the Electron updater metadata filename and installer identity;
- Engine, Node, Runtime Host API, API protocol, and data-schema capabilities;
- the Product version and manifest digest embedded as the Factory Runtime;
- a signature over the canonical channel payload.

The Shell updater configures its feed to the versioned Desktop release selected by this signed
channel. It no longer asks the GitHub provider to select the repository-wide latest release.

## Client Update Behavior

The Desktop Main-process coordinator remains the single Desktop update authority. Its source-loading
boundary changes from one unified `DesktopChannel` to independent Product and Desktop channel
loaders.

On a check it:

1. fetches and verifies both channels independently;
2. resolves the active Windows or WSL Runtime target from the Product channel;
3. asks the Shell and Runtime adapters for metadata from their selected versioned releases;
4. validates the proposed component combination against installed and target capabilities;
5. exposes one product-level plan containing the safe components that need an update.

If both feeds are valid, Shell and Runtime updates may be downloaded in parallel and retain the
existing one-confirmation, one-restart experience. If only the Product channel succeeds, a Runtime
update may proceed when it is compatible with the installed Shell. If only the Desktop channel
succeeds, a Shell update may proceed only when it declares compatibility with the installed Runtime.
A partial feed failure is retained in diagnostics and the aggregate state must not report that every
component is up to date.

The coordinator needs the installed Runtime's compatibility metadata, not only its version and
release time, to validate a Shell-only plan. Existing Runtime manifests remain the source of that
metadata.

The following component behavior is unchanged:

- Runtime manifest signature, hash, path, file-set, and compatibility verification;
- Runtime download staging, restart activation, health validation, rollback, and quarantine;
- WSL Runtime installation through the Windows-hosted WSL adapter;
- Electron installer download and Authenticode verification;
- CLI npm metadata lookup, exact-version installation, detached worker, and service restart.

The Shell adapter gains a trusted per-release feed configuration operation. The feed base is derived
from the fixed GitHub repository and the signed Desktop release tag. The expected updater metadata
and returned Shell version must match the signed Desktop channel before a download becomes ready.

## Candidate and Promotion Model

Candidates use their final immutable version identities:

- Product: npm version `<product-version>` under a temporary `rc-<run>` dist-tag and GitHub prerelease
  `v<product-version>`;
- Desktop: GitHub prerelease `desktop-v<desktop-version>`.

Acceptance addresses candidates directly by npm dist-tag, release tag, manifest filename, and digest.
It never reads a stable pointer while testing a candidate.

After every required acceptance job passes, promotion is automatic. There is no production
environment approval gate.

Product promotion runs in this order:

1. verify that the npm integrity and every Runtime/channel digest match the accepted values;
2. move the requested npm dist-tag, normally `latest`, to the accepted version;
3. mark the versioned Product GitHub prerelease as a normal release;
4. replace the signed `product-stable` pointer;
5. verify npm and the stable pointer both resolve to the accepted product version;
6. remove the temporary npm dist-tag;
7. write `promotion.json`.

The Product pointer is intentionally advanced after npm. An interruption may temporarily make the
CLI newer than the Desktop Runtime feed, which is safe and recoverable; it must never expose a
Runtime version whose matching npm version has not been promoted.

Desktop promotion runs in this order:

1. verify that installer, Engine, Factory Runtime, and channel digests match the accepted values;
2. mark the versioned Desktop GitHub prerelease as a normal release;
3. replace the signed `desktop-stable` pointer;
4. verify the stable pointer resolves to the accepted Desktop version;
5. write `promotion.json`.

Both promotion paths are idempotent. A rerun inspects npm dist-tags, GitHub Release state, stable
channel content, and accepted digests, then completes missing steps without rebuilding. If an
existing version contains different bytes, promotion stops and requires a new version.

`promotion.json` records the version, source commit, candidate tag, artifact digests, acceptance run
identity, previous stable channel digest, final stable channel digest, and promotion time. It is
uploaded to the versioned release and retained as a workflow artifact.

## Migration for Installed Clients

Installed Shells currently contain repository-wide `releases/latest/download` URLs. One bridge
Desktop release is published through the existing unified mechanism before independent production
workflows take over.

The migration sequence is:

1. bootstrap `product-stable` to the current accepted Product release;
2. publish the bridge candidate with run-specific Product and Desktop acceptance channels;
3. accept the bridge from the currently supported installed Shells through the old unified candidate
   channel, then verify both independent acceptance feeds from the installed bridge;
4. mark the accepted bridge as a normal release and bootstrap `desktop-stable` to it;
5. publish the bridge as the final repository-wide GitHub `latest` release and verify that a normal
   production installation reads both stable feeds;
6. make every later Product and Desktop release explicitly use `latest=false`.

The bridge's legacy unified channel and updater metadata remain available indefinitely. An old client
therefore reaches the bridge through its compiled legacy URL even after newer Product and Desktop
releases exist. Once on the bridge, it uses only the independent stable channels.

The Product stable channel and the bridge's run-specific acceptance channels must exist before bridge
acceptance. Both fixed stable channel releases must pass a production fetch-and-signature check before
the bridge is made latest. The bridge does not silently fall back to the legacy feed after migration;
a missing or invalid independent feed becomes a diagnosable check failure.

The current generic `migration` release mode is removed only after this bridge path has passed real
installed-upgrade acceptance. The bridge operation itself remains an explicit one-time release task,
not a permanent inferred production mode.

## Failure and Recovery

- A candidate acceptance failure leaves the candidate as a prerelease and does not change npm or a
  stable pointer.
- A candidate may be retained for diagnosis or deleted explicitly; cleanup never changes stable
  state.
- A channel fetch, parse, or signature failure cannot produce an install plan from that channel.
- One failed feed does not hide a safe update from the other feed, but it prevents an aggregate
  `up_to_date` result.
- Runtime activation failure continues to fall back locally to the previous trusted or Factory
  Runtime and quarantines the bad version.
- Shell installation failure continues to expose diagnostics and a manual installer path; it does
  not claim automatic Shell rollback.
- Stable pointers are not moved backward as a product downgrade mechanism. A bad promoted version is
  fixed with a higher patch release. Previous signed pointers are retained only to recover a failed
  publication operation before clients consume a new pointer.
- Promotion reruns converge on the accepted version. They never overwrite an immutable npm version,
  Runtime archive, manifest, installer, or Engine archive.

## Verification

### Unit and repository tests

- Product and Desktop channel parsing, canonical signing, and schema rejection;
- safe release-tag and asset-name resolution without arbitrary URL support;
- independent feed success, partial failure, and invalid-signature behavior;
- Runtime-only, Shell-only, combined, and incompatible plan construction;
- installed Runtime capability use in Shell-only validation;
- Shell updater feed pinning and returned-version matching;
- idempotent Product and Desktop promotion state transitions;
- workflow trigger, permission, concurrency, job dependency, and artifact-name tests;
- repository `pnpm ci:verify`.

### Product candidate acceptance

- current npm `latest` to candidate CLI update;
- current stable Shell to candidate Windows Runtime update;
- current stable Shell to candidate WSL Runtime update;
- Runtime health failure and local rollback;
- interrupted download and restart-journal recovery;
- external browser connected to a Desktop-managed sidecar;
- equality of CLI, Windows Runtime, and WSL Runtime product versions and accepted digests.

### Desktop candidate acceptance

- current stable Shell to candidate Shell installed upgrade;
- fresh Native and WSL installation;
- offline Factory Runtime startup;
- Factory Runtime fallback after active Runtime failure;
- compatibility with current and immediately previous accepted Product Runtime;
- Authenticode verification, Engine/Node ABI verification, packaged smoke, and updater metadata
  identity.

### Migration acceptance

- currently supported installed Shell to bridge through repository-wide `latest`;
- bridge fetch and verification of both independent stable channels;
- a post-bridge Product-only update without a Desktop release;
- a post-bridge Desktop-only update without a Product release;
- confirmation that later non-latest releases do not change the legacy bridge endpoint.

No local verification publishes a real GitHub Release or changes an npm dist-tag. Production channel
bootstrap, bridge promotion, and real installed-upgrade acceptance remain GitHub-hosted release
operations using immutable candidates.

## Operational Result

Routine Product work produces one Product candidate, one acceptance graph, and one automatic Product
promotion. Routine Desktop work produces one Desktop candidate, one acceptance graph, and one
automatic Desktop promotion. Neither routine path requires a release or acceptance run ID from the
other path.

The Desktop user still sees one compatible update plan and normally one restart. The operational
release system, however, now follows the actual component boundaries: Product Runtime moves with the
CLI, while Shell and Engine move with Desktop.
